import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseRuntimeConfig } from "./runtime-config";

let clientPromise: Promise<SupabaseClient> | null = null;

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
    const viteUrl = import.meta.env.VITE_SUPABASE_URL;
    const vitePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    if (viteUrl && vitePublishableKey) {
      clientPromise = Promise.resolve().then(() => createBrowserClient(viteUrl, vitePublishableKey));
    } else {
      clientPromise = fetch("/api/config", { signal: AbortSignal.timeout(10_000) })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load authentication configuration.");
        return parseRuntimeConfig(await response.json());
      })
      .then(({ supabase }) => {
        if (!supabase?.url || !supabase.anonKey) {
          throw new Error("Supabase authentication is not configured.");
        }
        return createBrowserClient(supabase.url, supabase.anonKey);
      });
    }
    // A temporary network error must not poison every future attempt.
    clientPromise = clientPromise.catch((error: unknown) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}
