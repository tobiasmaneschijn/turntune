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
