import { createInstance, type TOptions } from "i18next";
import english from "../../src/locales/en/server.json" with { type: "json" };

// API errors keep a stable English default. Each caller can request a fixed
// translator without changing global language across concurrent requests.
const i18n = createInstance();
void i18n.init({
  resources: { en: { server: english } },
  lng: "en",
  fallbackLng: "en",
  defaultNS: "server",
  initAsync: false,
  interpolation: { escapeValue: false }
});

export const getServerTranslator = (language = "en") => i18n.getFixedT(language, "server");
export function serverT(key: string, options?: TOptions): string {
  return getServerTranslator()(key, options || {}) as string;
}
