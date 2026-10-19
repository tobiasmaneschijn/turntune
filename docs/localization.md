# Localization and brand copy

The product name is **turntune**. Its motto is **Take turns. Pick the Tunes**.

English is the initial supported language. `i18next` and `react-i18next` provide
language detection, fallback, interpolation, and plural rules. All maintained app
copy lives in `src/locales/en/`:

| Catalog | Content |
| --- | --- |
| `public.json` | Public pages, authentication, brand, metadata, and shared chrome |
| `rooms.json` | Directory, room settings, profiles, friends, admin, and feedback |
| `music.json` | Search, queue, favorites, sets, providers, and playback |
| `chat.json` | Messages, polls, reactions, composer, and chat recovery |
| `common.json` | Application shell, shared requests, notifications, and dialogs |
| `changelog.json` | Release notes displayed in the app |
| `server.json` | Server validation, API errors, and policy messages |
| `protocol.json` | Shared command validation and room policy errors |

Components use `useTranslation(namespace)`. Non-React browser helpers use the
instance exported by `src/i18n.ts`. Translate complete messages with named values:

```tsx
const { t } = useTranslation("chat");
t("poll.votes", { count: votes });
```

Use `_one` and `_other` keys for English plurals and the appropriate CLDR plural
forms for each added language. Keep user names, messages, room names, music titles,
and provider identifiers as data. Pass the active locale to `Intl` or
`toLocaleString` for dates and numbers. React escapes interpolated text; do not
insert translations through `dangerouslySetInnerHTML`.

Long-lived provider listeners and timers should call `i18n.t` when they run, or
read a current translator reference. Changing the display language must not
recreate provider widgets, drop a session, or restart playback.

To add a language, copy and translate the catalog files into a new locale folder,
then register the language's namespaces in `src/i18n.ts`. Language detection checks
the `turntune-language` local-storage preference, then the browser language.
Unsupported languages fall back to English. Calling `i18n.changeLanguage(code)`
updates subscribed components, the document language/direction, title, and metadata.
A language picker can be added when another complete translation is available.

Server messages use `server/i18n.ts` and the same locale directory. API responses
currently keep English as their stable default, including policy text used by
existing clients. Shared validation uses `shared/i18n.ts` with `protocol.json` and
also keeps English as the protocol default. `getServerTranslator(language)` creates a fixed translator;
future server locale catalogs should be registered there before selecting a
language per request. Never mutate a global server language for each request.

`index.html` retains English metadata for initial loading and link previews; update
its fallback title and descriptions when changing the matching `public.json` keys.

## Domain transition and compatibility

The official public domain is `turntune.app`. Room links and API navigation stay
relative to the current host. Keep the working domain in `APP_ORIGIN` until the
new DNS, ingress, Supabase redirect allowlist, and music-provider callbacks are
configured. Use `APP_ORIGINS` for additional approved domains during the transition.
This branch changes repository copy; it does not change live DNS or deployment
configuration.

Start Spotify Connect from the host configured in `SPOTIFY_REDIRECT_URI`.
Its authorization cookie belongs to that host; a flow started on a legacy domain
cannot finish on a different callback host. Migrate the active origin, Supabase
Auth redirect allowlist, and music-provider callback allowlists together.

Existing `soundspin_*` database objects, `soundspin-*` browser keys, cookies,
events, stored files, volumes, and `SOUNDSPIN_*` configuration names remain stable.
They hold existing accounts and settings or identify deployed infrastructure.
The GitHub repository URL and historical evidence paths also retain their real
names. These compatibility identifiers are separate from translated display copy.
