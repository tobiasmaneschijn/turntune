import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createAdminClient } from "@supabase/server/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Room } from "./types.js";

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
