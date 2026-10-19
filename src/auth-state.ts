import type { AuthChangeEvent } from "@supabase/supabase-js";

export function recoveryAfterAuthEvent(event: AuthChangeEvent, currentRecovery: boolean, initializingRecovery: boolean) {
  if (event === "PASSWORD_RECOVERY") return true;
  if (event === "SIGNED_OUT") return false;
  return currentRecovery || initializingRecovery;
}
