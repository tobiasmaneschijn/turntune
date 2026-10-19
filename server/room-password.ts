import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);
/** Expensive password hashing runs off the event loop; admission also limits attempts. */
export async function hashRoomPassword(password?: string | null) {
  if (!password?.trim()) return null;
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}
export async function passwordMatches(password: string | undefined, encoded: string | null) {
  if (!encoded) return true;
  if (!password) return false;
  const [algorithm, saltValue, hashValue] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
  try {
    const expected = Buffer.from(hashValue, "base64");
    if (expected.length !== 64) return false;
    const actual = await scrypt(password, Buffer.from(saltValue, "base64"), 64) as Buffer;
    return crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}
