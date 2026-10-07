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
    version: "0.1.0",
    date: "2026-10-06",
    title: "Shared listening, kept simple.",
    sections: [
      {
        title: "Added",
        items: [
          "A visible app version and an in-app changelog to keep up with releases.",
          "Shared radio rooms with synchronized playback, DJ turns, and private music queues.",
          "Room chat with replies, reactions, images, and GIF search when configured.",
          "Music search and playback options for YouTube, SoundCloud, Spotify, and Apple Music.",
        ],
      },
      {
        title: "Improved",
        items: [
          "Responsive room panels and simpler profiles with display names, bios, avatars, and themes.",
          "In-app feedback and an admin workflow for reviewing reports.",
          "Search stays open while adding songs, with queue actions for touch and keyboard.",
          "Reachable room settings on phones, a searchable listener list, and layout reset.",
          "Clearer local playback status, recovery actions, track details, and mute.",
          "Multiline chat, room-specific drafts, and retry for failed history saves.",
          "Smoother artwork changes and consistent reduced-motion behavior.",
          "Waiting-track Undo, private picks and saved sets, and richer playback history.",
          "A compact track strip, named layouts, room commands, and first-session listening guidance.",
          "Room previews, recent rooms, host notes, and staged feedback uploads.",
          "Older chat pages, message search, and room notification controls.",
        ],
      },
    ],
  },
];
