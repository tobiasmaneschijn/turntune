import { createInstance } from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import common from "./locales/en/common.json";
import publicCopy from "./locales/en/public.json";
import rooms from "./locales/en/rooms.json";
import music from "./locales/en/music.json";
import chat from "./locales/en/chat.json";
import changelog from "./locales/en/changelog.json";

/** Add complete locale catalogs here; unsupported languages fall back to English. */
export const resources = {
  en: { common, public: publicCopy, rooms, music, chat, changelog }
};

const i18n = createInstance();
i18n.use(LanguageDetector).use(initReactI18next);
void i18n.init({
  resources,
  supportedLngs: Object.keys(resources),
  fallbackLng: "en",
  defaultNS: "common",
  initAsync: false,
  interpolation: { escapeValue: false },
  detection: {
    order: ["localStorage", "navigator"],
    lookupLocalStorage: "turntune-language",
    caches: ["localStorage"]
  },
  react: { useSuspense: false }
});

function syncDocumentLanguage() {
  if (typeof document === "undefined") return;
  const language = i18n.resolvedLanguage || "en";
  document.documentElement.lang = language;
  document.documentElement.dir = i18n.dir(language);
  document.title = i18n.t("public:metaTitle");
  const metadata = {
    'meta[name="description"]': "public:metaDescription",
    'meta[property="og:title"]': "public:metaTitle",
    'meta[property="og:description"]': "public:metaSocialDescription"
  };
  Object.entries(metadata).forEach(([selector, key]) => {
    document.querySelector(selector)?.setAttribute("content", i18n.t(key));
  });
}

i18n.on("languageChanged", syncDocumentLanguage);
syncDocumentLanguage();

export default i18n;
