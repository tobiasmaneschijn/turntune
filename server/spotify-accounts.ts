import crypto from "node:crypto";
import type { Store } from "./store.js";
import type { SpotifyApi } from "./spotify.js";

interface SpotifySecret {
  refreshToken: string;
}

export class SpotifyAccounts {
  private readonly key: Buffer | null;
  private readonly accessTokens = new Map<string, { value: string; expiresAt: number }>();

  constructor(
    private readonly store: Store,
    private readonly spotify: SpotifyApi,
    encryptionSecret = process.env.PROVIDER_TOKEN_ENCRYPTION_KEY
  ) {
    this.key = encryptionSecret
      ? crypto.createHash("sha256").update(encryptionSecret).digest()
      : null;
  }

  get configured() {
    return this.spotify.configured && Boolean(this.key);
  }

  private encrypt(value: SpotifySecret) {
    if (!this.key) throw new Error("Provider token encryption is not configured.");
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final()
    ]);
    return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
  }

  private decrypt(value: string) {
    if (!this.key) throw new Error("Provider token encryption is not configured.");
    const [version, iv, tag, ciphertext] = value.split(".");
    if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Stored Spotify credentials are invalid.");
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final()
    ]).toString("utf8");
    return JSON.parse(plaintext) as SpotifySecret;
  }

  async connected(userId: string) {
    return Boolean(await this.store.getMusicConnection(userId, "spotify"));
  }

  async connect(userId: string, code: string, redirectUri: string) {
    if (!this.configured) throw new Error("Spotify accounts are not configured yet.");
    const token = await this.spotify.exchangeAuthorizationCode(code, redirectUri);
    if (!token.refresh_token) throw new Error("Spotify did not issue a refresh token.");
    await this.store.saveMusicConnection({
      userId,
      provider: "spotify",
      refreshTokenCiphertext: this.encrypt({ refreshToken: token.refresh_token }),
      scopes: token.scope?.split(" ").filter(Boolean) || [],
      metadata: {}
    });
    this.accessTokens.set(userId, {
      value: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000
    });
  }

  async disconnect(userId: string) {
    this.accessTokens.delete(userId);
    await this.store.deleteMusicConnection(userId, "spotify");
  }

  async getAccessToken(userId: string) {
    const cached = this.accessTokens.get(userId);
    if (cached && cached.expiresAt > Date.now() + 30_000) return cached.value;
    const connection = await this.store.getMusicConnection(userId, "spotify");
    if (!connection) throw new Error("Connect Spotify first.");
    const currentSecret = this.decrypt(connection.refreshTokenCiphertext);
    const token = await this.spotify.refreshUserToken(currentSecret.refreshToken);
    if (token.refresh_token) {
      await this.store.saveMusicConnection({
        userId,
        provider: "spotify",
        refreshTokenCiphertext: this.encrypt({ refreshToken: token.refresh_token }),
        scopes: token.scope?.split(" ").filter(Boolean) || connection.scopes,
        metadata: connection.metadata
      });
    }
    this.accessTokens.set(userId, {
      value: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000
    });
    return token.access_token;
  }

  invalidate(userId: string) {
    this.accessTokens.delete(userId);
  }
}
