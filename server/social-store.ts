import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { RoomRole, SoundSpinProfile, User } from "./types.js";

export const SOCIAL_LIMITS = { people: 100, search: 20, invitations: 30, invitationMs: 60 * 60_000 } as const;
export type FriendState = "none" | "friends" | "incoming" | "outgoing";
export type FriendAction = "request" | "accept" | "decline" | "remove";
export interface SocialRoomAccess { exists: boolean; isPublic: boolean; passwordProtected: boolean; role: RoomRole | null; banned?:boolean; canInvite?:boolean }
export interface SocialPerson { user: User; state: Exclude<FriendState, "none">; room?: { slug: string; name: string; canJoin: boolean } }
export interface SocialInvitation { id: string; from: User; room: { slug: string; name: string }; createdAt: string; expiresAt: string }
export interface SocialSnapshot { people: SocialPerson[]; invitations: SocialInvitation[]; shareActivity: boolean }
interface Relationship { user_low: string; user_high: string; requested_by: string; status: "pending" | "accepted"; updated_at: string }
interface Invitation { id: string; sender_id: string; recipient_id: string; room_slug: string; created_at: string; expires_at: string; accepted_at: string | null }
export interface SocialStoreOptions {
  supabase: SupabaseClient | null;
  getRoomAccess: (roomSlug: string, userId: string) => Promise<SocialRoomAccess>;
  getActivity?: (userId: string) => { roomSlug: string } | null | Promise<{ roomSlug: string } | null>;
  getProfile?: (userId: string) => Promise<SoundSpinProfile | User | null>;
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
const PROFILE_IDENTITY_COLUMNS = "user_id, display_name, avatar_key, avatar_url, is_app_admin";
const escapeLike = (query: string) => query.replace(/[\\%_]/g, "\\$&");

/** Only verified HTTP actors reach mutations; room authority is checked again in SQL. */
export class SocialStore {
  private readonly relationships = new Map<string, Relationship>();
  private readonly activitySettings = new Map<string, boolean>();
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
      const { data, error } = await this.options.supabase.from("soundspin_profiles").select(PROFILE_IDENTITY_COLUMNS).in("user_id", unique);
      if (error) throw new Error(`Could not load listeners: ${error.message}`);
      return new Map((data || []).map(profile => { const user = profileUser(profile as SoundSpinProfile); return [user.id, user]; }));
    }
    const entries = await Promise.all(unique.map(async id => {
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
  private async friendRows(userId: string): Promise<Relationship[]> {
    if (!this.options.supabase) return [...this.relationships.values()].filter(row => row.user_low === userId || row.user_high === userId);
    const { data, error } = await this.options.supabase.from("soundspin_friendships")
      .select("user_low, user_high, requested_by, status, updated_at").or(`user_low.eq.${userId},user_high.eq.${userId}`)
      .order("updated_at", { ascending: false }).limit(SOCIAL_LIMITS.people);
    if (error) throw new Error(`Could not load friends: ${error.message}`);
    return (data || []) as Relationship[];
  }
  async getRelationship(viewerId: string, targetId: string): Promise<FriendState> {
    const viewer = checkedId(viewerId), target = checkedId(targetId);
    if (viewer === target) return "none";
    if (!this.options.supabase) return stateFor(this.relationships.get(key(viewer, target)) || null, viewer);
    const [low, high] = pair(viewer, target);
    const { data, error } = await this.options.supabase.from("soundspin_friendships")
      .select("requested_by, status").eq("user_low", low).eq("user_high", high).maybeSingle();
    if (error) throw new Error(`Could not check friendship: ${error.message}`);
    return stateFor(data as Relationship | null, viewer);
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
    const [relationships, pending, sharing] = await Promise.all([this.friendRows(viewer), this.pendingInvitations(viewer), this.sharedActivity([viewer])]);
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
      if (name) invitations.push({ id: row.id, from, room: { slug: row.room_slug, name }, createdAt: row.created_at, expiresAt: row.expires_at });
    }
    return { people, invitations, shareActivity: sharing.has(viewer) };
  }
  async searchPeople(viewerId: string, query: string): Promise<User[]> {
    const viewer = checkedId(viewerId), text = query.trim();
    if (text.length < 2) return [];
    if (text.length > 48) throw new SocialError("Search is limited to 48 characters.");
    if (!this.options.supabase) return (await this.options.searchProfiles?.(text) || []).filter(user => user.id !== viewer).slice(0, SOCIAL_LIMITS.search);
    const searches = await Promise.all(["display_name", "handle"].map(column => this.options.supabase!.from("soundspin_profiles")
      .select(PROFILE_IDENTITY_COLUMNS).neq("user_id", viewer).ilike(column, `%${escapeLike(text)}%`)
      .order("display_name").order("user_id").limit(SOCIAL_LIMITS.search)));
    const users = new Map<string, User>();
    for (const result of searches) {
      if (result.error) throw new Error(`Could not search listeners: ${result.error.message}`);
      for (const profile of result.data || []) { const user = profileUser(profile as SoundSpinProfile); users.set(user.id, user); }
    }
    return [...users.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).slice(0, SOCIAL_LIMITS.search);
  }
  async actOnFriend(actorId: string, targetId: string, action: FriendAction): Promise<FriendState> {
    const actor = checkedId(actorId), target = checkedId(targetId);
    if (actor === target) throw new SocialError("Choose another listener.");
    if (this.options.supabase) {
      const { data, error } = await this.options.supabase.rpc("soundspin_friend_action", { p_actor: actor, p_target: target, p_action: action });
      if (error) throw new SocialError(error.message);
      return data as FriendState;
    }
    return this.serialLocal(async () => {
      const users = await this.profiles([actor, target]);
      if (!users.has(actor) || !users.has(target)) throw new SocialError("Listener not found.", 404);
      const relationKey = key(actor, target), current = this.relationships.get(relationKey);
      if (action === "request" && !current) {
        if ([actor, target].some(id => [...this.relationships.values()].filter(row => row.user_low === id || row.user_high === id).length >= SOCIAL_LIMITS.people)) throw new SocialError("The friends limit has been reached.");
        const [low, high] = pair(actor, target);
        this.relationships.set(relationKey, { user_low: low, user_high: high, requested_by: actor, status: "pending", updated_at: new Date(this.now()).toISOString() });
      } else if (action === "accept") {
        if (!current) throw new SocialError("Friend request not found.", 404);
        if (current.status === "pending" && current.requested_by === actor) throw new SocialError("Only the recipient can accept this request.", 403);
        this.relationships.set(relationKey, { ...current, status: "accepted", updated_at: new Date(this.now()).toISOString() });
      } else if (action === "decline" || action === "remove") {
        if (action === "decline" && current?.status === "accepted") throw new SocialError("Use Remove friend for an accepted friendship.");
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
  async createInvitation(actorId: string, recipientId: string, roomSlug: string): Promise<string> {
    const actor = checkedId(actorId), recipient = checkedId(recipientId);
    if (actor === recipient) throw new SocialError("Choose another listener.");
    if (this.options.supabase) {
      const { data, error } = await this.options.supabase.rpc("soundspin_create_room_invitation", { p_actor: actor, p_recipient: recipient, p_room: roomSlug });
      if (error) throw new SocialError(error.message);
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
      if (error) throw new SocialError(error.message);
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
