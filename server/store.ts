import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createAdminClient } from "@supabase/server/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { levelForXp, TRACK_LIKED_XP } from "./progression.js";
import type {
  DjAccess,
  Room,
  RoomDirectoryEntry,
  RoomRole,
  MusicProviderConnection,
  SoundSpinProfile,
  SoundSpinProfileHighlights,
  SoundSpinUnlock,
  Track
} from "./types.js";

const PROFILE_COLUMNS = "user_id, display_name, bio, avatar_key, theme_key, featured_badge_key, signature_tracks, xp, songs_liked, created_at, updated_at";

interface Database {
  rooms: Record<string, Room>;
  musicConnections?: Record<string, MusicProviderConnection>;
}

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
const dataFile = path.join(dataDir, "soundspin.json");
const tempFile = path.join(dataDir, "soundspin.tmp.json");

export class Store {
  // The cache is the live room object graph used by Socket.IO handlers. Supabase
  // is durable storage, not a replacement for the process's coordination state.
  private data: Database = { rooms: {} };
  // Serialize writes so a slower save cannot overwrite a newer radio state.
  private writeChain: Promise<void> = Promise.resolve();
  private supabase: SupabaseClient | null = null;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if (url && secretKey) {
      this.supabase = createAdminClient();
    }
  }

  get usesSupabase() {
    return Boolean(this.supabase);
  }

  async init() {
    if (this.supabase) return;
    await mkdir(dataDir, { recursive: true });
    try {
      this.data = JSON.parse(await readFile(dataFile, "utf8")) as Database;
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
    return this.data.rooms[id];
  }

  async loadRoom(id: string) {
    const cached = this.getRoom(id);
    if (cached || !this.supabase) return cached;

    const { data, error } = await this.supabase
      .from("soundspin_rooms")
      .select("state, name, owner_id, is_public, password_hash, settings")
      .eq("slug", id)
      .maybeSingle();

    if (error) {
      if (error.code === "PGRST205" || error.message.includes("soundspin_rooms")) {
        throw new Error(
          "SoundSpin database is not initialized. Deploy the migrations from GitHub or run the initial migration in the Supabase SQL editor."
        );
      }
      throw new Error(`Could not load room: ${error.message}`);
    }
    if (!data) return undefined;
    const { data: roomRoles, error: roomRoleError } = await this.supabase
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
      name: data.name,
      ownerUserId: data.owner_id,
      moderatorUserIds: (roomRoles || []).filter((member) => member.role === "moderator").map((member) => member.user_id),
      djRoleUserIds: (roomRoles || []).filter((member) => member.role === "dj").map((member) => member.user_id),
      isPublic: data.is_public,
      passwordProtected: Boolean(data.password_hash),
      settings: data.settings || {}
    };
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
        updatedAt: new Date(room.createdAt).toISOString()
      }));
    }

    const [{ data: favorites, error: favoriteError }, { data: memberships, error: membershipError }] = await Promise.all([
      this.supabase.from("soundspin_room_favorites").select("room_slug").eq("user_id", userId),
      this.supabase.from("soundspin_room_members").select("room_slug, role").eq("user_id", userId)
    ]);
    if (favoriteError) throw new Error(`Could not load room favorites: ${favoriteError.message}`);
    if (membershipError) throw new Error(`Could not load room memberships: ${membershipError.message}`);

    const favoriteSlugs = new Set((favorites || []).map((favorite) => favorite.room_slug));
    const roles = new Map((memberships || []).map((member) => [member.room_slug, member.role as RoomRole]));
    const { data: rooms, error } = await this.supabase
      .from("soundspin_rooms")
      .select("slug, name, owner_id, is_public, password_hash, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(`Could not load rooms: ${error.message}`);

    return (rooms || [])
      .filter((room) => room.is_public || favoriteSlugs.has(room.slug) || roles.has(room.slug))
      .map((room): RoomDirectoryEntry => ({
        slug: room.slug,
        name: room.name,
        ownerId: room.owner_id,
        isPublic: room.is_public,
        passwordProtected: Boolean(room.password_hash),
        isFavorite: favoriteSlugs.has(room.slug),
        role: roles.get(room.slug) || null,
        listenerCount: listenerCounts[room.slug] || 0,
        createdAt: room.created_at,
        updatedAt: room.updated_at
      }));
  }

  async createRoom(room: Room, passwordHash: string | null) {
    if (!this.supabase) return this.saveRoom(room);
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
        passwordHash: null,
        role: room.ownerUserId === userId ? "owner" as const : null
      } : { exists: false, isPublic: false, passwordHash: null, role: null };
    }
    const [{ data: room, error }, { data: membership, error: membershipError }] = await Promise.all([
      this.supabase.from("soundspin_rooms").select("is_public, password_hash").eq("slug", roomSlug).maybeSingle(),
      this.supabase.from("soundspin_room_members").select("role").eq("room_slug", roomSlug).eq("user_id", userId).maybeSingle()
    ]);
    if (error) throw new Error(`Could not check room access: ${error.message}`);
    if (membershipError) throw new Error(`Could not check room membership: ${membershipError.message}`);
    return {
      exists: Boolean(room),
      isPublic: room?.is_public ?? false,
      passwordHash: room?.password_hash || null,
      role: (membership?.role as RoomRole | undefined) || null
    };
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
    update: { name?: string; isPublic?: boolean; passwordHash?: string | null; djAccess?: DjAccess }
  ) {
    if (!this.supabase) {
      const room = this.getRoom(roomSlug);
      if (!room || (room.ownerUserId !== userId && !room.moderatorUserIds?.includes(userId))) {
        throw new Error("Only the owner or a moderator can change room settings.");
      }
      if (update.name !== undefined) room.name = update.name;
      if (update.isPublic !== undefined) room.isPublic = update.isPublic;
      if (update.passwordHash !== undefined) room.passwordProtected = Boolean(update.passwordHash);
      if (update.djAccess !== undefined) room.settings.djAccess = update.djAccess;
      await this.saveRoom(room);
      return room;
    }
    const { data: membership, error: membershipError } = await this.supabase
      .from("soundspin_room_members")
      .select("role")
      .eq("room_slug", roomSlug)
      .eq("user_id", userId)
      .maybeSingle();
    if (membershipError) throw new Error(`Could not verify room role: ${membershipError.message}`);
    if (!membership || !["owner", "moderator"].includes(membership.role)) {
      throw new Error("Only the owner or a moderator can change room settings.");
    }

    const values: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (update.name !== undefined) values.name = update.name;
    if (update.isPublic !== undefined) values.is_public = update.isPublic;
    if (update.passwordHash !== undefined) values.password_hash = update.passwordHash;
    if (update.djAccess !== undefined) {
      const cachedSettings = this.getRoom(roomSlug)?.settings || {};
      values.settings = { ...cachedSettings, djAccess: update.djAccess };
    }
    const { data, error } = await this.supabase
      .from("soundspin_rooms")
      .update(values)
      .eq("slug", roomSlug)
      .select("name, is_public, password_hash, settings")
      .single();
    if (error) throw new Error(`Could not update room: ${error.message}`);

    const room = await this.loadRoom(roomSlug) || this.getRoom(roomSlug);
    if (room) {
      room.name = data.name;
      room.isPublic = data.is_public;
      room.passwordProtected = Boolean(data.password_hash);
      room.settings = data.settings || {};
      await this.saveRoom(room);
    }
    return room;
  }

  async setModerator(roomSlug: string, ownerUserId: string, targetUserId: string, moderator: boolean) {
    if (!this.supabase) {
      const room = this.getRoom(roomSlug);
      if (!room || room.ownerUserId !== ownerUserId) throw new Error("Only the room owner can manage moderators.");
      if (targetUserId === ownerUserId) throw new Error("The owner already has full room access.");
      room.moderatorUserIds = moderator
        ? [...new Set([...room.moderatorUserIds, targetUserId])]
        : room.moderatorUserIds.filter((id) => id !== targetUserId);
      if (moderator) room.djRoleUserIds = room.djRoleUserIds.filter((id) => id !== targetUserId);
      await this.saveRoom(room);
      return;
    }
    const { data: room, error: roomError } = await this.supabase
      .from("soundspin_rooms")
      .select("owner_id")
      .eq("slug", roomSlug)
      .single();
    if (roomError) throw new Error(`Could not load room owner: ${roomError.message}`);
    if (room.owner_id !== ownerUserId) throw new Error("Only the room owner can manage moderators.");
    if (targetUserId === ownerUserId) throw new Error("The owner already has full room access.");
    const { error } = await this.supabase.from("soundspin_room_members").upsert(
      {
        room_slug: roomSlug,
        user_id: targetUserId,
        role: moderator ? "moderator" : "member",
        updated_at: new Date().toISOString()
      },
      { onConflict: "room_slug,user_id" }
    );
    if (error) throw new Error(`Could not update moderator: ${error.message}`);
    const cached = this.getRoom(roomSlug);
    if (cached) {
      cached.moderatorUserIds = moderator
        ? [...new Set([...(cached.moderatorUserIds || []), targetUserId])]
        : (cached.moderatorUserIds || []).filter((id) => id !== targetUserId);
      if (moderator) cached.djRoleUserIds = (cached.djRoleUserIds || []).filter((id) => id !== targetUserId);
      await this.saveRoom(cached);
    }
  }

  async setDjRole(roomSlug: string, ownerUserId: string, targetUserId: string, dj: boolean) {
    if (!this.supabase) {
      const room = this.getRoom(roomSlug);
      if (!room || room.ownerUserId !== ownerUserId) throw new Error("Only the room owner can manage DJ roles.");
      if (targetUserId === ownerUserId) throw new Error("The owner can always join the DJ queue.");
      if (room.moderatorUserIds.includes(targetUserId)) throw new Error("Moderators can already join the DJ queue.");
      room.djRoleUserIds = dj
        ? [...new Set([...room.djRoleUserIds, targetUserId])]
        : room.djRoleUserIds.filter((id) => id !== targetUserId);
      await this.saveRoom(room);
      return;
    }

    const { data: room, error: roomError } = await this.supabase
      .from("soundspin_rooms")
      .select("owner_id")
      .eq("slug", roomSlug)
      .single();
    if (roomError) throw new Error(`Could not load room owner: ${roomError.message}`);
    if (room.owner_id !== ownerUserId) throw new Error("Only the room owner can manage DJ roles.");
    if (targetUserId === ownerUserId) throw new Error("The owner can always join the DJ queue.");

    const cached = this.getRoom(roomSlug);
    if (cached?.moderatorUserIds.includes(targetUserId)) {
      throw new Error("Moderators can already join the DJ queue.");
    }
    const { error } = await this.supabase.from("soundspin_room_members").upsert(
      {
        room_slug: roomSlug,
        user_id: targetUserId,
        role: dj ? "dj" : "member",
        updated_at: new Date().toISOString()
      },
      { onConflict: "room_slug,user_id" }
    );
    if (error) throw new Error(`Could not update DJ role: ${error.message}`);
    if (cached) {
      cached.djRoleUserIds = dj
        ? [...new Set([...(cached.djRoleUserIds || []), targetUserId])]
        : (cached.djRoleUserIds || []).filter((id) => id !== targetUserId);
      await this.saveRoom(cached);
    }
  }

  async loadOrCreateProfile(userId: string, displayName: string) {
    if (!this.supabase) return null;
    const { data, error } = await this.supabase
      .from("soundspin_profiles")
      .upsert(
        { user_id: userId, display_name: displayName, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      )
      .select(PROFILE_COLUMNS)
      .single();
    if (error) throw new Error(`Could not load profile: ${error.message}`);
    return data as SoundSpinProfile;
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

  async getUnlocks() {
    if (!this.supabase) return [];
    const { data, error } = await this.supabase
      .from("soundspin_unlocks")
      .select("key, kind, name, required_level, metadata")
      .order("required_level", { ascending: true });
    if (error) throw new Error(`Could not load unlocks: ${error.message}`);
    return (data || []) as SoundSpinUnlock[];
  }

  async getProfileHighlights(userId: string): Promise<SoundSpinProfileHighlights> {
    const empty = {
      rooms_played: 0,
      favorite_track_title: null,
      favorite_track_artist: null,
      favorite_track_wins: 0
    };
    if (!this.supabase) return empty;
    const { data, error } = await this.supabase
      .from("soundspin_profile_highlights")
      .select("rooms_played, favorite_track_title, favorite_track_artist, favorite_track_wins")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(`Could not load profile highlights: ${error.message}`);
    return data ? data as SoundSpinProfileHighlights : empty;
  }

  async updateProfile(
    userId: string,
    update: {
      displayName?: string;
      bio?: string;
      avatarKey?: string;
      themeKey?: string;
      featuredBadgeKey?: string;
      signatureTracks?: SoundSpinProfile["signature_tracks"];
    }
  ) {
    if (!this.supabase) return null;
    const supabase = this.supabase;
    const current = await this.getProfile(userId);
    if (!current) throw new Error("Profile not found.");

    const validateUnlock = async (
      key: string,
      kind: SoundSpinUnlock["kind"],
      missingMessage: string
    ) => {
      const { data: unlock, error } = await supabase
        .from("soundspin_unlocks")
        .select("key, required_level")
        .eq("key", key)
        .eq("kind", kind)
        .maybeSingle();
      if (error) throw new Error(`Could not validate ${kind}: ${error.message}`);
      if (!unlock) throw new Error(missingMessage);
      if (levelForXp(current.xp) < unlock.required_level) {
        throw new Error(`Reach level ${unlock.required_level} to use that ${kind}.`);
      }
    };

    if (update.avatarKey && update.avatarKey !== current.avatar_key) {
      await validateUnlock(update.avatarKey, "avatar", "That avatar does not exist.");
    }
    if (update.themeKey && update.themeKey !== current.theme_key) {
      await validateUnlock(update.themeKey, "theme", "That theme does not exist.");
    }
    if (update.featuredBadgeKey && update.featuredBadgeKey !== current.featured_badge_key) {
      await validateUnlock(update.featuredBadgeKey, "badge", "That achievement does not exist.");
    }

    const values: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (update.displayName !== undefined) values.display_name = update.displayName;
    if (update.bio !== undefined) values.bio = update.bio;
    if (update.avatarKey !== undefined) values.avatar_key = update.avatarKey;
    if (update.themeKey !== undefined) values.theme_key = update.themeKey;
    if (update.featuredBadgeKey !== undefined) values.featured_badge_key = update.featuredBadgeKey;
    if (update.signatureTracks !== undefined) values.signature_tracks = update.signatureTracks;

    const { data, error } = await supabase
      .from("soundspin_profiles")
      .update(values)
      .eq("user_id", userId)
      .select(PROFILE_COLUMNS)
      .single();
    if (error) throw new Error(`Could not update profile: ${error.message}`);
    return data as SoundSpinProfile;
  }

  async awardTrackLikedXp(recipientUserId: string, roomSlug: string, track: Pick<Track, "id" | "title" | "artist">) {
    if (!this.supabase) return false;
    const { error } = await this.supabase.from("soundspin_xp_events").insert({
      recipient_user_id: recipientUserId,
      room_slug: roomSlug,
      track_id: track.id,
      track_title: track.title,
      track_artist: track.artist || null,
      reason: "track_liked",
      amount: TRACK_LIKED_XP
    });
    if (!error) return true;
    if (error.code === "23505") return false;
    throw new Error(`Could not award experience: ${error.message}`);
  }

  /**
   * Updates the live cache immediately, then persists saves in call order.
   * Callers should await the returned chain before acknowledging a mutation.
   */
  saveRoom(room: Room) {
    this.data.rooms[room.id] = room;
    this.writeChain = this.writeChain.then(async () => {
      if (this.supabase) {
        const { error } = await this.supabase.from("soundspin_rooms").upsert(
          {
            slug: room.id,
            name: room.name,
            owner_id: room.ownerUserId,
            state: room,
            is_public: room.isPublic ?? true,
            settings: room.settings || {},
            updated_at: new Date().toISOString()
          },
          { onConflict: "slug" }
        );
        if (error) {
          if (error.code === "PGRST205" || error.message.includes("soundspin_rooms")) {
            throw new Error(
              "SoundSpin database is not initialized. Deploy the migrations from GitHub or run the initial migration in the Supabase SQL editor."
            );
          }
          throw new Error(`Could not save room: ${error.message}`);
        }
      } else {
        await this.persistFile();
      }
    });
    return this.writeChain;
  }

  private async persistFile() {
    await writeFile(tempFile, JSON.stringify(this.data, null, 2), "utf8");
    await rename(tempFile, dataFile);
  }
}
