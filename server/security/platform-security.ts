import { serverT } from "../lib/i18n.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const accessStatusSchema = z.object({ accounts: z.array(z.string()), rooms: z.array(z.string()) });

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

  /** Fresh restriction batches; only trusted Auth confirmation uses the existing cache. */
  checkAccess(accountIds: string[], roomSlugs: string[]) {
    return this.checkAccessBatch(accountIds, roomSlugs, false);
  }

  /** Background checks retain known restrictions when an identity or batch is unavailable.
   * An absent entry means unknown, never a grant or a confirmed restriction. */
  checkConnections(accountIds: string[], roomSlugs: string[]) {
    return this.checkAccessBatch(accountIds, roomSlugs, true);
  }

  private async checkAccessBatch(accountIds: string[], roomSlugs: string[], partialResults: boolean) {
    const accounts = [...new Set(accountIds)], rooms = [...new Set(roomSlugs)];
    const result = { accounts: new Map(accounts.map(id => [id, false])), rooms: new Map(rooms.map(id => [id, false])) };
    if (!this.client) {
      if (this.localFixture) {
        for (const id of accounts) result.accounts.set(id, true);
        for (const slug of rooms) result.rooms.set(slug, true);
      }
      return result;
    }
    for (let offset = 0; offset < Math.max(accounts.length, rooms.length); offset += 100) {
      const accountBatch = accounts.slice(offset, offset + 100), roomBatch = rooms.slice(offset, offset + 100);
      let status: z.infer<typeof accessStatusSchema>;
      try {
        const { data, error } = await this.client.rpc("soundspin_access_status", { p_accounts: accountBatch, p_rooms: roomBatch });
        if (error) throw new Error(serverT("account_access_could_not_be_verified"));
        const parsed = accessStatusSchema.safeParse(data);
        if (!parsed.success) throw new Error(serverT("account_access_could_not_be_verified"));
        status = parsed.data;
      } catch (error) {
        if (!partialResults) throw error;
        for (const id of accountBatch) result.accounts.delete(id);
        for (const slug of roomBatch) result.rooms.delete(slug);
        continue;
      }
      for (const slug of status.rooms) if (roomBatch.includes(slug)) result.rooms.set(slug, true);
      const activeAccounts = accountBatch.filter(id => status.accounts.includes(id));
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(8, activeAccounts.length) }, async () => {
        while (next < activeAccounts.length) {
          const id = activeAccounts[next++];
          try { result.accounts.set(id, await this.verifiedAccount(id)); }
          catch (error) {
            if (!partialResults) throw error;
            result.accounts.delete(id);
          }
        }
      }));
    }
    return result;
  }

  invalidate(userId: string) { this.confirmed.delete(userId); }
}
