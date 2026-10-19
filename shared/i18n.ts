import { createInstance, type TOptions } from "i18next";
import english from "../src/locales/en/protocol.json" with { type: "json" };

// Shared validation messages are a stable part of the English API contract.
const i18n = createInstance();
void i18n.init({
  resources: { en: { protocol: english } },
  lng: "en",
  fallbackLng: "en",
  defaultNS: "protocol",
  initAsync: false,
  interpolation: { escapeValue: false }
});

export function protocolT(key: string, options?: TOptions): string {
  return i18n.t(key, options || {}) as string;
}
