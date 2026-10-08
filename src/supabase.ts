import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseRuntimeConfig } from "./runtime-config";
import { scopedFetch } from "./lib/bounded-operation";

let clientPromise: Promise<SupabaseClient> | null = null;
let configurationPromise: Promise<{ url: string; publishableKey: string }> | null = null;

function getConfiguration() {
  if (!configurationPromise) {
    const viteUrl = import.meta.env.VITE_SUPABASE_URL;
    const vitePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    configurationPromise = viteUrl && vitePublishableKey
      ? Promise.resolve({ url: viteUrl, publishableKey: vitePublishableKey })
      : fetch("/api/config", { signal: AbortSignal.timeout(10_000) }).then(async (response) => {
        if (!response.ok) throw new Error("Could not load authentication configuration.");
        const { supabase } = parseRuntimeConfig(await response.json());
        if (!supabase?.url || !supabase.anonKey) throw new Error("Supabase authentication is not configured.");
        return { url: supabase.url, publishableKey: supabase.anonKey };
      });
    configurationPromise = configurationPromise.catch((error: unknown) => { configurationPromise = null; throw error; });
  }
  return configurationPromise;
}

function createBrowserClient(url: string, publishableKey: string) {
  return createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "soundspin-auth"
    }
  });
}

export function getSupabaseClient() {
  if (!clientPromise) {
    clientPromise = getConfiguration().then(({ url, publishableKey }) => createBrowserClient(url, publishableKey));
    // A temporary network error must not poison every future attempt.
    clientPromise = clientPromise.catch((error: unknown) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

/** Storage uploads lack an abortSignal option. An isolated supported client gives
 * each operation a cancellable fetch and freezes its original account token.
 */
export async function getScopedSupabaseClient(source: SupabaseClient, expectedUserId: string, signal: AbortSignal) {
  const { data, error } = await source.auth.getSession();
  if (error) throw error;
  if (!data.session || data.session.user.id !== expectedUserId) throw new Error("Your account changed. Try again with the current account.");
  const token = data.session.access_token;
  const { url, publishableKey } = await getConfiguration();
  signal.throwIfAborted();
  return createClient(url, publishableKey, {
    accessToken: async () => token,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: scopedFetch(signal) }
  });
}
