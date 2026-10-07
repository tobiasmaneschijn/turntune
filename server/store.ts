import { RoomCommandError } from "./socket-handler.js";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createAdminClient } from "@supabase/server/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeRadioState, pruneUnauthorizedDjs } from "./radio.js";
import { runtimeMetrics } from "./runtime-metrics.js";
import { changePrivateLibrary, emptyLibrary, libraryMutationSchema, privateLibrarySchema, type LibraryMutation, type PrivateLibrary } from "./private-library.js";
import type {
  DjAccess,
  Room,
  RoomDirectoryEntry,
  RoomRole,
  MusicProviderConnection,
  SoundSpinProfile,
  SoundSpinProfileOption
} from "./types.js";

const PROFILE_COLUMNS = "user_id, display_name, is_app_admin, bio, avatar_key, avatar_url, avatar_path, theme_key, created_at, updated_at";

interface Database {
  rooms: Record<string, Room>;
  roomPasswords?: Record<string, string | null>;
  musicConnections?: Record<string, MusicProviderConnection>;
  privateLibraries?: Record<string, PrivateLibrary>;
}

interface StoreOptions {
  dataDir?: string;
  /** Explicit null selects local storage, including in isolated tests. */
  supabase?: SupabaseClient | null;
}

export interface RoomChange<T> {
  result: T;
  /** Authoritative metadata and membership are committed in the same SQL transaction. */
  metadata?: Record<string, unknown>;
  member?: { user_id: string; role: RoomRole };
  committed?: () => void;
  rejected?: () => void;
}

export class Store {
  // The cache is the live room object graph used by Socket.IO handlers. Supabase
  // is durable storage, not a replacement for the process's coordination state.
  private data: Database = { rooms: {} };
  // Serialize writes so a slower save cannot overwrite a newer radio state.
  private writeChain: Promise<void> = Promise.resolve();
  private roomWrites = new Map<string, Promise<void>>();
  private roomChanges = new Map<string, Promise<unknown>>();
  private queuedRoomChanges = new Map<string, number>();
  private supabase: SupabaseClient | null = null;
  private roomLoads = new Map<string, Promise<Room | undefined>>();
  private libraryWrites = new Map<string, Promise<PrivateLibrary>>();
  private readonly dataDir: string;
  private readonly dataFile: string;
  private readonly tempFile: string;

  constructor(options: StoreOptions = {}) {
    this.dataDir = options.dataDir || process.env.DATA_DIR || path.join(process.cwd(), "data");
    this.dataFile = path.join(this.dataDir, "soundspin.json");
    this.tempFile = path.join(this.dataDir, "soundspin.tmp.json");
    const url = process.env.SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if (options.supabase !== undefined) {
      this.supabase = options.supabase;
    } else if (url && secretKey) {
      this.supabase = createAdminClient();
    }
  }

  get usesSupabase() {
    return Boolean(this.supabase);
  }

  get cachedRoomCount() { return Object.keys(this.data.rooms).length; }

  async init() {
    if (this.supabase) return;
    await mkdir(this.dataDir, { recursive: true });
    try {
      const data = JSON.parse(await readFile(this.dataFile, "utf8")) as Database;
      if (!data || typeof data !== "object" || !data.rooms || typeof data.rooms !== "object" || Array.isArray(data.rooms)) {
        throw new Error("The saved SoundSpin database has an invalid format.");
      }
      for (const [id, room] of Object.entries(data.rooms)) {
        if (!room || typeof room !== "object" || Array.isArray(room)) {
          throw new Error(`The saved SoundSpin room ${id} has an invalid format.`);
        }
        room.id = id;
        normalizeRadioState(room);
      }
      this.data = data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.persistFile();
    }
  }

  private musicConnectionKey(userId: string, provider: "spotify") {
    return `${userId}:${provider}`;
  }

  async getMusicConnection(userId: string, provider: "spotify") {
    if (!this.supabase) {
      return this.data.musicConnections?.[this.musicConnectionKey(userId, provider)] || null;
    }
    const { data, error } = await this.supabase
      .from("soundspin_music_connections")
      .select("user_id, provider, refresh_token_ciphertext, scopes, metadata, created_at, updated_at")
      .eq("user_id", userId)
      .eq("provider", provider)
      .maybeSingle();
    if (error) throw new Error(`Could not load ${provider} connection: ${error.message}`);
    return data ? {
      userId: data.user_id,
      provider: data.provider,
      refreshTokenCiphertext: data.refresh_token_ciphertext,
      scopes: data.scopes || [],
      metadata: data.metadata || {},
      createdAt: data.created_at,
      updatedAt: data.updated_at
    } as MusicProviderConnection : null;
  }

  async saveMusicConnection(connection: Omit<MusicProviderConnection, "createdAt" | "updatedAt">) {
    const now = new Date().toISOString();
    if (!this.supabase) {
      this.data.musicConnections ||= {};
      const key = this.musicConnectionKey(connection.userId, connection.provider);
      const current = this.data.musicConnections[key];
      this.data.musicConnections[key] = {
        ...connection,
        createdAt: current?.createdAt || now,
        updatedAt: now
      };
      await this.persistFile();
      return;
    }
    const { error } = await this.supabase.from("soundspin_music_connections").upsert({
      user_id: connection.userId,
      provider: connection.provider,
      refresh_token_ciphertext: connection.refreshTokenCiphertext,
      scopes: connection.scopes,
      metadata: connection.metadata,
      updated_at: now
    }, { onConflict: "user_id,provider" });
    if (error) throw new Error(`Could not save ${connection.provider} connection: ${error.message}`);
  }

  async deleteMusicConnection(userId: string, provider: "spotify") {
    if (!this.supabase) {
      delete this.data.musicConnections?.[this.musicConnectionKey(userId, provider)];
      await this.persistFile();
      return;
    }
    const { error } = await this.supabase
      .from("soundspin_music_connections")
      .delete()
      .eq("user_id", userId)
      .eq("provider", provider);
    if (error) throw new Error(`Could not disconnect ${provider}: ${error.message}`);
  }

  getRoom(id: string) {
    return Object.hasOwn(this.data.rooms, id) ? this.data.rooms[id] : undefined;
  }

  /** One room's entire validate/persist/commit sequence is ordered, including timers. */
  changeRoom<T>(room: Room, operation: (draft: Room) => RoomChange<T> | Promise<RoomChange<T>>): Promise<T> {
    const queued = this.queuedRoomChanges.get(room.id) || 0;
    if (queued >= 100) return Promise.reject(new Error("Too many room changes are pending. Try again shortly."));
    this.queuedRoomChanges.set(room.id, queued + 1);
    runtimeMetrics.pendingRoomCommands++;
    const previous = this.roomChanges.get(room.id) || Promise.resolve();
    const result = previous.catch(() => {}).then(async () => {
      const started = performance.now();
      let change: RoomChange<T> | undefined;
      try {
        if (this.getRoom(room.id) !== room) throw new Error("This room session changed. Join the room again.");
        const draft = structuredClone(room);
        change = await operation(draft);
        await this.commitRoom(room, draft, change);
        // Persistence succeeded. A diagnostic/receipt hook cannot turn that into a failed command.
        try { change.committed?.(); } catch (error) { console.error("Room commit notification failed", error); }
        runtimeMetrics.observe("room_command", performance.now() - started);
        return change.result;
      } catch (error) {
        try { change?.rejected?.(); } catch (rollbackError) { console.error("Room rollback notification failed", rollbackError); }
        runtimeMetrics.observe("room_command", performance.now() - started, true);
        throw error;
      }
    });
    this.roomChanges.set(room.id, result);
    void result.finally(() => {
      runtimeMetrics.pendingRoomCommands--;
      const remaining = (this.queuedRoomChanges.get(room.id) || 1) - 1;
      if (remaining) this.queuedRoomChanges.set(room.id, remaining); else this.queuedRoomChanges.delete(room.id);
      if (this.roomChanges.get(room.id) === result) this.roomChanges.delete(room.id);
    }).catch(() => {});
    return result;
  }

  private async commitRoom(current: Room, draft: Room, change: RoomChange<unknown>) {
    const started = performance.now();
    try {
      if (!this.supabase) {
        await this.enqueueWrite(async () => {
          const roomPasswords = { ...this.data.roomPasswords };
          if (change.metadata && Object.hasOwn(change.metadata, "password_hash")) roomPasswords[draft.id] = change.metadata.password_hash as string | null;
          const serialized = JSON.stringify({ ...this.data, rooms: { ...this.data.rooms, [draft.id]: draft }, roomPasswords }, null, 2);
          await writeFile(this.tempFile, serialized, "utf8");
          await rename(this.tempFile, this.dataFile);
          Object.assign(current, draft);
          this.data.roomPasswords = roomPasswords;
        });
      } else {
        const supabase = this.supabase;
        await this.enqueueWrite(async () => {
          if (change.member || change.metadata) {
            const { data, error } = await supabase.rpc("soundspin_commit_room", {
              p_slug: draft.id, p_state: draft, p_metadata: change.metadata || {}, p_member: change.member || null
            });
            if (error) throw new Error(`Could not save room: ${error.message}`);
            if (!data) throw new Error("Could not save room: the room no longer exists.");
          } else {
            const { data, error } = await supabase.from("soundspin_rooms").update({ state: draft, updated_at: new Date().toISOString() })
              .eq("slug", draft.id).select("slug").maybeSingle();
            if (error) throw new Error(`Could not save room: ${error.message}`);
            if (!data) throw new Error("Could not save room: the room no longer exists.");
          }
          Object.assign(current, draft);
        }, draft.id);
      }
      runtimeMetrics.observe("room_save", performance.now() - started);
    } catch (error) {
      runtimeMetrics.observe("room_save", performance.now() - started, true);
      throw error;
    }
  }

  /** Supabase is durable storage, so inactive process cache entries can be released. */
  releaseRoom(id: string) {
    if (!this.supabase || this.roomChanges.has(id) || this.roomWrites.has(id)) return false;
    delete this.data.rooms[id];
    return true;
  }

  async isReady() {
    if (!this.supabase) return true;
    const { error } = await this.supabase.from("soundspin_rooms").select("slug").limit(0).abortSignal(AbortSignal.timeout(5_000));
    return !error;
  }

  async getPrivateLibrary(userId: string): Promise<PrivateLibrary> {
    if (!this.supabase) return structuredClone(this.data.privateLibraries && Object.hasOwn(this.data.privateLibraries, userId) ? this.data.privateLibraries[userId] : emptyLibrary());
    const { data, error } = await this.supabase.from("soundspin_private_libraries").select("data, revision").eq("user_id", userId).maybeSingle();
    if (error) throw new Error(`Could not load private picks and sets: ${error.message}`);
    return data ? privateLibrarySchema.parse(data.data) : emptyLibrary();
  }

  /** Per-owner ordering plus database revision checks prevent lost concurrent-tab edits. */
  updatePrivateLibrary(userId: string, value: LibraryMutation): Promise<PrivateLibrary> {
    const mutation = libraryMutationSchema.parse(value);
    const previous = this.libraryWrites.get(userId);
    const operation = (previous ? previous.catch(() => emptyLibrary()) : Promise.resolve(emptyLibrary())).then(async () => {
      if (!this.supabase) {
        this.data.privateLibraries ||= {};
        const before = this.data.privateLibraries[userId];
        const next = changePrivateLibrary(before || emptyLibrary(), mutation);
        Object.defineProperty(this.data.privateLibraries, userId, { value: next, writable: true, enumerable: true, configurable: true });
        try { await this.persistFile(); }
        catch (error) { if (before) this.data.privateLibraries[userId] = before; else delete this.data.privateLibraries[userId]; throw error; }
        return structuredClone(next);
      }
      const supabase = this.supabase;
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data, error } = await supabase.from("soundspin_private_libraries").select("data, revision").eq("user_id", userId).maybeSingle();
        if (error) throw new Error(`Could not load private picks and sets: ${error.message}`);
        const next = changePrivateLibrary(data ? privateLibrarySchema.parse(data.data) : emptyLibrary(), mutation);
        if (!data) {
          const insert = await supabase.from("soundspin_private_libraries").insert({ user_id: userId, data: next, revision: 1 });
          if (!insert.error) return next;
          if (insert.error.code === "23505") continue;
          throw new Error(`Could not save private picks and sets: ${insert.error.message}`);
        }
        const update = await supabase.from("soundspin_private_libraries").update({ data: next, revision: data.revision + 1, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("revision", data.revision).select("revision").maybeSingle();
        if (update.error) throw new Error(`Could not save private picks and sets: ${update.error.message}`);
        if (update.data) return next;
      }
      throw new Error("Your library changed in another tab. Refresh and try again.");
    });
    this.libraryWrites.set(userId, operation);
    void operation.finally(() => { if (this.libraryWrites.get(userId) === operation) this.libraryWrites.delete(userId); }).catch(() => {});
    return operation;
  }

  /** Reserve a guest room before a join yields, so every socket shares its owner/state. */
  getOrCreateLocalRoom(id: string, create: () => Room): Room {
    if (this.supabase) throw new Error("Supabase rooms must be explicitly created before joining.");
    const current = this.getRoom(id);
    if (current) return current;
    const room = create();
    if (room.id !== id) throw new Error("The new room address does not match its cache key.");
    Object.defineProperty(this.data.rooms, id, { value: room, enumerable: true, writable: true, configurable: true });
    return room;
  }

  async loadRoom(id: string) {
    const cached = this.getRoom(id);
    if (cached || !this.supabase) return cached;

    // All sockets must coordinate through the same live object. A second load
    // must not replace it while the first join is already mutating it.
    const pending = this.roomLoads.get(id);
    if (pending) return pending;
    const loading = this.loadRoomFromDatabase(id);
    this.roomLoads.set(id, loading);
    try {
      return await loading;
    } finally {
      this.roomLoads.delete(id);
    }
  }

  private async loadRoomFromDatabase(id: string) {
    const supabase = this.supabase!;

    const { data, error } = await supabase
      .from("soundspin_rooms")
      .select("state, name, owner_id, is_public, password_hash, settings")
      .eq("slug", id)
      .maybeSingle();

    if (error) {
      if (error.code === "PGRST205") {
        throw new Error(
          "Lydman database is not initialized. Deploy the migrations from GitHub or run the initial migration in the Supabase SQL editor."
        );
      }
      throw new Error(`Could not load room: ${error.message}`);
    }
    if (!data) return undefined;
    const { data: roomRoles, error: roomRoleError } = await supabase
      .from("soundspin_room_members")
      .select("user_id, role")
      .eq("room_slug", id)
      .in("role", ["moderator", "dj"]);
    if (roomRoleError) throw new Error(`Could not load room roles: ${roomRoleError.message}`);

    // `state` holds the fast-changing radio document. First-class room columns
    // and membership rows win over duplicated values in that JSON because they
    // are the authorization/directory source of truth.
    const room = {
      ...(data.state as Room),
      id,
      name: data.name,
      ownerUserId: data.owner_id,
      moderatorUserIds: (roomRoles || []).filter((member) => member.role === "moderator").map((member) => member.user_id),
      djRoleUserIds: (roomRoles || []).filter((member) => member.role === "dj").map((member) => member.user_id),
      isPublic: data.is_public,
      passwordProtected: Boolean(data.password_hash),
      settings: data.settings || {}
    };
    normalizeRadioState(room);
    // A creator may have populated the cache while this read was in flight.
    const cached = this.getRoom(id);
    if (cached) return cached;
    this.data.rooms[id] = room;
    return room;
  }

  async listRooms(userId: string, listenerCounts: Record<string, number>) {
    if (!this.supabase) {
      return Object.values(this.data.rooms).map((room): RoomDirectoryEntry => ({
        slug: room.id,
        name: room.name,
        ownerId: room.ownerUserId,
        isPublic: room.isPublic ?? true,
        passwordProtected: room.passwordProtected ?? false,
        isFavorite: false,
        role: room.ownerUserId === userId ? "owner" : null,
        listenerCount: listenerCounts[room.id] || 0,
        createdAt: new Date(room.createdAt).toISOString(),
        updatedAt: new Date(room.createdAt).toISOString(),
        description: typeof room.settings.description === "string" ? room.settings.description.trim().slice(0, 240) : undefined
      }));
    }

    const supabase = this.supabase;
    const allRows = async <T>(table: string, columns: string, filterColumn: string, filterValue: string, orderColumn: string) => {
      const rows: T[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.from(table).select(columns).eq(filterColumn, filterValue).order(orderColumn).range(offset, offset + 499);
        if (error) throw new Error(`Could not load your room directory: ${error.message}`);
        rows.push(...(data || []) as unknown as T[]);
        if (!data || data.length < 500) return rows;
      }
    };
    const [favorites, memberships] = await Promise.all([
      allRows<{ room_slug: string }>("soundspin_room_favorites", "room_slug", "user_id", userId, "room_slug"),
      allRows<{ room_slug: string; role: RoomRole }>("soundspin_room_members", "room_slug, role", "user_id", userId, "room_slug")
    ]);
    const validSlug = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9-]{3,48}$/.test(value);
    const favoriteSlugs = new Set(favorites.map((favorite) => favorite.room_slug).filter(validSlug));
    const roles = new Map(memberships.filter((member) => validSlug(member.room_slug)).map((member) => [member.room_slug, member.role]));
    const columns = "slug, name, owner_id, is_public, password_hash, settings, created_at, updated_at";
    type DirectoryRow = { slug: string; name: string; owner_id: string; is_public: boolean; password_hash: string | null; settings: Record<string, unknown> | null; created_at: string; updated_at: string };
    const lookupSlugs = [...new Set([...favoriteSlugs, ...roles.keys()])];
    const lookup = async () => {
      const found: DirectoryRow[] = [];
      for (let index = 0; index < lookupSlugs.length; index += 100) {
        const { data, error } = await supabase.from("soundspin_rooms").select(columns).in("slug", lookupSlugs.slice(index, index + 100));
        if (error) throw new Error(`Could not load your saved rooms: ${error.message}`);
        found.push(...(data || []) as DirectoryRow[]);
      }
      return found;
    };
    const [publicResult, owned, saved] = await Promise.all([
      supabase.from("soundspin_rooms").select(columns).eq("is_public", true).order("updated_at", { ascending: false }).limit(200),
      allRows<DirectoryRow>("soundspin_rooms", columns, "owner_id", userId, "slug"),
      lookup()
    ]);
    if (publicResult.error) throw new Error(`Could not load public rooms: ${publicResult.error.message}`);
    const rooms = [...new Map([...(publicResult.data || []) as DirectoryRow[], ...owned, ...saved].map((room) => [room.slug, room])).values()];

    return rooms
      // A stale favorite is not permission to disclose a revoked private room.
      .filter((room) => room.is_public || room.owner_id === userId || roles.has(room.slug))
      .sort((first, second) => second.updated_at.localeCompare(first.updated_at))
      .map((room): RoomDirectoryEntry => ({
        slug: room.slug,
        name: room.name,
        ownerId: room.owner_id,
        isPublic: room.is_public,
        passwordProtected: Boolean(room.password_hash),
        isFavorite: favoriteSlugs.has(room.slug),
        role: room.owner_id === userId ? "owner" : roles.get(room.slug) || null,
        listenerCount: listenerCounts[room.slug] || 0,
        createdAt: room.created_at,
        updatedAt: room.updated_at,
        description: typeof room.settings?.description === "string" ? room.settings.description.trim().slice(0, 240) : undefined
      }));
  }

  async createRoom(room: Room, passwordHash: string | null) {
    if (!this.supabase) {
      await this.enqueueWrite(async () => {
        if (this.getRoom(room.id)) throw new Error("That room address is already in use.");
        const roomPasswords = { ...this.data.roomPasswords, [room.id]: passwordHash };
        await writeFile(this.tempFile, JSON.stringify({ ...this.data, rooms: { ...this.data.rooms, [room.id]: room }, roomPasswords }, null, 2), "utf8");
        await rename(this.tempFile, this.dataFile);
        this.data.rooms[room.id] = room;
        this.data.roomPasswords = roomPasswords;
      });
      return;
    }
    const { error } = await this.supabase.from("soundspin_rooms").insert({
      slug: room.id,
      name: room.name,
      owner_id: room.ownerUserId,
      state: room,
      is_public: room.isPublic,
      password_hash: passwordHash,
      settings: room.settings,
      updated_at: new Date().toISOString()
    });
    if (error) {
      if (error.code === "23505") throw new Error("That room address is already in use.");
      throw new Error(`Could not create room: ${error.message}`);
    }
    this.data.rooms[room.id] = room;
  }

  async getRoomAccess(roomSlug: string, userId: string) {
    if (!this.supabase) {
      const room = this.getRoom(roomSlug);
      return room ? {
        exists: true,
        isPublic: room.isPublic ?? true,
        passwordHash: this.data.roomPasswords?.[roomSlug] || null,
        role: room.ownerUserId === userId ? "owner" as const : room.moderatorUserIds.includes(userId) ? "moderator" as const : room.djRoleUserIds.includes(userId) ? "dj" as const : null
      } : { exists: false, isPublic: false, passwordHash: null, role: null };
    }
    const [{ data: room, error }, { data: membership, error: membershipError }] = await Promise.all([
      this.supabase.from("soundspin_rooms").select("owner_id, is_public, password_hash").eq("slug", roomSlug).maybeSingle(),
      this.supabase.from("soundspin_room_members").select("role").eq("room_slug", roomSlug).eq("user_id", userId).maybeSingle()
    ]);
    if (error) throw new Error(`Could not check room access: ${error.message}`);
    if (membershipError) throw new Error(`Could not check room membership: ${membershipError.message}`);
    return {
      exists: Boolean(room),
      isPublic: room?.is_public ?? false,
      passwordHash: room?.password_hash || null,
      role: room?.owner_id === userId ? "owner" as const : (membership?.role as RoomRole | undefined) || null
    };
  }

  /** Caller supplies already-admitted live identities; never discover/add recipients here. */
  async allowedRoomReaders(roomSlug: string, userIds: string[]): Promise<Set<string>> {
    const ids = [...new Set(userIds.filter((id) => typeof id === "string" && id.length > 0 && id.length <= 100))];
    if (!ids.length) return new Set();
    if (!this.supabase) {
      const room = this.getRoom(roomSlug);
      if (!room) return new Set();
      if (room.isPublic) return new Set(ids);
      const roles = new Set([room.ownerUserId, ...room.moderatorUserIds, ...room.djRoleUserIds]);
      return new Set(ids.filter((id) => roles.has(id)));
    }
    // Deliberately bypass live-room cache: access can be revoked outside this process.
    const { data: metadata, error } = await this.supabase.from("soundspin_rooms").select("owner_id, is_public").eq("slug", roomSlug).maybeSingle();
    if (error) throw new Error(`Could not verify room readers: ${error.message}`);
    if (!metadata) return new Set();
    if (metadata.is_public) return new Set(ids);
    const allowed = new Set(ids.filter((id) => id === metadata.owner_id));
    const others = ids.filter((id) => id !== metadata.owner_id);
    for (let offset = 0; offset < others.length; offset += 100) {
      const batch = others.slice(offset, offset + 100);
      const { data, error: membershipError } = await this.supabase.from("soundspin_room_members").select("user_id").eq("room_slug", roomSlug).in("user_id", batch);
      if (membershipError) throw new Error(`Could not verify room readers: ${membershipError.message}`);
      for (const member of data || []) if (batch.includes(member.user_id)) allowed.add(member.user_id);
    }
    return allowed;
  }

  async recordRoomMember(roomSlug: string, userId: string) {
    if (!this.supabase) return;
    // Never downgrade an existing owner/moderator/DJ merely because they joined.
    const { error } = await this.supabase.from("soundspin_room_members").upsert(
      { room_slug: roomSlug, user_id: userId, role: "member", updated_at: new Date().toISOString() },
      { onConflict: "room_slug,user_id", ignoreDuplicates: true }
    );
    if (error) throw new Error(`Could not record room membership: ${error.message}`);
  }

  async setFavorite(roomSlug: string, userId: string, favorite: boolean) {
    if (!this.supabase) return;
    const query = favorite
      ? this.supabase.from("soundspin_room_favorites").upsert(
          { room_slug: roomSlug, user_id: userId },
          { onConflict: "room_slug,user_id" }
        )
      : this.supabase.from("soundspin_room_favorites").delete().eq("room_slug", roomSlug).eq("user_id", userId);
    const { error } = await query;
    if (error) throw new Error(`Could not update favorite: ${error.message}`);
  }

  async updateRoomSettings(
    roomSlug: string,
    userId: string,
    update: { name?: string; isPublic?: boolean; passwordHash?: string | null; djAccess?: DjAccess; description?: string }
  ) {
    if (update.description !== undefined && update.description.trim().length > 240) throw new RoomCommandError("Room descriptions can contain at most 240 characters.");
    const room = await this.loadRoom(roomSlug);
    if (!room) throw new RoomCommandError("This room no longer exists.");
    await this.changeRoom(room, async draft => {
      const access = await this.getRoomAccess(roomSlug, userId);
      if (access.role !== "owner" && access.role !== "moderator") throw new RoomCommandError("Only the owner or a moderator can change room settings.");
      const metadata: Record<string, unknown> = {};
      if (update.name !== undefined) { draft.name = update.name; metadata.name = update.name; }
      if (update.isPublic !== undefined) { draft.isPublic = update.isPublic; metadata.is_public = update.isPublic; }
      if (update.passwordHash !== undefined) { draft.passwordProtected = Boolean(update.passwordHash); metadata.password_hash = update.passwordHash; }
      if (update.djAccess !== undefined) draft.settings.djAccess = update.djAccess;
      if (update.description !== undefined) draft.settings.description = update.description.trim();
      if (update.djAccess !== undefined || update.description !== undefined) metadata.settings = draft.settings;
      pruneUnauthorizedDjs(draft);
      return { result: undefined, metadata };
    });
    return room;
  }

  private async verifyRoomOwner(roomSlug: string, userId: string) {
    if (!this.supabase) {
      if (this.getRoom(roomSlug)?.ownerUserId !== userId) throw new RoomCommandError("Only the room owner can manage room roles.");
      return;
    }
    const { data, error } = await this.supabase.from("soundspin_rooms").select("owner_id").eq("slug", roomSlug).single();
    if (error) throw new Error(`Could not verify room owner: ${error.message}`);
    if (data.owner_id !== userId) throw new RoomCommandError("Only the room owner can manage room roles.");
  }

  async setModerator(roomSlug: string, ownerUserId: string, targetUserId: string, moderator: boolean, authorize?: () => void) {
    await this.verifyRoomOwner(roomSlug, ownerUserId);
    if (targetUserId === ownerUserId) throw new RoomCommandError("The owner already has full room access.");
    const room = await this.loadRoom(roomSlug);
    if (!room) throw new RoomCommandError("This room no longer exists.");
    await this.changeRoom(room, async draft => {
      authorize?.();
      await this.verifyRoomOwner(roomSlug, ownerUserId);
      authorize?.();
      draft.moderatorUserIds = moderator ? [...new Set([...draft.moderatorUserIds, targetUserId])] : draft.moderatorUserIds.filter(id => id !== targetUserId);
      if (moderator) draft.djRoleUserIds = draft.djRoleUserIds.filter(id => id !== targetUserId);
      pruneUnauthorizedDjs(draft);
      return { result: undefined, member: { user_id: targetUserId, role: moderator ? "moderator" : "member" } };
    });
  }

  async setDjRole(roomSlug: string, ownerUserId: string, targetUserId: string, dj: boolean, authorize?: () => void) {
    await this.verifyRoomOwner(roomSlug, ownerUserId);
    if (targetUserId === ownerUserId) throw new RoomCommandError("The owner can always join the DJ queue.");
    const verifyTarget = async () => {
      if (this.supabase) {
        const { data, error } = await this.supabase.from("soundspin_room_members").select("role").eq("room_slug", roomSlug).eq("user_id", targetUserId).maybeSingle();
        if (error) throw new Error(`Could not verify target role: ${error.message}`);
        if (data?.role === "moderator") throw new RoomCommandError("Moderators can already join the DJ queue.");
      } else if (this.getRoom(roomSlug)?.moderatorUserIds.includes(targetUserId)) throw new RoomCommandError("Moderators can already join the DJ queue.");
    };
    await verifyTarget();
    const room = await this.loadRoom(roomSlug);
    if (!room) throw new RoomCommandError("This room no longer exists.");
    await this.changeRoom(room, async draft => {
      authorize?.();
      await this.verifyRoomOwner(roomSlug, ownerUserId); await verifyTarget();
      authorize?.();
      draft.djRoleUserIds = dj ? [...new Set([...draft.djRoleUserIds, targetUserId])] : draft.djRoleUserIds.filter(id => id !== targetUserId);
      pruneUnauthorizedDjs(draft);
      return { result: undefined, member: { user_id: targetUserId, role: dj ? "dj" : "member" } };
    });
  }
  async loadOrCreateProfile(userId: string, displayName: string) {
    if (!this.supabase) return null;
    const current = await this.getProfile(userId);
    if (current) return current;
    // A reconnect carries potentially stale browser profile data. Only seed a
    // missing profile; never reset a saved display name while joining a room.
    const { error } = await this.supabase
      .from("soundspin_profiles")
      .upsert(
        { user_id: userId, display_name: displayName, updated_at: new Date().toISOString() },
        { onConflict: "user_id", ignoreDuplicates: true }
      );
    if (error) throw new Error(`Could not load profile: ${error.message}`);
    const profile = await this.getProfile(userId);
    if (!profile) throw new Error("Could not load profile after creating it.");
    return profile;
  }

  async getProfile(userId: string) {
    if (!this.supabase) return null;
    const { data, error } = await this.supabase
      .from("soundspin_profiles")
      .select(PROFILE_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(`Could not load profile: ${error.message}`);
    return data as SoundSpinProfile | null;
  }

  async getProfileOptions() {
    if (!this.supabase) return [];
    const { data, error } = await this.supabase
      .from("soundspin_profile_options")
      .select("key, kind, name, metadata")
      .order("kind", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(`Could not load profile options: ${error.message}`);
    return (data || []) as SoundSpinProfileOption[];
  }

  async updateProfile(
    userId: string,
    update: {
      displayName?: string;
      bio?: string;
      avatarKey?: string;
      customAvatarPath?: string;
      themeKey?: string;
    }
  ) {
    if (!this.supabase) return null;
    const supabase = this.supabase;
    const current = await this.getProfile(userId);
    if (!current) throw new Error("Profile not found.");

    const validateOption = async (
      key: string,
      kind: SoundSpinProfileOption["kind"],
      missingMessage: string
    ) => {
      const { data: option, error } = await supabase
        .from("soundspin_profile_options")
        .select("key")
        .eq("key", key)
        .eq("kind", kind)
        .maybeSingle();
      if (error) throw new Error(`Could not validate ${kind}: ${error.message}`);
      if (!option) throw new Error(missingMessage);
    };

    if (update.avatarKey && update.avatarKey !== current.avatar_key) {
      await validateOption(update.avatarKey, "avatar", "That avatar does not exist.");
    }
    if (update.themeKey && update.themeKey !== current.theme_key) {
      await validateOption(update.themeKey, "theme", "That theme does not exist.");
    }

    let customAvatarUrl: string | undefined;
    if (update.customAvatarPath !== undefined) {
      const [folder, fileName, extra] = update.customAvatarPath.split("/");
      if (folder !== userId || !fileName || extra) throw new Error("That avatar upload is not yours.");
      const { data: objects, error } = await supabase.storage
        .from("profile-avatars")
        .list(userId, { search: fileName, limit: 10 });
      if (error) throw new Error(`Could not validate avatar upload: ${error.message}`);
      if (!objects?.some((object) => object.name === fileName)) throw new Error("That avatar upload was not found.");
      customAvatarUrl = supabase.storage.from("profile-avatars").getPublicUrl(update.customAvatarPath).data.publicUrl;
    }

    const values: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (update.displayName !== undefined) values.display_name = update.displayName;
    if (update.bio !== undefined) values.bio = update.bio;
    if (update.avatarKey !== undefined) {
      values.avatar_key = update.avatarKey;
      values.avatar_url = null;
      values.avatar_path = null;
    }
    if (update.customAvatarPath !== undefined) {
      values.avatar_url = customAvatarUrl;
      values.avatar_path = update.customAvatarPath;
    }
    if (update.themeKey !== undefined) values.theme_key = update.themeKey;

    const { data, error } = await supabase
      .from("soundspin_profiles")
      .update(values)
      .eq("user_id", userId)
      .select(PROFILE_COLUMNS)
      .single();
    if (error) throw new Error(`Could not update profile: ${error.message}`);
    return data as SoundSpinProfile;
  }

  /**
   * Bootstrap/fixture compatibility only: publishes the supplied object immediately.
   * All admitted mutations must use changeRoom to keep uncommitted state private.
   */
  saveRoom(room: Room) {
    this.data.rooms[room.id] = room;
    if (!this.supabase) return this.persistFile();
    // Capture this save now: callers keep mutating the authoritative room while
    // its preceding write is still in flight.
    const state = structuredClone(room);
    const supabase = this.supabase;
    return this.enqueueWrite(async () => {
      // Room creation/settings own the authoritative metadata columns. A radio
      // save must not revert them with an older copy captured before an edit.
      const { data, error } = await supabase.from("soundspin_rooms")
        .update({ state, updated_at: new Date().toISOString() })
        .eq("slug", state.id)
        .select("slug")
        .maybeSingle();
      if (error) {
        if (error.code === "PGRST205") {
          throw new Error(
            "Lydman database is not initialized. Deploy the migrations from GitHub or run the initial migration in the Supabase SQL editor."
          );
        }
        throw new Error(`Could not save room: ${error.message}`);
      }
      if (!data) throw new Error("Could not save room: the room no longer exists.");
    }, room.id);
  }

  /** Waits for writes already scheduled, for graceful server shutdown. */
  async flush() {
    await Promise.allSettled([...this.roomChanges.values()]);
    await Promise.all([this.writeChain, ...this.roomWrites.values()]);
  }

  private enqueueWrite(write: () => Promise<void>, roomId?: string) {
    const previous = roomId ? this.roomWrites.get(roomId) || Promise.resolve() : this.writeChain;
    const result = previous.then(write);
    // The caller still sees its failure. Future writes can recover after a
    // temporary database outage or a failed rename instead of staying poisoned.
    const recovered = result.catch(() => {});
    if (roomId) {
      this.roomWrites.set(roomId, recovered);
      void recovered.finally(() => { if (this.roomWrites.get(roomId) === recovered) this.roomWrites.delete(roomId); });
    } else this.writeChain = recovered;
    return result;
  }

  private persistFile() {
    // Room saves and provider credentials share one file and temporary path.
    // They must use the same write queue to avoid racing renames or losing data.
    return this.enqueueWrite(async () => {
      const serialized = JSON.stringify(this.data, null, 2);
      await writeFile(this.tempFile, serialized, "utf8");
      await rename(this.tempFile, this.dataFile);
    });
  }
}
