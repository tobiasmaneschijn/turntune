import i18n from "./i18n";
export interface RuntimeConfig {
  supabase: { url: string; anonKey: string } | null;
}

export function parseRuntimeConfig(value: unknown): RuntimeConfig {
  if (!value || typeof value !== "object" || !("supabase" in value)) {
    throw new Error(i18n.t("common:runtime_config_the_server_returned_invalid_authentication_configuration"));
  }
  const config = (value as Record<string, unknown>).supabase;
  if (config === null) return { supabase: null };
  if (!config || typeof config !== "object") {
    throw new Error(i18n.t("common:runtime_config_the_server_returned_invalid_authentication_configuration"));
  }
  const { url, anonKey } = config as Record<string, unknown>;
  if (typeof url !== "string" || typeof anonKey !== "string" || !anonKey.trim()) {
    throw new Error(i18n.t("common:runtime_config_the_server_returned_invalid_authentication_configuration"));
  }
  const parsedUrl = new URL(url);
  if (!["https:", "http:"].includes(parsedUrl.protocol)) {
    throw new Error(i18n.t("common:runtime_config_the_server_returned_invalid_authentication_configuration"));
  }
  return { supabase: { url, anonKey } };
}
