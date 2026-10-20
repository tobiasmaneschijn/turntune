import type { SupabaseClient } from "@supabase/supabase-js";
import { serverT } from "../lib/i18n.js";
import type { MusicProviderConnection } from "../types.js";

export interface LocalMusicConnectionData {
  musicConnections?: Record<string, MusicProviderConnection>;
}

export class MusicConnectionRepository {
  constructor(
    private readonly supabase: SupabaseClient | null,
    private readonly localData: () => LocalMusicConnectionData,
    private readonly persistFile: () => Promise<void>
  ) {}

  private musicConnectionKey(userId: string, provider: "spotify") {
    return `${userId}:${provider}`;
  }

  async getMusicConnection(userId: string, provider: "spotify") {
    if (!this.supabase) {
      return this.localData().musicConnections?.[this.musicConnectionKey(userId, provider)] || null;
    }
    const { data, error } = await this.supabase
      .from("soundspin_music_connections")
      .select("user_id, provider, refresh_token_ciphertext, scopes, metadata, created_at, updated_at")
      .eq("user_id", userId)
      .eq("provider", provider)
      .maybeSingle();
    if (error) throw new Error(serverT("could_not_load_provider_connection_value2", { provider: provider, value2: error.message }));
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
      const local = this.localData();
      local.musicConnections ||= {};
      const key = this.musicConnectionKey(connection.userId, connection.provider);
      const current = local.musicConnections[key];
      local.musicConnections[key] = {
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
    if (error) throw new Error(serverT("could_not_save_value1_connection_value2", { value1: connection.provider, value2: error.message }));
  }

  async deleteMusicConnection(userId: string, provider: "spotify") {
    if (!this.supabase) {
      delete this.localData().musicConnections?.[this.musicConnectionKey(userId, provider)];
      await this.persistFile();
      return;
    }
    const { error } = await this.supabase
      .from("soundspin_music_connections")
      .delete()
      .eq("user_id", userId)
      .eq("provider", provider);
    if (error) throw new Error(serverT("could_not_disconnect_provider_value2", { provider: provider, value2: error.message }));
  }
}
