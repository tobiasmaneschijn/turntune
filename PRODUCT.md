# turntune

turntune is a shared listening room application. Listeners play music through supported personal providers, chat, and join a rotating DJ lineup. Each account's waiting queue and saved library are private.

## Room management

Owners and authorized moderators configure room policy, manage members, and act on participants or messages. Public, Unlisted, and Members only access remain distinct from password protection. Roles, membership removal, and bans are separate operations. See [rooms and radio](docs/rooms-and-radio.md) for permissions, persistence, and playback behavior.

General, Music, Chat, and Members organize Room settings. Policy edits use Save changes; participant and member actions apply immediately. Reports, moderation reasons, and staff activity remain private. Temporary session restrictions show their expiry and restore the underlying policy when ended.

Room controls include reports, warnings, invitations, optional versioned rules, music policy, vote to skip, multiple songs per turn, fallback music, tags/language, scheduled themes, and presets. Resource and retention limits are operator configuration; see [resource limits](docs/resource-limits.md).

## Interface constraints

The app uses the approved Open room system throughout: Inter, neutral light/dark
surfaces, violet actions, and a shared Light, Dark, or System preference. The room
places shared activity beside conversation and a private cover-art queue, with
one persistent bottom player. Provider widgets and an expanded player are not
part of the room UI. See [DESIGN.md](DESIGN.md) for shared tokens and
[the listening-room brief](docs/design/listening-room.md) for room composition.

Reuse shared Base UI controls and responsive dialogs. Use labeled rows,
contextual menus, and progressive disclosure. Avoid repetitive descriptions and
a card for every setting. Controls retain keyboard access, visible focus, named
fields, clear errors/status, and 44-pixel mobile actions.

Omit routine status subtext. Supporting text should explain a restriction,
error, consequence, or action that is not already clear from the controls.

Volume, device/provider preferences within room allowances, notifications, appearance, and panel layout remain personal. Moderator tools never expose another person's waiting queue or library.
