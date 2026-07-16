import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
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

  async init() {
    await mkdir(dataDir, { recursive: true });
    try {
      this.data = JSON.parse(await readFile(dataFile, "utf8")) as Database;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.persist();
    }
  }

  getRoom(id: string) {
    return this.data.rooms[id];
  }

  saveRoom(room: Room) {
    this.data.rooms[room.id] = room;
    this.writeChain = this.writeChain.then(() => this.persist());
    return this.writeChain;
  }

  private async persist() {
    await writeFile(tempFile, JSON.stringify(this.data, null, 2), "utf8");
    await rename(tempFile, dataFile);
  }
}
