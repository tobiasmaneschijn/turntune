import { useState } from "react";
import { CircleCheck, Link2, MonitorSpeaker, Music2, Radio, Unplug } from "lucide-react";
import type { PlaybackPreference } from "../playback-settings";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

export interface MusicConnections {
  loaded: boolean;
  spotifyConfigured: boolean;
  spotifyConnected: boolean;
  appleConfigured: boolean;
}

const playbackOptions: Array<{
  value: PlaybackPreference;
  title: string;
  description: string;
  icon: typeof Radio;
}> = [
  {
    value: "source",
    title: "Room source",
    description: "Use the provider attached to each queued track.",
    icon: Radio
  },
  {
    value: "spotify-web",
    title: "Spotify in SoundSpin",
    description: "Play through the Spotify Web Playback device in this browser.",
    icon: Music2
  },
  {
    value: "spotify-desktop",
    title: "Spotify Desktop",
    description: "Send playback to your active Spotify Connect computer.",
    icon: MonitorSpeaker
  },
  {
    value: "apple",
    title: "Apple Music",
    description: "Play matching tracks through MusicKit in SoundSpin.",
    icon: Music2
  }
];

export function UserSettingsDialog({
  preference,
  connections,
  canConnectSpotify,
  onPreferenceChange,
  onConnectSpotify,
  onDisconnectSpotify,
  onClose
}: {
  preference: PlaybackPreference;
  connections: MusicConnections;
  canConnectSpotify: boolean;
  onPreferenceChange: (preference: PlaybackPreference) => void;
  onConnectSpotify: () => void;
  onDisconnectSpotify: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"playback" | "connections">("playback");
  const spotifyUnavailable = connections.loaded && !connections.spotifyConfigured;
  const appleUnavailable = connections.loaded && !connections.appleConfigured;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="user-settings-dialog max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Choose how SoundSpin plays music for you.</DialogDescription>
        </DialogHeader>

        <div className="user-settings-layout">
          <div className="settings-tabs" role="tablist" aria-label="Setting categories">
            <button type="button" role="tab" aria-selected={tab === "playback"} className={tab === "playback" ? "active" : ""} onClick={() => setTab("playback")}>
              <Radio /> Playback
            </button>
            <button type="button" role="tab" aria-selected={tab === "connections"} className={tab === "connections" ? "active" : ""} onClick={() => setTab("connections")}>
              <Link2 /> Connections
            </button>
          </div>

          <div className="settings-tab-panel" role="tabpanel">
            {tab === "playback" ? (
              <>
                <div className="settings-section-heading">
                  <strong>Default playback device</strong>
                  <small>SoundSpin will use this whenever a matching version of the room track is available.</small>
                </div>
                <div className="playback-option-list">
                  {playbackOptions.map((option) => {
                    const unavailable = option.value.startsWith("spotify")
                      ? spotifyUnavailable
                      : option.value === "apple" && appleUnavailable;
                    const selected = preference === option.value;
                    const Icon = option.icon;
                    return (
                      <button
                        type="button"
                        key={option.value}
                        className={selected ? "playback-option selected" : "playback-option"}
                        disabled={unavailable}
                        aria-pressed={selected}
                        onClick={() => onPreferenceChange(option.value)}
                      >
                        <span className="playback-option-icon"><Icon /></span>
                        <span><strong>{option.title}</strong><small>{unavailable ? "Not configured by the host" : option.description}</small></span>
                        {selected && <CircleCheck className="playback-option-check" />}
                      </button>
                    );
                  })}
                </div>
                {preference.startsWith("spotify") && !connections.spotifyConnected && (
                  <div className="settings-inline-notice">
                    <span>Connect Spotify before using this playback device.</span>
                    <Button size="sm" onClick={onConnectSpotify} disabled={!canConnectSpotify || spotifyUnavailable}>Connect Spotify</Button>
                  </div>
                )}
              </>
            ) : (
              <div className="connection-list">
                <div className="connection-row">
                  <span className="connection-logo spotify">S</span>
                  <span><strong>Spotify</strong><small>{connections.spotifyConnected ? "Connected to SoundSpin" : spotifyUnavailable ? "Not configured by the host" : "Connect for web and desktop playback"}</small></span>
                  {connections.spotifyConnected ? (
                    <Button variant="outline" size="sm" onClick={onDisconnectSpotify}><Unplug /> Disconnect</Button>
                  ) : (
                    <Button size="sm" onClick={onConnectSpotify} disabled={!canConnectSpotify || spotifyUnavailable}>Connect</Button>
                  )}
                </div>
                <div className="connection-row">
                  <span className="connection-logo apple">A</span>
                  <span><strong>Apple Music</strong><small>{appleUnavailable ? "Not configured by the host" : "Authorization is requested in the player when needed"}</small></span>
                  <Badge variant="outline">{appleUnavailable ? "Unavailable" : "Available"}</Badge>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
