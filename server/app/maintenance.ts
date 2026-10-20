import type { SupabaseClient } from "@supabase/supabase-js";
import { serverT } from "../lib/i18n.js";
import { cleanupManagedUploads } from "../features/uploads/managed-uploads.js";
import type { AccountDeletionService } from "../features/accounts/account-deletion.js";
import type { PlatformSecurity } from "../security/platform-security.js";
import { securityEvent } from "../security/security-events.js";
import { telemetry } from "../observability/index.js";
import type { ResourcePolicyStore } from "../resources/resource-policy.js";
import type { GlobalResourceLimits } from "../../shared/resource-policy.js";

export interface StorageCleanupStatus {
  removed: number;
  remaining: number;
  oldestAt: string | null;
  failed: number;
  lastRunAt: string | null;
}

export interface MaintenanceOptions {
  supabaseAdmin: SupabaseClient | null;
  authEnabled: boolean;
  accountDeletion: Pick<AccountDeletionService, "runNext"> | null;
  platform: Pick<PlatformSecurity, "checkConnections">;
  resourcePolicies: Pick<ResourcePolicyStore, "getGlobal">;
  isShuttingDown: () => boolean;
  connectedAccountIds: () => string[];
  cachedRoomIds: () => string[];
  restrictAccount: (userId: string) => Promise<void>;
  restrictRoom: (roomId: string) => Promise<void>;
  updateResourcePolicy: (limits: GlobalResourceLimits | null) => void;
}

/** Own recurring work without starting it until startup validation completes. */
export function createMaintenance(options: MaintenanceOptions) {
  const { supabaseAdmin, authEnabled, accountDeletion, platform, resourcePolicies, isShuttingDown,
    connectedAccountIds, cachedRoomIds, restrictAccount, restrictRoom, updateResourcePolicy } = options;
  let timers: ReturnType<typeof setInterval>[] = [];
  let mediaCleanup: Promise<void> | null = null;
  let storageCleanupStatus: StorageCleanupStatus = { removed: 0, remaining: 0, oldestAt: null, failed: 0, lastRunAt: null };
  let deletionWork:Promise<void>|null=null,retentionWork:Promise<void>|null=null,connectionChecks:Promise<void>|null=null;
  function cleanManagedMedia() {
    if (!supabaseAdmin || mediaCleanup || isShuttingDown()) return;
    mediaCleanup = cleanupManagedUploads(supabaseAdmin,{maxBatches:20,batchSize:100,maxMs:20_000})
      .then(status=>{storageCleanupStatus={...status,lastRunAt:new Date().toISOString()};if(status.failed)securityEvent("storage_cleanup","failed",{count:status.failed});else if(status.removed)securityEvent("storage_cleanup","success",{count:status.removed});})
      .catch(error=>{storageCleanupStatus.failed++;telemetry.captureError(error,{operation:"maintenance.uploads.cleanup"});securityEvent("storage_cleanup","failed");})
      .finally(() => { mediaCleanup = null; });
  }
  function processDeletion(){
    if(!accountDeletion||deletionWork||isShuttingDown())return;
    deletionWork=accountDeletion.runNext().then(()=>undefined).catch(error=>{telemetry.captureError(error,{operation:"maintenance.account.delete"});securityEvent("account_deletion","failed");}).finally(()=>{deletionWork=null;});
  }
  function pruneRetention(){
    if(!supabaseAdmin||retentionWork||isShuttingDown())return;
    retentionWork=(async()=>{
      const deadline=Date.now()+20_000;
      for(let batch=0;batch<20&&Date.now()<deadline;batch++){
        const [records,archives,chat]=await Promise.all([supabaseAdmin.rpc("soundspin_prune_security_retention"),supabaseAdmin.rpc("soundspin_purge_security_archives",{p_limit:1000}),supabaseAdmin.rpc("soundspin_prune_chat_history",{p_limit:500})]);
        if(records.error||archives.error||chat.error)throw new Error(serverT("retention_maintenance_failed"));
        const counts=[...Object.values(records.data||{}),...Object.values(archives.data||{}),Number(chat.data?.removed??0),Number(chat.data?.updatedReplies??0),chat.data?.hasMoreRooms?1:0];
        if(counts.every(value=>Number(value)===0))break;
      }
    })().catch(error=>{telemetry.captureError(error,{operation:"maintenance.retention.prune"});securityEvent("storage_cleanup","failed");}).finally(()=>{retentionWork=null;});
  }
  function recheckConnections(){
    if(!authEnabled||connectionChecks||isShuttingDown())return;
    connectionChecks=(async()=>{
      const accounts=[...new Set(connectedAccountIds())];
      const rooms=[...new Set(cachedRoomIds())];
      const access = await platform.checkConnections(accounts, rooms);
      const tasks=[...accounts.filter(userId=>access.accounts.get(userId)===false).map(userId=>()=>restrictAccount(userId)),
        ...rooms.filter(roomId=>access.rooms.get(roomId)===false).map(roomId=>()=>restrictRoom(roomId))];
      let index=0;
      await Promise.all(Array.from({length:Math.min(8,tasks.length)},async()=>{while(index<tasks.length&&!isShuttingDown()){const task=tasks[index++];try{await task();}catch(error){telemetry.captureError(error,{operation:"maintenance.connections.restrict"});securityEvent("upstream_failure","failed");}}}));
    })().catch(error=>{telemetry.captureError(error,{operation:"maintenance.connections.check"});securityEvent("upstream_failure","failed");}).finally(()=>{connectionChecks=null;});
  }
  return {
    storageCleanupSnapshot: () => storageCleanupStatus,
    start() {
      cleanManagedMedia();processDeletion();pruneRetention();
      timers = [
        setInterval(cleanManagedMedia, 60_000),
        setInterval(processDeletion, 60_000),
        setInterval(pruneRetention, 3600_000),
        setInterval(recheckConnections, 20_000),
        setInterval(() => {
          void resourcePolicies.getGlobal().then(updateResourcePolicy).catch(error => {
            updateResourcePolicy(null);
            telemetry.captureError(error, { operation: "maintenance.resources.refresh" });
            securityEvent("configuration_failure", "failed");
          });
        }, 15_000)
      ];
      for (const timer of timers) timer.unref();
    },
    stop() {
      for (const timer of timers) clearInterval(timer);
      timers = [];
    },
    async drain() {
      await Promise.allSettled([mediaCleanup,deletionWork,retentionWork,connectionChecks].filter((work):work is Promise<void>=>Boolean(work)));
    }
  };
}
