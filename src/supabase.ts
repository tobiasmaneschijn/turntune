import { createClient, type SupabaseClient } from "@supabase/supabase-js";

interface RuntimeConfig {
  supabase: {
    url: string;
    anonKey: string;
  } | null;
}

let clientPromise: Promise<SupabaseClient | null> | null = null;

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
      clientPromise = Promise.resolve(createBrowserClient(viteUrl, vitePublishableKey));
      return clientPromise;
    }

    clientPromise = fetch("/api/config")
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load authentication configuration.");
        return response.json() as Promise<RuntimeConfig>;
      })
      .then(({ supabase }) => {
        if (!supabase) return null;
        return createBrowserClient(supabase.url, supabase.anonKey);
      });
  }
  return clientPromise;
}
