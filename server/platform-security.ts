import { serverT } from "./i18n.js";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Service-side gates are deliberately uncached: an operator action applies to
 * saved bearer tokens and the next command on an existing connection. */
export class PlatformSecurity {
  private readonly confirmed = new Map<string, { allowed: boolean; expiresAt: number }>();
  constructor(private readonly client: SupabaseClient | null, private readonly localFixture = false) {}

  async verifiedAccount(userId: string): Promise<boolean> {
    if (!this.client) return this.localFixture;
    const cached = this.confirmed.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.allowed;
    const { data, error } = await this.client.auth.admin.getUserById(userId);
    if (error) {
      if (error.status === 404) {
        if (this.confirmed.size >= 5000) this.confirmed.clear();
        this.confirmed.set(userId, { allowed: false, expiresAt: Date.now() + 30_000 });
        return false;
      }
      throw new Error(serverT("account_identity_could_not_be_verified"));
    }
    const allowed = Boolean(data.user?.email_confirmed_at);
    if (this.confirmed.size >= 5000) this.confirmed.clear();
    this.confirmed.set(userId, { allowed, expiresAt: Date.now() + 30_000 });
    return allowed;
  }

  async activeAccount(userId: string): Promise<boolean> {
    if (!this.client) return this.localFixture;
    const { data, error } = await this.client.from("soundspin_account_restrictions").select("state").eq("user_id", userId).maybeSingle();
    if (error) throw new Error(serverT("account_access_could_not_be_verified"));
    return (!data || data.state === "active") && await this.verifiedAccount(userId);
  }

  async activeRoom(slug: string): Promise<boolean> {
    if (!this.client) return this.localFixture;
    const { data, error } = await this.client.rpc("soundspin_room_enabled", { p_room_slug: slug });
    if (error) throw new Error(serverT("room_access_could_not_be_verified"));
    return data === true;
  }

  invalidate(userId: string) { this.confirmed.delete(userId); }
}
