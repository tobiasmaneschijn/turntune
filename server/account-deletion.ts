import { serverT } from "./i18n.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueAccountUploadDeletion, enqueueRoomUploadDeletion, cleanupManagedUploads } from "./managed-uploads.js";
import { securityEvent } from "./security-events.js";

export interface DeletionJob { id: string; user_id: string; state: string; owned_room_count: number; owned_room_slugs: string[]; stage: string }
/** Only approved requests are executed. Every step is repeatable; object keys
 * are durably queued before Auth's relational cascades remove their sources. */
export class AccountDeletionService {
  constructor(private readonly client: SupabaseClient, private readonly options: {
    disconnectProviders: (userId: string) => Promise<void>;
    onAccountRestricted: (userId: string) => Promise<void> | void;
    onRoomRestricted: (slug: string) => Promise<void> | void;
    eraseAccountData: (userId: string) => Promise<void>;
  }) {}

  async runNext(): Promise<{ jobId: string; complete: boolean } | null> {
    const claimed = await this.client.rpc("soundspin_claim_account_deletion");
    if (claimed.error) throw new Error(serverT("deletion_queue_could_not_be_read"));
    const job = claimed.data as DeletionJob | null;
    if (!job) return null;
    try {
      await this.advance(job);
      securityEvent("account_deletion", "success", { targetId: job.id });
      return { jobId: job.id, complete: true };
    } catch {
      // Retain no provider/DB exception text, request content, or object URLs.
      const failed = await this.client.from("soundspin_account_deletion_jobs").update({ state: "failed", last_error: "A deletion step failed. Retry after checking service health.", updated_at: new Date().toISOString() }).eq("id", job.id);
      if (failed.error) throw new Error(serverT("deletion_failure_could_not_be_recorded"));
      securityEvent("account_deletion", "failed", { targetId: job.id });
      return { jobId: job.id, complete: false };
    }
  }

  private async stage(job: DeletionJob, stage: string) {
    const result = await this.client.from("soundspin_account_deletion_jobs").update({ stage, updated_at: new Date().toISOString() }).eq("id", job.id);
    if (result.error) throw new Error(serverT("deletion_progress_could_not_be_saved"));
  }

  private async advance(job: DeletionJob) {
    const restricted = await this.client.rpc("soundspin_restrict_deletion_account", { p_job: job.id });
    if (restricted.error) throw new Error(serverT("account_could_not_be_restricted"));
    await this.options.onAccountRestricted(job.user_id);
    const roomResult = await this.client.from("soundspin_rooms").select("slug").eq("owner_id", job.user_id);
    if (roomResult.error) throw new Error(serverT("owned_rooms_could_not_be_inventoried"));
    const rooms = [...new Set([...(job.owned_room_slugs || []), ...(roomResult.data || []).map(room=>String(room.slug))])].map(slug=>({slug}));
    const roomInventory = await this.client.from("soundspin_account_deletion_jobs").update({ owned_room_slugs: rooms.map(room=>room.slug), updated_at: new Date().toISOString() }).eq("id",job.id);
    if (roomInventory.error) throw new Error(serverT("owned_room_inventory_could_not_be_saved"));
    await enqueueAccountUploadDeletion(this.client, job.user_id);
    for (const room of rooms) {
      await enqueueRoomUploadDeletion(this.client, room.slug);
      await this.options.onRoomRestricted(room.slug);
    }
    await this.stage(job, "inventoried");
    // This waits for any in-flight refresh and clears the in-memory token too.
    await this.options.disconnectProviders(job.user_id);
    const connections = await this.client.from("soundspin_music_connections").delete().eq("user_id", job.user_id);
    if (connections.error) throw new Error(serverT("provider_credentials_could_not_be_removed"));
    await this.stage(job, "providers-disconnected");
    await cleanupManagedUploads(this.client, { maxBatches: 10, batchSize: 100, maxMs: 20_000 });
    let pending = this.client.from("soundspin_storage_deletion_outbox").select("storage_path", { count: "exact", head: true }).eq("actor_id", job.user_id);
    const accountPending = await pending;
    if (accountPending.error || accountPending.count) throw new Error(serverT("storage_cleanup_is_still_pending"));
    for (const room of rooms) {
      const roomPending = await this.client.from("soundspin_storage_deletion_outbox").select("storage_path", { count: "exact", head: true }).eq("room_slug", room.slug);
      if (roomPending.error || roomPending.count) throw new Error(serverT("room_storage_cleanup_is_still_pending"));
    }
    await this.stage(job, "storage-deleted");
    // Parent serializes SQL scrubbing with each room's live command queue and
    // refreshes its cache before ordinary room mutations resume.
    await this.options.eraseAccountData(job.user_id);
    let archiveComplete = false;
    for (let batch=0; batch<20; batch++) {
      const scrubbed = await this.client.rpc("soundspin_erase_archived_account", { p_user: job.user_id, p_limit: 1000 });
      if (scrubbed.error) throw new Error(serverT("retained_evidence_could_not_be_minimized"));
      await this.stage(job, "minimizing-retained-evidence");
      if (!scrubbed.data?.remaining) { archiveComplete=true; break; }
    }
    if (!archiveComplete) throw new Error(serverT("retained_evidence_minimization_is_still_pending"));
    await this.stage(job, "retained-evidence-minimized");
    const existing = await this.client.auth.admin.getUserById(job.user_id);
    if (existing.error && existing.error.status !== 404) throw new Error(serverT("account_existence_could_not_be_verified"));
    if (existing.data.user) {
      const removed = await this.client.auth.admin.deleteUser(job.user_id);
      if (removed.error) throw new Error(serverT("authentication_account_could_not_be_removed"));
    }
    await this.options.onAccountRestricted(job.user_id);
    // Cascade cleanup triggers may safely requeue already removed keys. Drain
    // these durable references before recording the final completion receipt.
    await cleanupManagedUploads(this.client, { maxBatches: 10, batchSize: 100, maxMs: 20_000 });
    const afterCascade = await this.client.from("soundspin_storage_deletion_outbox").select("storage_path", { count: "exact", head: true }).eq("actor_id", job.user_id);
    if (afterCascade.error || afterCascade.count) throw new Error(serverT("final_storage_cleanup_is_still_pending"));
    for (const room of rooms) {
      const roomPending = await this.client.from("soundspin_storage_deletion_outbox").select("storage_path", { count: "exact", head: true }).eq("room_slug", room.slug);
      if (roomPending.error || roomPending.count) throw new Error(serverT("final_room_storage_cleanup_is_still_pending"));
    }
    const completed = await this.client.rpc("soundspin_complete_account_deletion", { p_job: job.id });
    if (completed.error) throw new Error(serverT("deletion_receipt_could_not_be_saved"));
  }
}

/** Exports only the requesting account's rows. Pagination remains explicit so
 * a large account cannot silently truncate an access request or exhaust RAM. */
export const accountExportCategories = {
  profile: { table: "soundspin_profiles", filter: "user_id", select: "*", order: ["user_id"] },
  library: { table: "soundspin_private_libraries", filter: "user_id", select: "*", order: ["user_id"] },
  feedback: { table: "soundspin_feedback", filter: "user_id", select: "id,user_id,message,screenshot_paths,room_slug,page_path,viewport,category,impact,diagnostics,status,created_at,updated_at", order: ["id"] },
  messages: { table: "soundspin_messages", filter: "user_id", select: "*", order: ["id"] },
  reactions: { table: "soundspin_message_reactions", filter: "user_id", select: "*", order: ["message_id", "emoji"] },
  votes: { table: "soundspin_poll_votes", filter: "user_id", select: "*", order: ["message_id"] },
  memberships: { table: "soundspin_room_members", filter: "user_id", select: "*", order: ["room_slug"] },
  roomFavorites: { table: "soundspin_room_favorites", filter: "user_id", select: "*", order: ["room_slug"] },
  ownedRooms: { table: "soundspin_rooms", filter: "owner_id", select: "slug,name,is_public,access_mode,settings,created_at,updated_at", order: ["slug"] },
  friendships: { table: "soundspin_friendships", filter: "user_low|user_high", select: "*", order: ["user_low", "user_high"] },
  invitations: { table: "soundspin_room_invitations", filter: "sender_id|recipient_id", select: "*", order: ["id"] },
  blocks: { table: "soundspin_user_blocks", filter: "blocker_id", select: "*", order: ["blocked_id"] },
  providerConnections: { table: "soundspin_music_connections", filter: "user_id", select: "provider,scopes,metadata,created_at,updated_at", order: ["provider"] }
} as const;
