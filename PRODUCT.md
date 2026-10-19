# turntune

turntune is a shared listening room application. Listeners play music through supported personal providers, chat, and join a rotating DJ lineup. Each account's waiting queue and saved library are private.

## Room management

The approved [room settings and moderation plan](docs/room-settings-and-moderation-implementation-plan-2026-10-09.md) extends the existing interface. Owners and authorized moderators configure lasting policy, manage members, and act on participants or messages. Public, Unlisted, and Members only access remain distinct from password protection. Roles, membership removal, and bans are separate operations.

General, Music, Chat, and Members organize Room settings. Policy edits use Save changes; participant and member actions apply immediately. Reports, moderation reasons, and staff activity remain private. Temporary session restrictions show their expiry and restore the underlying policy when ended.

The complete approved scope includes reports, warnings, invitation management, optional versioned rules, music policy, vote to skip, multiple songs per turn, fallback music, tags/language, scheduled themes, and presets. Their defaults and limits are recorded in the approved plan. Broad room styling, configurable disconnect grace, history-retention sliders, and lower private queue caps remain outside this change.

## Interface constraints

Preserve the incumbent Geist typography, semantic dark/light theme tokens, shared Base UI controls, room panes, and responsive dialogs. Use labeled rows, contextual menus, and progressive disclosure. Avoid repetitive descriptions and a card for every setting. Controls retain keyboard access, visible focus, named fields, clear errors/status, and 44-pixel mobile actions.

Volume, device/provider preferences within room allowances, notifications, appearance, and panel layout remain personal. Moderator tools never expose another person's waiting queue or library.
