import { version } from "../package.json";

export const APP_VERSION = version;

export type ChangelogSection = {
  title: "Added" | "Improved" | "Fixed";
  items: readonly string[];
};

export type ChangelogRelease = {
  version: string;
  date: string;
  title: string;
  sections: readonly ChangelogSection[];
};

// Keep the newest release first, with a fixed version number for every entry.
export const CHANGELOG: readonly ChangelogRelease[] = [
  {
    version: "0.1.8",
    date: "2026-10-17",
    title: "Room controls and account privacy",
    sections: [
      {
        title: "Added",
        items: [
          "Room rules, member permissions, reports, warnings, timeouts, and bans.",
          "Block accounts and choose whether to receive friend requests.",
          "Account data export and deletion requests in Settings.",
          "Administrator controls to restrict accounts and rooms, review deletion requests, and record moderation actions.",
        ],
      },
      {
        title: "Improved",
        items: [
          "Room controls for DJ access, track limits, repeat windows, skip voting, and fallback music.",
          "Stronger account verification, private-room access, and permission checks.",
          "Stricter image upload validation and limits on chat, feedback, and room activity.",
        ],
      },
      {
        title: "Fixed",
        items: [
          "Loading older chat messages preserves your reading position.",
          "Duplicate chat submissions and conflicting updates to saved picks and sets.",
          "Spotify and Apple Music sessions reset when you sign out or switch app accounts.",
        ],
      },
    ],
  },
  {
    version: "0.1.7",
    date: "2026-10-09",
    title: "Mixcloud and room music services",
    sections: [{
      title: "Added",
      items: [
        "Mixcloud search, show links, saved picks, and playback.",
        "Owners and moderators can choose which music services a room allows.",
        "Disabled tracks stay saved in private queues and are skipped until their service is allowed again.",
      ],
    }],
  },
  {
    version: "0.1.6",
    date: "2026-10-08",
    title: "YouTube live playback",
    sections: [
      {
        title: "Fixed",
        items: [
          "YouTube livestreams show Live instead of timestamps in the player and track details.",
          "Livestream seek bars are hidden, and playback no longer repeatedly seeks backward.",
        ],
      },
    ],
  },
  {
    version: "0.1.5",
    date: "2026-10-08",
    title: "Chat privacy, commands, and polls",
    sections: [
      {
        title: "Added",
        items: [
          "Hide and unhide chat messages without changing other listeners' views.",
          "Chat shortcuts: /queue opens your queue, /mute toggles room notifications, and /search [text] searches saved messages.",
          "Create polls with /poll [question]: 2–4 options, live results, and one changeable vote per account.",
        ],
      },
      {
        title: "Improved",
        items: [
          "Removed duplicate reaction actions from message menus; reactions remain available on hover.",
        ],
      },
    ],
  },
  {
    version: "0.1.4",
    date: "2026-10-08",
    title: "UI and recovery improvements",
    sections: [
      {
        title: "Improved",
        items: [
          "Room lists without duplicates, grouped room actions, and visible Settings categories on phones.",
          "Clearer chat text, control labels, and admin details, with a daily activity table.",
          "Simpler landing page with invite and music-service requirements.",
          "Faster entry pages and fewer unnecessary artwork downloads.",
        ],
      },
      {
        title: "Fixed",
        items: [
          "Unsaved profile and admin edits are preserved; avatar changes apply on Save.",
          "Save and favorite errors stay with the failed action, with retry controls.",
          "Uploads can be cancelled, and uncertain feedback retries reuse the original submission.",
          "Emoji insertion respects the cursor and selection; navigation restores keyboard focus.",
          "Password-reset recovery actions and Settings when browser storage is unavailable.",
          "Friend removal confirmation and loading feedback.",
        ],
      },
    ],
  },
  {
    version: "0.1.3",
    date: "2026-10-08",
    title: "More compact room layout",
    sections: [
      {
        title: "Improved",
        items: [
          "Smaller player artwork and tighter spacing to reduce scrolling.",
          "Room actions in one menu, with layout choices in a submenu.",
          "Compact theme and announcement strip, with expandable theme details.",
          "Tighter music lists and chat, with search and mute in the chat header.",
        ],
      },
      {
        title: "Fixed",
        items: [
          "Reaction emoji picker scrolling in short mobile windows.",
        ],
      },
    ],
  },
  {
    version: "0.1.2",
    date: "2026-10-08",
    title: "Simpler music sidebar",
    sections: [
      {
        title: "Improved",
        items: [
          "Quieter Add music control.",
          "Track lists directly below Queue, My picks, and History.",
          "Compact DJ status in the footer, with an expandable lineup.",
        ],
      },
    ],
  },
  {
    version: "0.1.1",
    date: "2026-10-08",
    title: "Cleaner music sidebar",
    sections: [
      {
        title: "Improved",
        items: [
          "Music sidebar with Queue, My picks, History, and an expandable DJ lineup.",
          "Add music panel for search and track links, with search results and drafts preserved.",
          "Cleaner track and saved-music menus, plus Save queue as set in Queue actions.",
        ],
      },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-10-06",
    title: "Shared listening",
    sections: [
      {
        title: "Added",
        items: [
          "App version and changelog.",
          "Shared radio rooms with synchronized playback, DJ turns, and private music queues.",
          "Room chat with replies, reactions, images, and GIF search when configured.",
          "Music search and playback options for YouTube, SoundCloud, Spotify, and Apple Music.",
        ],
      },
      {
        title: "Improved",
        items: [
          "Responsive room panels and profiles with display names, bios, avatars, and themes.",
          "In-app feedback and an admin workflow for reviewing reports.",
          "Search stays open while adding songs, with queue actions for touch and keyboard.",
          "Room settings on phones, listener search, and layout reset.",
          "Clearer local playback status, recovery actions, track details, and mute.",
          "Multiline chat, room-specific drafts, and retry for failed history saves.",
          "Artwork transitions and reduced-motion support.",
          "Undo for queued tracks, private picks and saved sets, and playback history with timestamps.",
          "Compact track strip, saved layouts, room commands, and listening setup.",
          "Room previews, recent rooms, host notes, and staged feedback uploads.",
          "Older chat pages, message search, and room notification controls.",
        ],
      },
    ],
  },
];
