import { RoomCommandError } from "./socket-handler.js";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createBoundedAdminClient } from "./supabase-client.js";
import { ResourcePolicyStore } from "./resource-policy.js";
import { PublicRequestError, trustedSqlRequestError } from "./public-request-error.js";
import { profileUpdateSchema, type ProfileUpdate } from "./profile-fields.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { advanceRadio, normalizeRadioState, pruneUnauthorizedDjs } from "./radio.js";
import { roomAllowsProvider } from "../shared/providers.js";
import { allowedProvidersSchema, roomSettingsPatchSchema, authorizeRoomSettingsPatch, type RoomSettingsPatch } from "./room-settings.js";
import { accessMode } from "../shared/room-policy.js";
import { appendModerationLog, emptyModeration, ensureModeration, isRoomBanned, roleInRoom } from "./room-access.js";
import { runtimeMetrics } from "./runtime-metrics.js";
import { changePrivateLibrary, emptyLibrary, libraryMutationSchema, privateLibrarySchema, PrivateLibraryDataError, type LibraryMutation, type PrivateLibrary } from "./private-library.js";
import type {
  DjAccess,
  Provider,
  Room,
  RoomDirectoryEntry,
  RoomRole,
  MusicProviderConnection,
  SoundSpinProfile,
  SoundSpinProfileOption
} from "./types.js";
import type { RoomModerationState, RoomMemberRecord, User } from "./types.js";

const PROFILE_COLUMNS = "user_id, display_name, is_app_admin, bio, avatar_key, avatar_url, avatar_path, theme_key, created_at, updated_at, handle, status_text, favorite_tracks";
function resourceQuotaError(error:{code?:string;message:string}) {
  if(error.code!=="P0001")return undefined;
  const messages:Record<string,string>={
    "Room ownership limit reached":"Your room limit is reached. Remove an unused room before creating another.",
    "Room waiting queue limit reached":"This room's waiting queue is full. Remove tracks before adding more.",
    "Account waiting queue limit reached":"Your waiting queues are full. Remove tracks before adding more.",
    "Saved picks limit reached":"Your saved picks are full. Delete a pick before saving another.",
    "Saved sets limit reached":"Your saved sets are full. Delete a set before saving another.",
    "Set tracks limit reached":"This set has reached its track limit. Remove tracks before adding more.",
  };
  return Object.hasOwn(messages,error.message)?new PublicRequestError(messages[error.message],429):undefined;
}

interface Database {
  rooms: Record<string, Room>;
  roomPasswords?: Record<string, string | null>;
  musicConnections?: Record<string, MusicProviderConnection>;
  privateLibraries?: Record<string, PrivateLibrary>;
  favorites?: Record<string,string[]>;
}

interface StoreOptions {
  dataDir?: string;
  /** Explicit null selects local storage, including in isolated tests. */
  supabase?: SupabaseClient | null;
  maxCachedRooms?: number;
  maxCachedRoomBytes?: number;
  resourcePolicies?: ResourcePolicyStore;
}

export interface RoomChange<T> {
  result: T;
  /** Replays/no-op changes remain ordered but do not persist or broadcast. */
  unchanged?: boolean;
  /** Authoritative metadata and membership are committed in the same SQL transaction. */
  metadata?: Record<string, unknown>;
  member?: { user_id: string; role: RoomRole };
  memberDeletes?: string[];
  committed?: () => void;
  rejected?: () => void;
}

export class Store {
  readonly resourcePolicies: ResourcePolicyStore;
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
  private readonly maxCachedRooms: number;
  private readonly maxCachedRoomBytes: number;
  private roomBytes = new Map<string,number>();
  private roomPendingBytes = new Map<string,number>();
  private roomTouches = new Map<string, number>();
  private roomLoaded?: (roomId: string) => void;
  private roomPinned: (roomId: string) => boolean = () => false;
  private readyCheck: Promise<boolean> | null = null;
  private readyResult?: { value: boolean; expiresAt: number };

  constructor(options: StoreOptions = {}) {
    this.dataDir = options.dataDir || process.env.DATA_DIR || path.join(process.cwd(), "data");
    this.dataFile = path.join(this.dataDir, "soundspin.json");
    this.tempFile = path.join(this.dataDir, "soundspin.tmp.json");
    this.maxCachedRooms = options.maxCachedRooms ?? 500;
    this.maxCachedRoomBytes = options.maxCachedRoomBytes ?? 32 * 1024 * 1024;
    const url = process.env.SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if (options.supabase !== undefined) {
      this.supabase = options.supabase;
    } else if (url && secretKey) {
      this.supabase = createBoundedAdminClient();
    }
    this.resourcePolicies = options.resourcePolicies ?? new ResourcePolicyStore(this.supabase);
  }

  get usesSupabase() {
    return Boolean(this.supabase);
  }

  get cachedRoomCount() { return Object.keys(this.data.rooms).length; }
  get cachedRoomBytes() { return [...new Set([...this.roomBytes.keys(),...this.roomPendingBytes.keys()])].reduce((sum,id)=>sum+Math.max(this.roomBytes.get(id)??0,this.roomPendingBytes.get(id)??0),0); }
  /** Snapshot includes offline sessions; live presence is not a cache inventory. */
  getCachedRooms(): readonly Room[] { return Object.values(this.data.rooms); }

  setRoomCacheHooks(loaded: (roomId: string) => void, pinned: (roomId: string) => boolean) {
    this.roomLoaded = loaded; this.roomPinned = pinned;
  }

  private touchRoom(id: string) { this.roomTouches.set(id, Date.now()); this.roomLoaded?.(id); }
  private reserveRoomCapacity(id: string) {
    if (this.getRoom(id) || this.roomLoads.has(id)) return;
    const reservedCount=()=>this.cachedRoomCount+[...new Set([...this.roomLoads.keys(),...this.roomPendingBytes.keys()])].filter(key=>!this.getRoom(key)).length;
    if (reservedCount() < this.maxCachedRooms) return;
    for (const [candidate] of [...this.roomTouches].sort((a,b)=>a[1]-b[1])) {
      if (!this.roomPinned(candidate) && this.releaseRoom(candidate) && reservedCount() < this.maxCachedRooms) return;
    }
    throw new RoomCommandError("The room service is busy. Try again shortly.");
  }
  private reserveRoomBytes(id:string,room:Room) {
    const size=Buffer.byteLength(JSON.stringify(room));
    if(size>8*1024*1024)throw new RoomCommandError("This room has reached its state size limit. Remove unused queue entries.");
    for(const [candidate] of [...this.roomTouches].sort((a,b)=>a[1]-b[1])) {
      if(this.cachedRoomBytes-(this.roomBytes.get(id)??0)+size<=this.maxCachedRoomBytes)break;
      if(candidate!==id&&!this.roomPinned(candidate))this.releaseRoom(candidate);
    }
    if(this.cachedRoomBytes-(this.roomBytes.get(id)??0)+size>this.maxCachedRoomBytes)throw new RoomCommandError("The room service is busy. Try again shortly.");
    return size;
  }

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
  withRoomOperation<T>(roomId: string, operation: () => Promise<T>): Promise<T> {
    const queued = this.queuedRoomChanges.get(roomId) || 0;
    if (queued >= 100) return Promise.reject(new Error("Too many room changes are pending. Try again shortly."));
    this.queuedRoomChanges.set(roomId, queued + 1);
    runtimeMetrics.pendingRoomCommands++;
    const previous = this.roomChanges.get(roomId) || Promise.resolve();
    const result = previous.catch(() => {}).then(operation);
    this.roomChanges.set(roomId, result);
    void result.finally(() => {
      runtimeMetrics.pendingRoomCommands--;
      const remaining = (this.queuedRoomChanges.get(roomId) || 1) - 1;
      if (remaining) this.queuedRoomChanges.set(roomId, remaining); else this.queuedRoomChanges.delete(roomId);
      if (this.roomChanges.get(roomId) === result) this.roomChanges.delete(roomId);
    }).catch(() => {});
    return result;
  }

  changeRoom<T>(room: Room, operation: (draft: Room) => RoomChange<T> | Promise<RoomChange<T>>): Promise<T> {
    return this.withRoomOperation(room.id, async () => {
      const started = performance.now();
      let change: RoomChange<T> | undefined;
      try {
        if (this.getRoom(room.id) !== room) throw new Error("This room session changed. Join the room again.");
        const draft = structuredClone(room);
        change = await operation(draft);
        change.unchanged ??= !change.metadata && !change.member && !change.memberDeletes?.length && JSON.stringify(draft) === JSON.stringify(room);
        if (!change.unchanged) await this.commitRoom(room, draft, change);
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
  }

  private async commitRoom(current: Room, draft: Room, change: RoomChange<unknown>) {
    const started = performance.now();
    try {
      await this.checkQueueGrowth(current,draft);
      const size=this.reserveRoomBytes(draft.id,draft);
      this.roomPendingBytes.set(draft.id,size);
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
        const { moderation: _privateModeration, ...state } = draft;
        const privateChanged = JSON.stringify(current.moderation) !== JSON.stringify(draft.moderation);
        await this.enqueueWrite(async () => {
          if (privateChanged || change.memberDeletes?.length || change.metadata?.access_mode !== undefined || change.metadata?.policy_revision !== undefined) {
            const { data, error } = await supabase.rpc("soundspin_commit_room_v2", {
              p_slug: draft.id, p_state: state, p_metadata: change.metadata || {}, p_member: change.member || null,
              p_member_deletes: change.memberDeletes || [], p_moderation: draft.moderation || emptyModeration()
            });
            if (error) throw resourceQuotaError(error)??new Error(`Could not save room: ${error.message}`);
            if (!data) throw new Error("Could not save room: the room no longer exists.");
          } else if (change.member || change.metadata) {
            const { data, error } = await supabase.rpc("soundspin_commit_room", {
              p_slug: draft.id, p_state: state, p_metadata: change.metadata || {}, p_member: change.member || null
            });
            if (error) throw resourceQuotaError(error)??new Error(`Could not save room: ${error.message}`);
            if (!data) throw new Error("Could not save room: the room no longer exists.");
          } else {
            const { data, error } = await supabase.from("soundspin_rooms").update({ state, updated_at: new Date().toISOString() })
              .eq("slug", draft.id).select("slug").maybeSingle();
            if (error) throw resourceQuotaError(error)??new Error(`Could not save room: ${error.message}`);
            if (!data) throw new Error("Could not save room: the room no longer exists.");
          }
          Object.assign(current, draft);
        }, draft.id);
      }
      this.roomBytes.set(draft.id,size);
      runtimeMetrics.observe("room_save", performance.now() - started);
    } catch (error) {
      runtimeMetrics.observe("room_save", performance.now() - started, true);
      throw error;
    } finally {
      this.roomPendingBytes.delete(draft.id);
    }
  }

  private async checkQueueGrowth(current:Room,draft:Room) {
    const entries=Object.entries(draft.djQueues??{});
    const total=entries.reduce((sum,[,tracks])=>sum+tracks.length,0);
    const previousTotal=Object.values(current.djQueues??{}).reduce((sum,tracks)=>sum+tracks.length,0);
    if(total>previousTotal && total>(await this.resourcePolicies.getGlobal()).queueTracksPerRoom)throw new RoomCommandError("This room's waiting queue is full. Remove tracks before adding more.");
    for(const [actor,tracks] of entries) {
      if(tracks.length<=(current.djQueues?.[actor]?.length??0))continue;
      const {limits}=await this.resourcePolicies.get(actor);
      if(tracks.length>limits.queueTracksPerRoom)throw new RoomCommandError("Your waiting queue is full. Remove tracks before adding more.");
      if(!this.supabase) {
        const other=Object.values(this.data.rooms).filter(room=>room.id!==draft.id).reduce((sum,room)=>sum+(room.djQueues?.[actor]?.length??0),0);
        if(other+tracks.length>limits.queueTracksTotal)throw new RoomCommandError("Your waiting queues are full. Remove tracks before adding more.");
      }
    }
  }

  /** Supabase is durable storage, so inactive process cache entries can be released. */
  releaseRoom(id: string) {
    if (!this.supabase || this.roomChanges.has(id) || this.roomWrites.has(id)) return false;
    delete this.data.rooms[id];
    this.roomTouches.delete(id);
    this.roomBytes.delete(id);
    return true;
  }

  /** Approved account erasure shares each room's mutation queue and replaces
   * its cached document before another command can persist stale identities. */
  async eraseAccountRoomData(userId: string, onRoomErased?: (room: Room) => void): Promise<void> {
    if (!this.supabase || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId))
      throw new Error("Account room cleanup requires configured secure storage.");
    const started = Date.now();
    let after: string | null = null;
    const verifyComplete = async () => {
      const remaining = await this.supabase!.rpc("soundspin_moderation_actor_rooms", { p_user: userId, p_after: null, p_limit: 1 }).abortSignal(AbortSignal.timeout(5_000));
      if (remaining.error || !Array.isArray(remaining.data) || remaining.data.length)
        throw new Error("Account room cleanup remains pending. Retry the deletion job.");
    };
    for (let page = 0; page < 20; page++) {
      if (Date.now() - started > 20_000) throw new Error("Account room cleanup remains pending. Retry the deletion job.");
      const listing = await this.supabase.rpc("soundspin_moderation_actor_rooms", { p_user: userId, p_after: after, p_limit: 50 }).abortSignal(AbortSignal.timeout(5_000));
      if (listing.error || !Array.isArray(listing.data) || listing.data.length > 50 || listing.data.some((id, index, ids) => typeof id !== "string" || !/^[a-z0-9-]{3,48}$/.test(id) || (index > 0 && id <= ids[index-1]) || (after !== null && id <= after)))
        throw new Error("Account room cleanup could not be inventoried.");
      const ids = listing.data as string[];
      if (!ids.length) return verifyComplete();
      for (const roomId of ids) {
        if (Date.now() - started > 20_000) throw new Error("Account room cleanup remains pending. Retry the deletion job.");
        // Coalesce an already-running load before erasure; it must not cache a
        // document read before the SQL scrub after this operation finishes.
        await this.loadRoom(roomId);
        await this.withRoomOperation(roomId, async () => {
          const current = this.getRoom(roomId);
          const erased = await this.supabase!.rpc("soundspin_erase_live_moderation_account", { p_room: roomId, p_user: userId }).abortSignal(AbortSignal.timeout(5_000));
          if (erased.error) throw new Error("Account room cleanup remains pending. Retry the deletion job.");
          if (erased.data === null) { delete this.data.rooms[roomId]; this.roomTouches.delete(roomId); this.roomBytes.delete(roomId); return; }
          const result = erased.data as { state?: unknown; moderation?: unknown };
          if (!result.state || typeof result.state !== "object" || Array.isArray(result.state) || !result.moderation || typeof result.moderation !== "object" || Array.isArray(result.moderation)) {
            delete this.data.rooms[roomId]; this.roomTouches.delete(roomId); this.roomBytes.delete(roomId);
            throw new Error("Account room cleanup returned an invalid document.");
          }
          if (!current) return;
          const state = result.state as Partial<Room>;
          const next = { ...state, id: current.id, name: current.name, ownerUserId: current.ownerUserId,
            moderatorUserIds: current.moderatorUserIds.filter(id => id !== userId), djRoleUserIds: current.djRoleUserIds.filter(id => id !== userId),
            isPublic: current.isPublic, passwordProtected: current.passwordProtected, createdAt: current.createdAt,
            policyRevision: current.policyRevision, settings: state.settings || current.settings,
            moderation: { ...emptyModeration(), ...result.moderation as RoomModerationState } } as Room;
          let size: number;
          try { normalizeRadioState(next); size = this.reserveRoomBytes(roomId, next); }
          catch (error) { delete this.data.rooms[roomId]; this.roomTouches.delete(roomId); this.roomBytes.delete(roomId); throw error; }
          for (const key of Object.keys(current)) delete (current as unknown as Record<string, unknown>)[key];
          Object.assign(current, next);
          this.roomBytes.set(roomId, size);
          this.touchRoom(roomId);
          onRoomErased?.(current);
        });
      }
      after = ids.at(-1)!;
      if (ids.length < 50) return verifyComplete();
    }
    await verifyComplete();
  }

  async isReady() {
    if (!this.supabase) return true;
    if (this.readyResult && this.readyResult.expiresAt > Date.now()) return this.readyResult.value;
    if (this.readyCheck) return this.readyCheck;
    const operation = (async () => {
      const { error } = await this.supabase!.from("soundspin_rooms").select("slug").limit(0).abortSignal(AbortSignal.timeout(5_000));
      const value = !error;
      this.readyResult = { value, expiresAt: Date.now() + (value ? 5000 : 1000) };
      return value;
    })();
    this.readyCheck = operation;
    try { return await operation; } finally { if (this.readyCheck === operation) this.readyCheck = null; }
  }

  async getPrivateLibrary(userId: string): Promise<PrivateLibrary> {
    if (!this.supabase) return structuredClone(this.data.privateLibraries && Object.hasOwn(this.data.privateLibraries, userId) ? this.data.privateLibraries[userId] : emptyLibrary());
    const { data, error } = await this.supabase.from("soundspin_private_libraries").select("data, revision").eq("user_id", userId).maybeSingle();
    if (error) throw new Error(`Could not load private picks and sets: ${error.message}`);
    if (!data) return emptyLibrary();
    const parsed = privateLibrarySchema.safeParse(data.data);
    if (!parsed.success || !Number.isSafeInteger(Number(data.revision)) || Number(data.revision) < 1) throw new PrivateLibraryDataError();
    return parsed.data;
  }

  /** Per-owner ordering plus database revision checks prevent lost concurrent-tab edits. */
  updatePrivateLibrary(userId: string, value: LibraryMutation): Promise<PrivateLibrary> {
    const mutation = libraryMutationSchema.parse(value);
    const previous = this.libraryWrites.get(userId);
    const operation = (previous ? previous.catch(() => emptyLibrary()) : Promise.resolve(emptyLibrary())).then(async () => {
      const {limits}=await this.resourcePolicies.get(userId);
      if (!this.supabase) {
        this.data.privateLibraries ||= {};
        const before = this.data.privateLibraries[userId];
        const next = mutation.type === "clear-library" ? emptyLibrary() : changePrivateLibrary(before || emptyLibrary(), mutation,Date.now(),limits);
        Object.defineProperty(this.data.privateLibraries, userId, { value: next, writable: true, enumerable: true, configurable: true });
        try { await this.persistFile(); }
        catch (error) { if (before) this.data.privateLibraries[userId] = before; else delete this.data.privateLibraries[userId]; throw error; }
        return structuredClone(next);
      }
      const supabase = this.supabase;
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data, error } = await supabase.from("soundspin_private_libraries").select("data, revision").eq("user_id", userId).maybeSingle();
        if (error) throw new Error(`Could not load private picks and sets: ${error.message}`);
        const parsed = data ? privateLibrarySchema.safeParse(data.data) : null;
        const validRevision = !data || (Number.isSafeInteger(Number(data.revision)) && Number(data.revision) >= 1 && Number(data.revision) < Number.MAX_SAFE_INTEGER);
        if (mutation.type !== "clear-library" && ((!parsed?.success && data) || !validRevision)) throw new PrivateLibraryDataError();
        const next = mutation.type === "clear-library" ? emptyLibrary() : changePrivateLibrary(parsed?.success ? parsed.data : emptyLibrary(), mutation,Date.now(),limits);
        if (!data) {
          const insert = await supabase.from("soundspin_private_libraries").insert({ user_id: userId, data: next, revision: 1 });
          if (!insert.error) return next;
          if (insert.error.code === "23505") continue;
          throw resourceQuotaError(insert.error)??new Error(`Could not save private picks and sets: ${insert.error.message}`);
        }
        const revision = validRevision ? Number(data.revision) + 1 : 1;
        const update = await supabase.from("soundspin_private_libraries").update({ data: next, revision, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("revision", data.revision).select("revision").maybeSingle();
        if (update.error) throw resourceQuotaError(update.error)??new Error(`Could not save private picks and sets: ${update.error.message}`);
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
    if (cached) { this.touchRoom(id); return cached; }
    if (!this.supabase) return undefined;

    // All sockets must coordinate through the same live object. A second load
    // must not replace it while the first join is already mutating it.
    const pending = this.roomLoads.get(id);
    if (pending) return pending;
    this.reserveRoomCapacity(id);
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
      .select("state, name, owner_id, is_public, password_hash, settings, access_mode, policy_revision")
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
    const { data: privateData, error: privateError } = await supabase.from("soundspin_room_moderation").select("data").eq("room_slug", id).maybeSingle();
    if (privateError) throw new Error(`Could not load room restrictions: ${privateError.message}`);

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
      isPublic: (data.access_mode ?? (data.is_public ? "public" : "members")) !== "members",
      passwordProtected: Boolean(data.password_hash),
      settings: { ...(data.settings || {}), accessMode: data.access_mode ?? data.settings?.accessMode ?? (data.is_public ? "public" : "members") },
      policyRevision: data.policy_revision ?? (data.state as Room)?.policyRevision ?? 0,
      moderation: { ...emptyModeration(), ...(privateData?.data as Partial<RoomModerationState> || {}) }
    };
    normalizeRadioState(room);
    // A creator may have populated the cache while this read was in flight.
    const cached = this.getRoom(id);
    if (cached) return cached;
    const size=this.reserveRoomBytes(id,room);
    this.data.rooms[id] = room;
    this.roomBytes.set(id,size);
    this.touchRoom(id);
    return room;
  }

  async listSessionRooms(): Promise<Room[]> {
    if (!this.supabase) return Object.values(this.data.rooms).filter(room => Boolean(room.settings.themeSchedules?.length || room.radioState?.fallback.enabled));
    const rooms: Room[] = [];
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await this.supabase.from("soundspin_rooms").select("slug").eq("session_active", true).order("slug").range(offset, offset + 99);
      if (error) throw new Error(`Could not load room sessions: ${error.message}`);
      const batch: Array<Room|undefined>=new Array(data?.length??0);
      let index=0;
      await Promise.all(Array.from({length:Math.min(8,data?.length??0)},async()=>{
        while(index<(data?.length??0)){const position=index++;batch[position]=await this.loadRoom(data![position].slug);}
      }));
      rooms.push(...batch.filter((room): room is Room => Boolean(room)));
      if (!data || data.length < 100) return rooms;
    }
  }

  async listRooms(userId: string, listenerCounts: Record<string, number>) {
    if (!this.supabase) {
      return Object.values(this.data.rooms).filter(room => !isRoomBanned(room, userId) && (accessMode(room) === "public" || Boolean(roleInRoom(room, userId)))).map((room): RoomDirectoryEntry => ({
        slug: room.id,
        name: room.name,
        ownerId: room.ownerUserId,
        isPublic: room.isPublic ?? true,
        accessMode: accessMode(room),
        passwordProtected: room.passwordProtected ?? false,
        isFavorite: this.data.favorites?.[userId]?.includes(room.id)??false,
        role: roleInRoom(room, userId),
        listenerCount: listenerCounts[room.id] || 0,
        createdAt: new Date(room.createdAt).toISOString(),
        updatedAt: new Date(room.createdAt).toISOString(),
        description: typeof room.settings.description === "string" ? room.settings.description.trim().slice(0, 240) : undefined,
        tags: room.settings.tags, language: room.settings.language
      }));
    }

    const supabase = this.supabase;
    const allRows = async <T>(table: string, columns: string, filterColumn: string, filterValue: string, orderColumn: string) => {
      const rows: T[] = [];
      for (let offset = 0; offset<1000; offset += 500) {
        const { data, error } = await supabase.from(table).select(columns).eq(filterColumn, filterValue).order(orderColumn).range(offset, offset + 499);
        if (error) throw new Error(`Could not load your room directory: ${error.message}`);
        rows.push(...(data || []) as unknown as T[]);
        if (!data || data.length < 500) return rows;
      }
      return rows;
    };
    const [favorites, memberships] = await Promise.all([
      allRows<{ room_slug: string }>("soundspin_room_favorites", "room_slug", "user_id", userId, "room_slug"),
      allRows<{ room_slug: string; role: RoomRole }>("soundspin_room_members", "room_slug, role", "user_id", userId, "room_slug")
    ]);
    const validSlug = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9-]{3,48}$/.test(value);
    const favoriteSlugs = new Set(favorites.map((favorite) => favorite.room_slug).filter(validSlug));
    const roles = new Map(memberships.filter((member) => validSlug(member.room_slug)).map((member) => [member.room_slug, member.role]));
    const columns = "slug, name, owner_id, is_public, password_hash, settings, created_at, updated_at, access_mode";
    type DirectoryRow = { slug: string; name: string; owner_id: string; is_public: boolean; password_hash: string | null; settings: Room["settings"] | null; created_at: string; updated_at: string; access_mode?: "public" | "unlisted" | "members" };
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
      supabase.from("soundspin_rooms").select(columns).eq("access_mode", "public").order("updated_at", { ascending: false }).limit(200),
      allRows<DirectoryRow>("soundspin_rooms", columns, "owner_id", userId, "slug"),
      lookup()
    ]);
    if (publicResult.error) throw new Error(`Could not load public rooms: ${publicResult.error.message}`);
    const rooms = [...new Map([...(publicResult.data || []) as DirectoryRow[], ...owned, ...saved].map((room) => [room.slug, room])).values()];
    const banned = new Set<string>();
    const owners=new Set(rooms.map(room=>room.owner_id)),disabledOwners=new Set<string>();
    for(const batchStart of Array.from({length:Math.ceil(owners.size/100)},(_,index)=>index*100)){
      const {data,error}=await supabase.from("soundspin_account_restrictions").select("user_id,state").in("user_id",[...owners].slice(batchStart,batchStart+100));
      if(error)throw new Error("Could not verify room owners.");
      for(const entry of data||[])if(entry.state!=="active")disabledOwners.add(entry.user_id);
    }
    for (let offset = 0; offset < rooms.length; offset += 100) {
      const restrictionResult=await supabase.from("soundspin_room_restrictions").select("room_slug,disabled").in("room_slug",rooms.slice(offset,offset+100).map(room=>room.slug));
      if(restrictionResult.error)throw new Error("Could not verify platform room restrictions.");
      for(const entry of restrictionResult.data||[])if(entry.disabled)banned.add(entry.room_slug);
      const { data, error } = await supabase.from("soundspin_room_moderation").select("room_slug,data").in("room_slug", rooms.slice(offset, offset + 100).map(room => room.slug));
      if (error) throw new Error(`Could not verify room restrictions: ${error.message}`);
      for (const entry of data || []) if ((entry.data as RoomModerationState)?.restrictions?.some(item => item.userId === userId && item.kind === "room-ban" && item.revokedAt === null && (item.expiresAt === null || item.expiresAt > Date.now()))) banned.add(entry.room_slug);
    }

    return rooms
      // A stale favorite is not permission to disclose a revoked private room.
      .filter((room) => !disabledOwners.has(room.owner_id)&&!banned.has(room.slug) && ((room.access_mode ?? (room.is_public ? "public" : "members")) === "public" || room.owner_id === userId || roles.has(room.slug) || (room.access_mode === "unlisted" && favoriteSlugs.has(room.slug))))
      .sort((first, second) => second.updated_at.localeCompare(first.updated_at))
      .map((room): RoomDirectoryEntry => ({
        slug: room.slug,
        name: room.name,
        ownerId: room.owner_id,
        isPublic: room.is_public,
        accessMode: room.access_mode ?? (room.is_public ? "public" : "members"),
        passwordProtected: Boolean(room.password_hash),
        isFavorite: favoriteSlugs.has(room.slug),
        role: room.owner_id === userId ? "owner" : roles.get(room.slug) || null,
        listenerCount: listenerCounts[room.slug] || 0,
        createdAt: room.created_at,
        updatedAt: room.updated_at,
        description: typeof room.settings?.description === "string" ? room.settings.description.trim().slice(0, 240) : undefined,
        tags: room.settings?.tags, language: room.settings?.language
      }));
  }

  async createRoom(room: Room, passwordHash: string | null) {
    const {limits}=await this.resourcePolicies.get(room.ownerUserId);
    if (!this.supabase) {
      await this.enqueueWrite(async () => {
        if (this.getRoom(room.id)) throw new Error("That room address is already in use.");
        if (Object.values(this.data.rooms).filter(item=>item.ownerUserId===room.ownerUserId).length >= limits.ownedRooms) throw new RoomCommandError("Your room limit is reached. Remove an unused room before creating another.");
        const roomPasswords = { ...this.data.roomPasswords, [room.id]: passwordHash };
        await writeFile(this.tempFile, JSON.stringify({ ...this.data, rooms: { ...this.data.rooms, [room.id]: room }, roomPasswords }, null, 2), "utf8");
        await rename(this.tempFile, this.dataFile);
        this.data.rooms[room.id] = room;
        this.data.roomPasswords = roomPasswords;
      });
      return;
    }
    this.reserveRoomCapacity(room.id);
    const size=this.reserveRoomBytes(room.id,room);
    this.roomPendingBytes.set(room.id,size);
    let error;
    try { ({error}=await this.supabase.from("soundspin_rooms").insert({
      slug: room.id,
      name: room.name,
      owner_id: room.ownerUserId,
      state: (({ moderation: _private, ...state }) => state)(room),
      is_public: room.isPublic,
      password_hash: passwordHash,
      settings: room.settings,
      access_mode: accessMode(room), policy_revision: room.policyRevision ?? 0,
      updated_at: new Date().toISOString()
    })); } catch(cause){this.roomPendingBytes.delete(room.id);throw cause;}
    this.roomPendingBytes.delete(room.id);
    if (error) {
      if (error.code === "23505") throw new Error("That room address is already in use.");
      throw resourceQuotaError(error)??new Error(`Could not create room: ${error.message}`);
    }
    this.data.rooms[room.id] = room;
    this.roomBytes.set(room.id,size);
    this.touchRoom(room.id);
  }

  /** Final grant and live registration share the same order as access revocation. */
  async admitRoom(room: Room, user: User, expectedPasswordHash: string | null,
    assertActive: () => void, register: () => void) {
    return this.withRoomOperation(room.id, async () => {
      assertActive();
      if (this.getRoom(room.id) !== room) throw new RoomCommandError("This room session changed. Join again.");
      const access = await this.getRoomAccess(room.id,user.id);
      if (!access.exists || access.banned || (!access.isPublic && !access.role)) throw new RoomCommandError("You no longer have access to this room.");
      if (access.passwordHash !== expectedPasswordHash) throw new RoomCommandError("The room password changed. Join again.");
      let role: RoomRole = access.role ?? "member";
      if (this.supabase) {
        const {data,error} = await this.supabase.rpc("soundspin_admit_room", {
          p_slug:room.id,p_user_id:user.id,p_password_hash:expectedPasswordHash
        });
        if (error || !data) throw new RoomCommandError("Room access changed. Join again.");
        if (!data.role || !["owner","moderator","dj","member"].includes(data.role)) throw new Error("Invalid admission response.");
        role=data.role;
      } else if(access.role) {
        const draft=structuredClone(room),state=ensureModeration(draft),member=state.members[user.id];
        state.members[user.id]={user,role,joinedAt:member?.joinedAt??Date.now()};
        await this.commitRoom(room,draft,{result:undefined});
      }
      // Cache membership for synchronous command guards, after the authoritative grant.
      if(access.role) {
        const state=ensureModeration(room),member=state.members[user.id];
        state.members[user.id]={user,role,joinedAt:member?.joinedAt??Date.now()};
      }
      assertActive();
      register(); // Synchronous: a subsequent removal must observe and revoke this admission.
      this.touchRoom(room.id);
      return role;
    });
  }

  async getRoomAccess(roomSlug: string, userId: string) {
    if (!this.supabase) {
      const room = this.getRoom(roomSlug);
      return room ? {
        exists: true,
        isPublic: accessMode(room) !== "members",
        passwordHash: this.data.roomPasswords?.[roomSlug] || null,
        role: roleInRoom(room, userId), banned: isRoomBanned(room, userId), accessMode: accessMode(room), settings: room.settings
      } : { exists: false, isPublic: false, passwordHash: null, role: null, banned: false, accessMode: "members" as const, settings: {} };
    }
    const [{ data: room, error }, { data: membership, error: membershipError }, { data: privateData, error: privateError }] = await Promise.all([
      this.supabase.from("soundspin_rooms").select("owner_id, is_public, password_hash, access_mode, settings").eq("slug", roomSlug).maybeSingle(),
      this.supabase.from("soundspin_room_members").select("role").eq("room_slug", roomSlug).eq("user_id", userId).maybeSingle(),
      this.supabase.from("soundspin_room_moderation").select("data").eq("room_slug", roomSlug).maybeSingle()
    ]);
    if (error) throw new Error(`Could not check room access: ${error.message}`);
    if (membershipError) throw new Error(`Could not check room membership: ${membershipError.message}`);
    if (privateError) throw new Error(`Could not check room restrictions: ${privateError.message}`);
    const mode = room?.access_mode ?? (room?.is_public ? "public" : "members");
    const banned = Boolean((privateData?.data as RoomModerationState)?.restrictions?.some(item => item.userId === userId && item.kind === "room-ban" && item.revokedAt === null && (item.expiresAt === null || item.expiresAt > Date.now())));
    return {
      exists: Boolean(room),
      isPublic: mode !== "members",
      passwordHash: room?.password_hash || null,
      role: room?.owner_id === userId ? "owner" as const : (membership?.role as RoomRole | undefined) || null,
      banned, accessMode: mode as "public" | "unlisted" | "members", settings: (room?.settings || {}) as Room["settings"]
    };
  }

  /** Caller supplies already-admitted live identities; never discover/add recipients here. */
  async allowedRoomReaders(roomSlug: string, userIds: string[]): Promise<Set<string>> {
    const ids = [...new Set(userIds.filter((id) => typeof id === "string" && id.length > 0 && id.length <= 100))];
    if (!ids.length) return new Set();
    if (!this.supabase) {
      const room = this.getRoom(roomSlug);
      if (!room) return new Set();
      return new Set(ids.filter(id => !isRoomBanned(room, id) && (accessMode(room) !== "members" || Boolean(roleInRoom(room, id)))));
    }
    // Deliberately bypass live-room cache: access can be revoked outside this process.
    const [{ data: metadata, error }, { data: privateData, error: privateError },roomRestriction] = await Promise.all([
      this.supabase.from("soundspin_rooms").select("owner_id, is_public, access_mode").eq("slug", roomSlug).maybeSingle(),
      this.supabase.from("soundspin_room_moderation").select("data").eq("room_slug", roomSlug).maybeSingle(),
      this.supabase.from("soundspin_room_restrictions").select("disabled").eq("room_slug",roomSlug).maybeSingle()
    ]);
    if (error) throw new Error(`Could not verify room readers: ${error.message}`);
    if (!metadata) return new Set();
    if (privateError) throw new Error(`Could not verify room restrictions: ${privateError.message}`);
    if(roomRestriction.error)throw new Error("Could not verify platform room restrictions.");
    if(roomRestriction.data?.disabled)return new Set();
    const disabledAccounts=new Set<string>();
    const accountIds=[...new Set([...ids,metadata.owner_id])];
    for(let offset=0;offset<accountIds.length;offset+=100){
      const accountResult=await this.supabase.from("soundspin_account_restrictions").select("user_id,state").in("user_id",accountIds.slice(offset,offset+100));
      if(accountResult.error)throw new Error("Could not verify account restrictions.");
      for(const entry of accountResult.data||[])if(entry.state!=="active")disabledAccounts.add(entry.user_id);
    }
    if(disabledAccounts.has(metadata.owner_id))return new Set();
    const restrictions = (privateData?.data as RoomModerationState)?.restrictions || [];
    const eligible = ids.filter(id => !disabledAccounts.has(id)&&!restrictions.some(item => item.userId === id && item.kind === "room-ban" && item.revokedAt === null && (item.expiresAt === null || item.expiresAt > Date.now())));
    if ((metadata.access_mode ?? (metadata.is_public ? "public" : "members")) !== "members") return new Set(eligible);
    const allowed = new Set(eligible.filter((id) => id === metadata.owner_id));
    const others = eligible.filter((id) => id !== metadata.owner_id);
    for (let offset = 0; offset < others.length; offset += 100) {
      const batch = others.slice(offset, offset + 100);
      const { data, error: membershipError } = await this.supabase.from("soundspin_room_members").select("user_id").eq("room_slug", roomSlug).in("user_id", batch);
      if (membershipError) throw new Error(`Could not verify room readers: ${membershipError.message}`);
      for (const member of data || []) if (batch.includes(member.user_id)) allowed.add(member.user_id);
    }
    return allowed;
  }

  async recordRoomMember(roomSlug: string, userId: string, user?: User) {
    if (!this.supabase) {
      const room = this.getRoom(roomSlug);
      if (!room) return;
      await this.changeRoom(room, draft => {
        const state = ensureModeration(draft), current = state.members[userId];
        state.members[userId] = { user: user || current?.user || { id: userId, name: "Listener", avatarSeed: userId }, role: roleInRoom(draft, userId) || "member", joinedAt: current?.joinedAt || Date.now() };
        return { result: undefined };
      });
      return;
    }
    // Never downgrade an existing owner/moderator/DJ merely because they joined.
    const { error } = await this.supabase.from("soundspin_room_members").upsert(
      { room_slug: roomSlug, user_id: userId, role: "member", updated_at: new Date().toISOString() },
      { onConflict: "room_slug,user_id", ignoreDuplicates: true }
    );
    if (error) throw new Error(`Could not record room membership: ${error.message}`);
  }

  async listRoomMembers(roomSlug: string): Promise<RoomMemberRecord[]> {
    const room = await this.loadRoom(roomSlug);
    if (!room) return [];
    if (!this.supabase) {
      const members = new Map(Object.entries(room.moderation?.members || {}).map(([id, item]) => [id, { ...item, role: roleInRoom(room, id) || item.role }]));
      for (const id of [room.ownerUserId, ...room.moderatorUserIds, ...room.djRoleUserIds]) if (!members.has(id)) members.set(id, { user: { id, name: id, avatarSeed: id }, role: roleInRoom(room, id)!, joinedAt: room.createdAt });
      return [...members.values()];
    }
    const rows: Array<{ user_id: string; role: RoomRole; joined_at: string }> = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await this.supabase.from("soundspin_room_members").select("user_id,role,joined_at").eq("room_slug", roomSlug).order("user_id").range(offset, offset + 499);
      if (error) throw new Error(`Could not load room members: ${error.message}`);
      rows.push(...(data || []) as typeof rows);
      if (!data || data.length < 500) break;
    }
    const profiles = new Map<string, User>();
    for (let offset = 0; offset < rows.length; offset += 100) {
      const { data, error } = await this.supabase.from("soundspin_profiles").select("user_id,display_name,avatar_key,avatar_url").in("user_id", rows.slice(offset, offset + 100).map(row => row.user_id));
      if (error) throw new Error(`Could not load member profiles: ${error.message}`);
      for (const profile of data || []) profiles.set(profile.user_id, { id: profile.user_id, name: profile.display_name, avatarSeed: profile.user_id, avatarKey: profile.avatar_key, avatarUrl: profile.avatar_url || undefined });
    }
    return rows.map(row => ({ user: profiles.get(row.user_id) || { id: row.user_id, name: "Listener", avatarSeed: row.user_id }, role: row.user_id === room.ownerUserId ? "owner" : row.role, joinedAt: Date.parse(row.joined_at) }));
  }

  async listRoomInvitations(roomSlug: string) {
    if (!this.supabase) return [];
    const { data, error } = await this.supabase.from("soundspin_room_invitations").select("id,sender_id,recipient_id,created_at,expires_at,accepted_at,cancelled_at").eq("room_slug", roomSlug).order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error(`Could not load room invitations: ${error.message}`);
    return (data || []).map(row => ({ id: row.id as string, senderId: row.sender_id as string, recipientId: row.recipient_id as string, createdAt: Date.parse(row.created_at), expiresAt: Date.parse(row.expires_at), acceptedAt: row.accepted_at ? Date.parse(row.accepted_at) : null, cancelledAt: row.cancelled_at ? Date.parse(row.cancelled_at) : null }));
  }

  async setFavorite(roomSlug: string, userId: string, favorite: boolean) {
    if (!this.supabase) {
      const {limits}=await this.resourcePolicies.get(userId);
      await this.enqueueWrite(async()=>{
        const before=this.data.favorites;
        const current=before?.[userId]??[];
        if(favorite&&!current.includes(roomSlug)&&current.length>=limits.favoriteRooms)throw new RoomCommandError("Your favorite rooms are full. Remove a favorite before adding another.");
        this.data.favorites={...before,[userId]:favorite?[...new Set([...current,roomSlug])]:current.filter(slug=>slug!==roomSlug)};
        try { await writeFile(this.tempFile,JSON.stringify(this.data),"utf8");await rename(this.tempFile,this.dataFile); }
        catch(error){this.data.favorites=before;throw error;}
      });
      return;
    }
    const query = favorite
      ? this.supabase.from("soundspin_room_favorites").upsert(
          { room_slug: roomSlug, user_id: userId },
          { onConflict: "room_slug,user_id" }
        )
      : this.supabase.from("soundspin_room_favorites").delete().eq("room_slug", roomSlug).eq("user_id", userId);
    const { error } = await query;
    if (error) throw trustedSqlRequestError(error,{"Favorite room limit reached":429},"Could not update favorite.");
  }

  /** Only the dedicated application-admin RPC may change this capability. */
  async setRoomSpotifyEnabled(roomSlug:string,actor:string,enabled:boolean,authorize:()=>Promise<void>) {
    const room=await this.loadRoom(roomSlug);
    if(!room)throw new RoomCommandError("Room not found.");
    if(!this.supabase)throw new RoomCommandError("Administrator controls require a signed-in account.");
    await this.withRoomOperation(room.id,async()=>{
      await authorize();
      const {data,error}=await this.supabase!.rpc("soundspin_set_room_spotify",{p_actor:actor,p_room:roomSlug,p_enabled:enabled});
      if(error||!data)throw new RoomCommandError("Could not change Spotify access.");
      room.settings=data.settings;
      room.policyRevision=data.policyRevision;
    });
    // Stop a now-disabled source through the ordinary ordered radio commit.
    await this.changeRoom(room,draft=>{
      if(draft.playback.track&&!roomAllowsProvider(draft.settings,draft.playback.track.provider))advanceRadio(draft);
      return {result:undefined};
    });
    return room;
  }

  async updateRoomSettings(
    roomSlug: string,
    userId: string,
    update: RoomSettingsPatch,
    authorize?:()=>void|Promise<void>
  ) {
    if (update.description !== undefined && update.description.trim().length > 240) throw new RoomCommandError("Room descriptions can contain at most 240 characters.");
    if (update.themePrompt !== undefined && update.themePrompt !== null && (typeof update.themePrompt !== "string" || update.themePrompt.trim().length > 160)) throw new RoomCommandError("Themes can contain at most 160 characters.");
    const providers = update.allowedProviders === undefined ? undefined : allowedProvidersSchema.safeParse(update.allowedProviders);
    if (providers && !providers.success) throw new RoomCommandError(providers.error.issues[0]?.message || "Invalid music services.");
    const room = await this.loadRoom(roomSlug);
    if (!room) throw new RoomCommandError("This room no longer exists.");
    await this.changeRoom(room, async draft => {
      await authorize?.();
      const access = await this.getRoomAccess(roomSlug, userId);
      await authorize?.();
      if (access.role !== "owner" && access.role !== "moderator") throw new RoomCommandError("Only the owner or a moderator can change room settings.");
      if (access.banned) throw new RoomCommandError("You are banned from this room.");
      const parsed = roomSettingsPatchSchema.parse(update);
      authorizeRoomSettingsPatch(draft, userId, parsed);
      const metadata: Record<string, unknown> = {};
      if (parsed.name !== undefined) { draft.name = parsed.name; metadata.name = parsed.name; }
      if (update.isPublic !== undefined && update.accessMode === undefined) draft.settings.accessMode = update.isPublic ? "public" : "members";
      if (update.accessMode !== undefined) draft.settings.accessMode = update.accessMode;
      if (update.isPublic !== undefined || update.accessMode !== undefined) {
        draft.isPublic = accessMode(draft) !== "members"; metadata.is_public = draft.isPublic; metadata.access_mode = accessMode(draft);
      }
      if (update.passwordHash !== undefined) { draft.passwordProtected = Boolean(update.passwordHash); metadata.password_hash = update.passwordHash; }
      if (update.djAccess !== undefined) draft.settings.djAccess = update.djAccess;
      if (providers?.success) draft.settings.allowedProviders = providers.data;
      if (update.description !== undefined) draft.settings.description = update.description.trim();
      if (update.themePrompt !== undefined) {
        if (update.themePrompt?.trim()) draft.settings.themePrompt = update.themePrompt.trim();
        else delete draft.settings.themePrompt;
      }
      const metadataKeys = new Set(["name", "isPublic", "password", "passwordHash", "policyRevision", "rulesVersion", "description", "themePrompt", "allowedProviders", "djAccess"]);
      for (const [key, value] of Object.entries(parsed)) if (!metadataKeys.has(key) && value !== undefined) (draft.settings as Record<string, unknown>)[key] = value;
      if (parsed.rulesText !== undefined && parsed.rulesText !== room.settings.rulesText) draft.settings.rulesVersion = (room.settings.rulesVersion ?? 0) + 1;
      if (update.language) draft.settings.language = Intl.getCanonicalLocales(update.language)[0];
      draft.policyRevision = (draft.policyRevision ?? 0) + 1;
      metadata.policy_revision = draft.policyRevision;
      metadata.settings = draft.settings;
      appendModerationLog(draft, { action: "room-settings", actorId: userId, reason: "", details: { fields: Object.keys(parsed).filter(key => parsed[key as keyof typeof parsed] !== undefined && key !== "policyRevision" && key !== "passwordHash" && key !== "password") } });
      pruneUnauthorizedDjs(draft);
      if (update.allowedProviders !== undefined && (!draft.playback.track || !roomAllowsProvider(draft.settings, draft.playback.track.provider))) advanceRadio(draft);
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

  async setModerator(roomSlug: string, ownerUserId: string, targetUserId: string, moderator: boolean, authorize?: () => void | Promise<void>) {
    await this.verifyRoomOwner(roomSlug, ownerUserId);
    if (targetUserId === ownerUserId) throw new RoomCommandError("The owner already has full room access.");
    const room = await this.loadRoom(roomSlug);
    if (!room) throw new RoomCommandError("This room no longer exists.");
    await this.changeRoom(room, async draft => {
      await authorize?.();
      await this.verifyRoomOwner(roomSlug, ownerUserId);
      await authorize?.();
      draft.moderatorUserIds = moderator ? [...new Set([...draft.moderatorUserIds, targetUserId])] : draft.moderatorUserIds.filter(id => id !== targetUserId);
      if (moderator) draft.djRoleUserIds = draft.djRoleUserIds.filter(id => id !== targetUserId);
      pruneUnauthorizedDjs(draft);
      const state = ensureModeration(draft), member = state.members[targetUserId];
      state.members[targetUserId] = { user: member?.user || { id: targetUserId, name: targetUserId, avatarSeed: targetUserId }, role: moderator ? "moderator" : "member", joinedAt: member?.joinedAt || Date.now() };
      appendModerationLog(draft, { action: moderator ? "moderator-grant" : "moderator-revoke", actorId: ownerUserId, targetUserId, reason: "" });
      return { result: undefined, member: { user_id: targetUserId, role: moderator ? "moderator" : "member" } };
    });
  }

  async setDjRole(roomSlug: string, ownerUserId: string, targetUserId: string, dj: boolean, authorize?: () => void | Promise<void>) {
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
      await authorize?.();
      await this.verifyRoomOwner(roomSlug, ownerUserId); await verifyTarget();
      await authorize?.();
      draft.djRoleUserIds = dj ? [...new Set([...draft.djRoleUserIds, targetUserId])] : draft.djRoleUserIds.filter(id => id !== targetUserId);
      pruneUnauthorizedDjs(draft);
      const state = ensureModeration(draft), member = state.members[targetUserId];
      state.members[targetUserId] = { user: member?.user || { id: targetUserId, name: targetUserId, avatarSeed: targetUserId }, role: dj ? "dj" : "member", joinedAt: member?.joinedAt || Date.now() };
      appendModerationLog(draft, { action: dj ? "dj-grant" : "dj-revoke", actorId: ownerUserId, targetUserId, reason: "" });
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
    input: ProfileUpdate
  ) {
    if (!this.supabase) return null;
    const update = profileUpdateSchema.parse(input);
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
    if (update.handle !== undefined) values.handle = update.handle;
    if (update.statusText !== undefined) values.status_text = update.statusText;
    if (update.favoriteTracks !== undefined) values.favorite_tracks = update.favoriteTracks;
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
    if (error?.code === "23505" && update.handle !== undefined) throw new Error("That handle is taken.");
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
    const { moderation: _privateModeration, ...state } = structuredClone(room);
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
