export interface RuntimeConfig {
  supabase: { url: string; anonKey: string } | null;
}

export function parseRuntimeConfig(value: unknown): RuntimeConfig {
  if (!value || typeof value !== "object" || !("supabase" in value)) {
    throw new Error("The server returned invalid authentication configuration.");
  }
  const config = (value as Record<string, unknown>).supabase;
  if (config === null) return { supabase: null };
  if (!config || typeof config !== "object") {
    throw new Error("The server returned invalid authentication configuration.");
  }
  const { url, anonKey } = config as Record<string, unknown>;
  if (typeof url !== "string" || typeof anonKey !== "string" || !anonKey.trim()) {
    throw new Error("The server returned invalid authentication configuration.");
  }
  const parsedUrl = new URL(url);
  if (!["https:", "http:"].includes(parsedUrl.protocol)) {
    throw new Error("The server returned invalid authentication configuration.");
  }
  return { supabase: { url, anonKey } };
}
