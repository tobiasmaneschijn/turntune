import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { RoomRole, SoundSpinProfile, User } from "./types.js";

export const SOCIAL_LIMITS = { people: 100, pendingSent: 20, pendingReceived: 30, requestDaily: 30, recipientDaily: 50,
  requestGlobalDaily: 5_000, requestMs: 14 * 86_400_000, declineMs: 7 * 86_400_000,
  search: 20, invitations: 30, invitationMs: 60 * 60_000 } as const;
export type FriendState = "none" | "friends" | "incoming" | "outgoing";
export type FriendAction = "request" | "accept" | "decline" | "remove";
export interface SocialRoomAccess { exists: boolean; isPublic: boolean; passwordProtected: boolean; role: RoomRole | null; banned?:boolean; canInvite?:boolean }
export interface SocialPerson { user: User; state: Exclude<FriendState, "none">; room?: { slug: string; name: string; canJoin: boolean } }
export interface SocialInvitation { id: string; from: User; room: { slug: string; name: string }; createdAt: string; expiresAt: string }
export interface SocialSnapshot { people: SocialPerson[]; invitations: SocialInvitation[]; shareActivity: boolean; blockedPeople: User[]; receiveRequests: boolean }
interface Relationship { user_low: string; user_high: string; requested_by: string; status: "pending" | "accepted"; updated_at: string }
interface Invitation { id: string; sender_id: string; recipient_id: string; room_slug: string; created_at: string; expires_at: string; accepted_at: string | null }
export interface SocialStoreOptions {
  supabase: SupabaseClient | null;
  getRoomAccess: (roomSlug: string, userId: string) => Promise<SocialRoomAccess>;
  getActivity?: (userId: string) => { roomSlug: string } | null | Promise<{ roomSlug: string } | null>;
  getProfile?: (userId: string) => Promise<SoundSpinProfile | User | null>;
  isProfileVisible?: (userId: string) => boolean | Promise<boolean>;
  getRoom?: (roomSlug: string) => Promise<{ name: string } | null>;
  searchProfiles?: (query: string) => Promise<User[]>;
  grantRoomMember?: (roomSlug: string, userId: string) => Promise<void>;
  now?: () => number;
}
export class SocialError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const idSchema = z.string().uuid();
const checkedId = (id: string) => {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw new SocialError("Invalid listener.");
  return parsed.data.toLowerCase();
};
const pair = (a: string, b: string) => a < b ? [a, b] : [b, a];
const key = (a: string, b: string) => pair(a, b).join(":");
const stateFor = (relationship: Relationship | null, viewer: string): FriendState => !relationship ? "none"
  : relationship.status === "accepted" ? "friends" : relationship.requested_by === viewer ? "outgoing" : "incoming";
const profileUser = (profile: SoundSpinProfile | User): User => "user_id" in profile
  ? { id: profile.user_id, name: profile.display_name, avatarSeed: profile.user_id, avatarKey: profile.avatar_key,
    avatarUrl: profile.avatar_url || undefined, isAppAdmin: profile.is_app_admin }
  : { id: profile.id, name: profile.name, avatarSeed: profile.avatarSeed, avatarKey: profile.avatarKey, avatarUrl: profile.avatarUrl, isAppAdmin: profile.isAppAdmin };

const socialMutationError = (error: { code?: string; message: string }): Error => {
  // PL/pgSQL consent/limit rejections have explicit short user-facing messages.
  // Database, permission and transport diagnostics stay on the server.
  if (error.code !== "P0001" || error.message.length > 200 || /[\r\n]/.test(error.message)) return new Error("Social database operation failed.");
  const status = /^Too many/.test(error.message) ? 429 : /not found/i.test(error.message) ? 404 : /cannot|unavailable|Only|recipient|removed|cancelled/i.test(error.message) ? 403 : /expired/i.test(error.message) ? 410 : 400;
  return new SocialError(error.message, status);
};

/** Only verified HTTP actors reach mutations; room authority is checked again in SQL. */
export class SocialStore {
  private readonly relationships = new Map<string, Relationship>();
  private readonly activitySettings = new Map<string, boolean>();
  private readonly requestSettings = new Map<string, boolean>();
  private readonly blocks = new Set<string>();
  private readonly cooldowns = new Map<string, number>();
  private requestUsage: Array<{ actor: string; recipient: string; at: number }> = [];
  private readonly invitations = new Map<string, Invitation>();
  private localMutation: Promise<unknown> = Promise.resolve();
  private readonly now: () => number;
  constructor(private readonly options: SocialStoreOptions) { this.now = options.now || Date.now; }

  private serialLocal<T>(run: () => Promise<T>): Promise<T> {
    const result = this.localMutation.then(run, run);
    this.localMutation = result.catch(() => undefined);
    return result;
  }
  private async profiles(ids: string[]): Promise<Map<string, User>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    if (this.options.supabase) {
      const users = new Map<string, User>();
      for (let offset = 0; offset < unique.length; offset += 500) {
        const { data, error } = await this.options.supabase.rpc("soundspin_social_profiles", { p_ids: unique.slice(offset, offset + 500) });
        if (error) throw new Error("Could not load listeners.");
        for (const profile of (data || []) as SoundSpinProfile[]) {
          const user = profileUser(profile); users.set(user.id, user);
        }
      }
      return users;
    }
    const entries = await Promise.all(unique.map(async id => {
      if (this.options.isProfileVisible && !await this.options.isProfileVisible(id)) return null;
      const profile = await this.options.getProfile?.(id);
      return profile ? [id, profileUser(profile)] as const : null;
    }));
    return new Map(entries.filter((entry): entry is readonly [string, User] => entry !== null));
  }
  private async roomName(slug: string): Promise<string | null> {
    if (this.options.supabase) {
      const { data, error } = await this.options.supabase.from("soundspin_rooms").select("name").eq("slug", slug).maybeSingle();
      if (error) throw new Error(`Could not load room: ${error.message}`);
      return data?.name || null;
    }
    return (await this.options.getRoom?.(slug))?.name || null;
  }
  async isBlocked(a: string, b: string): Promise<boolean> {
    const actor = checkedId(a), target = checkedId(b);
    if (!this.options.supabase) return this.blocks.has(`${actor}:${target}`) || this.blocks.has(`${target}:${actor}`);
    const { data, error } = await this.options.supabase.rpc("soundspin_users_blocked", { p_a: actor, p_b: target });
    if (error) throw new Error("Could not check listener restrictions.");
    return data === true;
  }
  async setBlocked(actorId: string, targetId: string, blocked: boolean): Promise<void> {
    const actor = checkedId(actorId), target = checkedId(targetId);
    if (actor === target) throw new SocialError("Choose another listener.");
    if (this.options.supabase) {
      const { error } = await this.options.supabase.rpc("soundspin_set_user_block", { p_actor: actor, p_target: target, p_blocked: blocked });
      if (error) throw socialMutationError(error);
      return;
    }
    await this.serialLocal(async () => {
      const users = await this.profiles(blocked ? [actor, target] : [actor]);
      if (!users.has(actor) || (blocked && !users.has(target))) throw new SocialError("Listener not found.", 404);
      const blockKey = `${actor}:${target}`;
      if (blocked) {
        if (!this.blocks.has(blockKey) && [...this.blocks].filter(value => value.startsWith(`${actor}:`)).length >= 500) throw new SocialError("The blocked listeners limit has been reached.");
        this.blocks.add(blockKey); this.relationships.delete(key(actor, target));
        for (const [id, row] of this.invitations) if (key(row.sender_id, row.recipient_id) === key(actor, target)) this.invitations.delete(id);
      } else this.blocks.delete(blockKey);
    });
  }
  private async ownSettings(actor: string): Promise<{ shareActivity: boolean; receiveRequests: boolean }> {
    if (!this.options.supabase) return { shareActivity: this.activitySettings.get(actor) || false, receiveRequests: this.requestSettings.get(actor) !== false };
    const { data, error } = await this.options.supabase.from("soundspin_social_settings").select("share_activity, receive_requests").eq("user_id", actor).maybeSingle();
    if (error) throw new Error("Could not load social settings.");
    return { shareActivity: data?.share_activity === true, receiveRequests: data?.receive_requests !== false };
  }
  private async blockedPeople(actor: string): Promise<User[]> {
    let ids: string[];
    if (!this.options.supabase) ids = [...this.blocks].filter(value => value.startsWith(`${actor}:`)).map(value => value.split(":")[1]);
    else {
      const { data, error } = await this.options.supabase.from("soundspin_user_blocks").select("blocked_id").eq("blocker_id", actor).limit(500);
      if (error) throw new Error("Could not load blocked listeners.");
      ids = (data || []).map(row => row.blocked_id as string);
    }
    const visible = await this.profiles(ids);
    // Keep owner-held block IDs usable without exposing a hidden subject's
    // name, managed avatar, provider URLs or administrator status.
    return ids.map(id => visible.get(id) || { id, name: "Unavailable listener", avatarSeed: id });
  }
  private expired(row: Relationship): boolean { return row.status === "pending" && Date.parse(row.updated_at) <= this.now() - SOCIAL_LIMITS.requestMs; }
  private async friendRows(userId: string): Promise<Relationship[]> {
    if (!this.options.supabase) return [...this.relationships.values()].filter(row => !this.expired(row) && (row.user_low === userId || row.user_high === userId));
    const results = await Promise.all((["accepted", "pending"] as const).map(status => this.options.supabase!.from("soundspin_friendships")
      .select("user_low, user_high, requested_by, status, updated_at").or(`user_low.eq.${userId},user_high.eq.${userId}`).eq("status", status)
      .order("updated_at", { ascending: false }).limit(status === "accepted" ? SOCIAL_LIMITS.people : SOCIAL_LIMITS.pendingSent + SOCIAL_LIMITS.pendingReceived)));
    for (const result of results) if (result.error) throw new Error(`Could not load friends: ${result.error.message}`);
    return results.flatMap(result => (result.data || []) as Relationship[]).filter(row => !this.expired(row));
  }
  async getRelationship(viewerId: string, targetId: string): Promise<FriendState> {
    const viewer = checkedId(viewerId), target = checkedId(targetId);
    if (viewer === target || await this.isBlocked(viewer, target)) return "none";
    if (!this.options.supabase) {
      const row = this.relationships.get(key(viewer, target));
      return stateFor(row && !this.expired(row) ? row : null, viewer);
    }
    const [low, high] = pair(viewer, target);
    const { data, error } = await this.options.supabase.from("soundspin_friendships")
      .select("requested_by, status, updated_at").eq("user_low", low).eq("user_high", high).maybeSingle();
    if (error) throw new Error(`Could not check friendship: ${error.message}`);
    const row = data as Relationship | null;
    return stateFor(row && !this.expired(row) ? row : null, viewer);
  }
  private async sharedActivity(ids: string[]): Promise<Set<string>> {
    if (!this.options.supabase) return new Set(ids.filter(id => this.activitySettings.get(id)));
    if (!ids.length) return new Set();
    const { data, error } = await this.options.supabase.from("soundspin_social_settings").select("user_id")
      .in("user_id", ids).eq("share_activity", true);
    if (error) throw new Error(`Could not load activity settings: ${error.message}`);
    return new Set((data || []).map(row => row.user_id as string));
  }
  private async pendingInvitations(userId: string): Promise<Invitation[]> {
    if (!this.options.supabase) return [...this.invitations.values()].filter(row => row.recipient_id === userId && !row.accepted_at && Date.parse(row.expires_at) > this.now());
    const { data, error } = await this.options.supabase.from("soundspin_room_invitations")
      .select("id, sender_id, recipient_id, room_slug, created_at, expires_at, accepted_at")
      .eq("recipient_id", userId).is("accepted_at", null).is("cancelled_at",null).gt("expires_at", new Date(this.now()).toISOString())
      .order("created_at", { ascending: false }).limit(SOCIAL_LIMITS.invitations);
    if (error) throw new Error(`Could not load invitations: ${error.message}`);
    return (data || []) as Invitation[];
  }
  async snapshot(viewerId: string): Promise<SocialSnapshot> {
    const viewer = checkedId(viewerId);
    const [rows, pending, settings, blockedPeople] = await Promise.all([this.friendRows(viewer), this.pendingInvitations(viewer), this.ownSettings(viewer), this.blockedPeople(viewer)]);
    const relationships: Relationship[] = [];
    for (const row of rows) if (!await this.isBlocked(viewer, row.user_low === viewer ? row.user_high : row.user_low)) relationships.push(row);
    const friendIds = relationships.filter(row => row.status === "accepted").map(row => row.user_low === viewer ? row.user_high : row.user_low);
    const allIds = relationships.map(row => row.user_low === viewer ? row.user_high : row.user_low);
    const [users, shares] = await Promise.all([this.profiles([...allIds, ...pending.map(row => row.sender_id)]), this.sharedActivity(friendIds)]);
    const people: SocialPerson[] = [];
    for (const row of relationships) {
      const id = row.user_low === viewer ? row.user_high : row.user_low, user = users.get(id);
      if (!user) continue;
      const state = stateFor(row, viewer) as SocialPerson["state"];
      const person: SocialPerson = { user, state };
      if (state === "friends" && shares.has(id)) {
        const activity = await this.options.getActivity?.(id);
        if (activity) {
          const access = await this.options.getRoomAccess(activity.roomSlug, viewer);
          if (access.exists && !access.banned && (access.isPublic || access.role)) {
            const name = await this.roomName(activity.roomSlug);
            // Async metadata/access lookups may yield while a friendship or opt-in is revoked.
            const [relationship, currentSharing] = await Promise.all([this.getRelationship(viewer, id), this.sharedActivity([id])]);
            if (name && relationship === "friends" && currentSharing.has(id)) person.room = { slug: activity.roomSlug, name, canJoin: true };
          }
        }
      }
      people.push(person);
    }
    people.sort((a, b) => a.user.name.localeCompare(b.user.name) || a.user.id.localeCompare(b.user.id));
    const invitations: SocialInvitation[] = [];
    for (const row of pending) {
      if (!friendIds.includes(row.sender_id)) continue;
      const from = users.get(row.sender_id); if (!from) continue;
      const [inviter, recipient] = await Promise.all([this.options.getRoomAccess(row.room_slug, row.sender_id), this.options.getRoomAccess(row.room_slug, viewer)]);
      if (!inviter.exists || !inviter.role || !recipient.exists || inviter.banned || recipient.banned || inviter.canInvite===false) continue;
      if (inviter.canInvite===undefined&&!recipient.isPublic && !recipient.role && inviter.role !== "owner" && inviter.role !== "moderator") continue;
      const name = await this.roomName(row.room_slug);
      if (name && await this.getRelationship(viewer, row.sender_id) === "friends") invitations.push({ id: row.id, from, room: { slug: row.room_slug, name }, createdAt: row.created_at, expiresAt: row.expires_at });
    }
    return { people, invitations, ...settings, blockedPeople };
  }
  async searchPeople(viewerId: string, query: string): Promise<User[]> {
    const viewer = checkedId(viewerId), text = query.trim();
    if (text.length < 2) return [];
    if (text.length > 48) throw new SocialError("Search is limited to 48 characters.");
    if (!this.options.supabase) {
      const results: User[] = [];
      for (const user of await this.options.searchProfiles?.(text) || []) {
        if (user.id !== viewer && (!this.options.isProfileVisible || await this.options.isProfileVisible(user.id)) && !await this.isBlocked(viewer, user.id)) results.push(user);
        if (results.length === SOCIAL_LIMITS.search) break;
      }
      return results.slice(0, SOCIAL_LIMITS.search);
    }
    const { data, error } = await this.options.supabase.rpc("soundspin_find_people", { p_actor: viewer, p_query: text });
    if (error) throw socialMutationError(error);
    return ((data || []) as SoundSpinProfile[]).map(profileUser);
  }
  async actOnFriend(actorId: string, targetId: string, action: FriendAction): Promise<FriendState> {
    const actor = checkedId(actorId), target = checkedId(targetId);
    if (actor === target) throw new SocialError("Choose another listener.");
    if (this.options.supabase) {
      const { data, error } = await this.options.supabase.rpc("soundspin_friend_action", { p_actor: actor, p_target: target, p_action: action });
      if (error) throw socialMutationError(error);
      return data as FriendState;
    }
    return this.serialLocal(async () => {
      const users = await this.profiles([actor, target]);
      if (!users.has(actor) || !users.has(target)) throw new SocialError("Listener not found.", 404);
      const relationKey = key(actor, target);
      let current = this.relationships.get(relationKey);
      if (current && this.expired(current)) { this.relationships.delete(relationKey); current = undefined; }
      if ((action === "request" || action === "accept") && await this.isBlocked(actor, target)) throw new SocialError("This listener cannot receive this request.", 403);
      if (action === "request" && !current) {
        if (this.requestSettings.get(target) === false || (this.cooldowns.get(`${actor}:${target}`) || 0) > this.now()) throw new SocialError("This listener cannot receive this request.", 403);
        const live = [...this.relationships.values()].filter(row => !this.expired(row));
        if (live.filter(row => row.status === "pending" && row.requested_by === actor).length >= SOCIAL_LIMITS.pendingSent ||
          live.filter(row => row.status === "pending" && row.requested_by !== target && (row.user_low === target || row.user_high === target)).length >= SOCIAL_LIMITS.pendingReceived) throw new SocialError("Too many pending friend requests.", 429);
        this.requestUsage = this.requestUsage.filter(row => row.at > this.now() - 86_400_000);
        if (this.requestUsage.filter(row => row.actor === actor).length >= SOCIAL_LIMITS.requestDaily || this.requestUsage.filter(row => row.recipient === target).length >= SOCIAL_LIMITS.recipientDaily || this.requestUsage.length >= SOCIAL_LIMITS.requestGlobalDaily) throw new SocialError("Too many friend requests. Try again later.", 429);
        this.requestUsage.push({ actor, recipient: target, at: this.now() });
        const [low, high] = pair(actor, target);
        this.relationships.set(relationKey, { user_low: low, user_high: high, requested_by: actor, status: "pending", updated_at: new Date(this.now()).toISOString() });
      } else if (action === "accept") {
        if (!current) throw new SocialError("Friend request not found.", 404);
        if (current.status === "pending" && current.requested_by === actor) throw new SocialError("Only the recipient can accept this request.", 403);
        if (current.status === "pending" && [actor, target].some(id => [...this.relationships.values()].filter(row => row.status === "accepted" && (row.user_low === id || row.user_high === id)).length >= SOCIAL_LIMITS.people)) throw new SocialError("The friends limit has been reached.");
        this.relationships.set(relationKey, { ...current, status: "accepted", updated_at: new Date(this.now()).toISOString() });
      } else if (action === "decline" || action === "remove") {
        if (action === "decline" && current?.status === "accepted") throw new SocialError("Use Remove friend for an accepted friendship.");
        if (current?.status === "pending" && current.requested_by !== actor) this.cooldowns.set(`${current.requested_by}:${actor}`, this.now() + SOCIAL_LIMITS.declineMs);
        this.relationships.delete(relationKey); return "none";
      }
      return stateFor(this.relationships.get(relationKey) || null, actor);
    });
  }
  async setShareActivity(actorId: string, shareActivity: boolean): Promise<void> {
    const actor = checkedId(actorId);
    if (!this.options.supabase) { this.activitySettings.set(actor, shareActivity); return; }
    const { error } = await this.options.supabase.from("soundspin_social_settings")
      .upsert({ user_id: actor, share_activity: shareActivity, updated_at: new Date(this.now()).toISOString() }, { onConflict: "user_id" });
    if (error) throw new Error(`Could not save activity sharing: ${error.message}`);
  }
  async setReceiveRequests(actorId: string, receiveRequests: boolean): Promise<void> {
    const actor = checkedId(actorId);
    if (!this.options.supabase) { this.requestSettings.set(actor, receiveRequests); return; }
    const { error } = await this.options.supabase.from("soundspin_social_settings").upsert({ user_id: actor, receive_requests: receiveRequests, updated_at: new Date(this.now()).toISOString() }, { onConflict: "user_id" });
    if (error) throw new Error("Could not save friend request settings.");
  }
  async createInvitation(actorId: string, recipientId: string, roomSlug: string): Promise<string> {
    const actor = checkedId(actorId), recipient = checkedId(recipientId);
    if (actor === recipient) throw new SocialError("Choose another listener.");
    if (this.options.supabase) {
      const { data, error } = await this.options.supabase.rpc("soundspin_create_room_invitation", { p_actor: actor, p_recipient: recipient, p_room: roomSlug });
      if (error) throw socialMutationError(error);
      return data as string;
    }
    return this.serialLocal(async () => {
      await this.checkInvitationAccess(actor, recipient, roomSlug);
      const existing = [...this.invitations.values()].find(row => row.sender_id === actor && row.recipient_id === recipient && row.room_slug === roomSlug);
      if (existing && !existing.accepted_at && Date.parse(existing.expires_at) > this.now()) return existing.id;
      for (const [id, row] of this.invitations) if (row.sender_id === actor && (Date.parse(row.expires_at) <= this.now() || id === existing?.id)) this.invitations.delete(id);
      const pending = [...this.invitations.values()].filter(row => !row.accepted_at && Date.parse(row.expires_at) > this.now());
      if (pending.filter(row => row.sender_id === actor).length >= SOCIAL_LIMITS.invitations || pending.filter(row => row.recipient_id === recipient).length >= SOCIAL_LIMITS.invitations) throw new SocialError("Too many pending room invitations.");
      const invitation: Invitation = { id: randomUUID(), sender_id: actor, recipient_id: recipient, room_slug: roomSlug,
        created_at: new Date(this.now()).toISOString(), expires_at: new Date(this.now() + SOCIAL_LIMITS.invitationMs).toISOString(), accepted_at: null };
      this.invitations.set(invitation.id, invitation); return invitation.id;
    });
  }
  private async checkInvitationAccess(actor: string, recipient: string, roomSlug: string) {
    if (await this.getRelationship(actor, recipient) !== "friends") throw new SocialError("Only accepted friends can receive room invitations.", 403);
    const [inviterAccess, recipientAccess] = await Promise.all([this.options.getRoomAccess(roomSlug, actor), this.options.getRoomAccess(roomSlug, recipient)]);
    if (!inviterAccess.exists || !recipientAccess.exists) throw new SocialError("Room not found.", 404);
    if (!inviterAccess.role) throw new SocialError("Join this room before inviting friends.", 403);
    if(inviterAccess.banned||recipientAccess.banned||inviterAccess.canInvite===false)throw new SocialError("You cannot invite this listener to this room.",403);
    if (inviterAccess.canInvite===undefined&&!recipientAccess.isPublic && !recipientAccess.role && inviterAccess.role !== "owner" && inviterAccess.role !== "moderator") throw new SocialError("Only the owner or a moderator can invite a new member to this private room.", 403);
    return recipientAccess;
  }
  async acceptInvitation(actorId: string, invitationId: string): Promise<{ roomSlug: string; passwordRequired: boolean }> {
    const actor = checkedId(actorId), invitation = checkedId(invitationId);
    if (this.options.supabase) {
      const { data, error } = await this.options.supabase.rpc("soundspin_accept_room_invitation", { p_actor: actor, p_invitation: invitation });
      if (error) throw socialMutationError(error);
      return data as { roomSlug: string; passwordRequired: boolean };
    }
    return this.serialLocal(async () => {
      const row = this.invitations.get(invitation);
      if (!row || row.recipient_id !== actor) throw new SocialError("Invitation not found.", 404);
      if (Date.parse(row.expires_at) <= this.now()) throw new SocialError("This invitation has expired.", 410);
      const access = await this.checkInvitationAccess(row.sender_id, actor, row.room_slug);
      if (!access.isPublic && !access.role) {
        if (row.accepted_at) throw new SocialError("Your room access was removed.", 403);
        if (!this.options.grantRoomMember) throw new Error("Private room membership is unavailable.");
        await this.options.grantRoomMember(row.room_slug, actor);
      }
      row.accepted_at ||= new Date(this.now()).toISOString();
      return { roomSlug: row.room_slug, passwordRequired: access.passwordProtected };
    });
  }
}
