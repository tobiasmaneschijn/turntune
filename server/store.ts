import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createAdminClient } from "@supabase/server/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { levelForXp, TRACK_LIKED_XP } from "./progression.js";
import type { Room, SoundSpinProfile, SoundSpinUnlock } from "./types.js";

interface Database {
  rooms: Record<string, Room>;
}

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
const dataFile = path.join(dataDir, "soundspin.json");
const tempFile = path.join(dataDir, "soundspin.tmp.json");

export class Store {
  private data: Database = { rooms: {} };
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

  getRoom(id: string) {
    return this.data.rooms[id];
  }

  async loadRoom(id: string) {
    const cached = this.getRoom(id);
    if (cached || !this.supabase) return cached;

    const { data, error } = await this.supabase
      .from("soundspin_rooms")
      .select("state")
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
    const room = data.state as Room;
    this.data.rooms[id] = room;
    return room;
  }

  async loadOrCreateProfile(userId: string, displayName: string) {
    if (!this.supabase) return null;
    const { data, error } = await this.supabase
      .from("soundspin_profiles")
      .upsert(
        { user_id: userId, display_name: displayName, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      )
      .select("user_id, display_name, bio, avatar_key, xp, songs_liked, created_at, updated_at")
      .single();
    if (error) throw new Error(`Could not load profile: ${error.message}`);
    return data as SoundSpinProfile;
  }

  async getProfile(userId: string) {
    if (!this.supabase) return null;
    const { data, error } = await this.supabase
      .from("soundspin_profiles")
      .select("user_id, display_name, bio, avatar_key, xp, songs_liked, created_at, updated_at")
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

  async updateProfile(
    userId: string,
    update: { displayName?: string; bio?: string; avatarKey?: string }
  ) {
    if (!this.supabase) return null;
    const current = await this.getProfile(userId);
    if (!current) throw new Error("Profile not found.");

    if (update.avatarKey && update.avatarKey !== current.avatar_key) {
      const { data: unlock, error } = await this.supabase
        .from("soundspin_unlocks")
        .select("key, required_level")
        .eq("key", update.avatarKey)
        .eq("kind", "avatar")
        .maybeSingle();
      if (error) throw new Error(`Could not validate avatar: ${error.message}`);
      if (!unlock) throw new Error("That avatar does not exist.");
      if (levelForXp(current.xp) < unlock.required_level) {
        throw new Error(`Reach level ${unlock.required_level} to use that avatar.`);
      }
    }

    const values: Record<string, string> = { updated_at: new Date().toISOString() };
    if (update.displayName !== undefined) values.display_name = update.displayName;
    if (update.bio !== undefined) values.bio = update.bio;
    if (update.avatarKey !== undefined) values.avatar_key = update.avatarKey;

    const { data, error } = await this.supabase
      .from("soundspin_profiles")
      .update(values)
      .eq("user_id", userId)
      .select("user_id, display_name, bio, avatar_key, xp, songs_liked, created_at, updated_at")
      .single();
    if (error) throw new Error(`Could not update profile: ${error.message}`);
    return data as SoundSpinProfile;
  }

  async awardTrackLikedXp(recipientUserId: string, roomSlug: string, trackId: string) {
    if (!this.supabase) return false;
    const { error } = await this.supabase.from("soundspin_xp_events").insert({
      recipient_user_id: recipientUserId,
      room_slug: roomSlug,
      track_id: trackId,
      reason: "track_liked",
      amount: TRACK_LIKED_XP
    });
    if (!error) return true;
    if (error.code === "23505") return false;
    throw new Error(`Could not award experience: ${error.message}`);
  }

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
