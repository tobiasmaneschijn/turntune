import { useCallback, useEffect, useState } from "react";
import { Bell, CircleCheck, Link2, MonitorSpeaker, Music2, Palette, Radio, RefreshCw, Unplug } from "lucide-react";
import type { PlaybackPreference, SoundSpinUserSettings } from "../playback-settings";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

interface SpotifyDevice {
  id: string | null;
  name: string;
  type: string;
  is_active: boolean;
  is_restricted: boolean;
}

export interface MusicConnections {
  loaded: boolean;
  spotifyConfigured: boolean;
  spotifyConnected: boolean;
  spotifyProfile?: { displayName: string; product?: string } | null;
  appleConfigured: boolean;
}

const playbackOptions: Array<{
  value: PlaybackPreference;
  title: string;
  description: string;
  icon: typeof Radio;
}> = [
  { value: "source", title: "Room source", description: "Use the provider attached to each queued track.", icon: Radio },
  { value: "spotify-web", title: "Spotify in SoundSpin", description: "Play through the Spotify device in this browser.", icon: Music2 },
  { value: "spotify-desktop", title: "Spotify Desktop", description: "Send playback to a selected Spotify Connect device.", icon: MonitorSpeaker },
  { value: "apple", title: "Apple Music", description: "Play matching tracks through MusicKit in SoundSpin.", icon: Music2 }
];

export function UserSettingsDialog({
  settings,
  connections,
  accessToken,
  onSettingsChange,
  onConnectSpotify,
  onDisconnectSpotify,
  onClose
}: {
  settings: SoundSpinUserSettings;
  connections: MusicConnections;
  accessToken?: string;
  onSettingsChange: (settings: SoundSpinUserSettings) => void;
  onConnectSpotify: () => void;
  onDisconnectSpotify: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"playback" | "connections" | "notifications" | "appearance">("playback");
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [deviceError, setDeviceError] = useState("");
  const [appleAuthorized, setAppleAuthorized] = useState(() => localStorage.getItem("soundspin-apple-authorized") === "true");
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(() =>
    "Notification" in window ? Notification.permission : "denied"
  );
  const spotifyUnavailable = connections.loaded && !connections.spotifyConfigured;
  const appleUnavailable = connections.loaded && !connections.appleConfigured;
  const selectedSpotifyDevice = devices.find((device) => device.id === settings.playback.spotifyDeviceId) ||
    devices.find((device) => device.is_active);

  const updatePlayback = (patch: Partial<SoundSpinUserSettings["playback"]>) => onSettingsChange({
    ...settings,
    playback: { ...settings.playback, ...patch }
  });
  const updateAppearance = (patch: Partial<SoundSpinUserSettings["appearance"]>) => onSettingsChange({
    ...settings,
    appearance: { ...settings.appearance, ...patch }
  });

  const refreshDevices = useCallback(() => {
    if (!accessToken || !connections.spotifyConnected) return;
    setLoadingDevices(true);
    setDeviceError("");
    void fetch("/api/spotify/devices", { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(async (response) => {
        const payload = await response.json() as { devices?: SpotifyDevice[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Could not load Spotify devices.");
        setDevices((payload.devices || []).filter((device) => device.id && !device.is_restricted));
      })
      .catch((error) => setDeviceError(error instanceof Error ? error.message : "Could not load Spotify devices."))
      .finally(() => setLoadingDevices(false));
  }, [accessToken, connections.spotifyConnected]);

  useEffect(() => {
    if ((tab === "playback" || tab === "connections") && connections.spotifyConnected && !devices.length) refreshDevices();
  }, [tab, connections.spotifyConnected, devices.length, refreshDevices]);

  useEffect(() => {
    const update = () => setAppleAuthorized(localStorage.getItem("soundspin-apple-authorized") === "true");
    window.addEventListener("soundspin:apple-authorization", update);
    return () => window.removeEventListener("soundspin:apple-authorization", update);
  }, []);

  const updateNotification = async (key: keyof SoundSpinUserSettings["notifications"], enabled: boolean) => {
    if (enabled && "Notification" in window && Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission !== "granted") return;
    }
    onSettingsChange({
      ...settings,
      notifications: { ...settings.notifications, [key]: enabled }
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="user-settings-dialog max-w-3xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Customize playback, connected services, notifications, and appearance.</DialogDescription>
        </DialogHeader>

        <div className="user-settings-layout">
          <div className="settings-tabs" role="tablist" aria-label="Setting categories">
            <button type="button" role="tab" aria-selected={tab === "playback"} className={tab === "playback" ? "active" : ""} onClick={() => setTab("playback")}><Radio /> Playback</button>
            <button type="button" role="tab" aria-selected={tab === "connections"} className={tab === "connections" ? "active" : ""} onClick={() => setTab("connections")}><Link2 /> Connections</button>
            <button type="button" role="tab" aria-selected={tab === "notifications"} className={tab === "notifications" ? "active" : ""} onClick={() => setTab("notifications")}><Bell /> Notifications</button>
            <button type="button" role="tab" aria-selected={tab === "appearance"} className={tab === "appearance" ? "active" : ""} onClick={() => setTab("appearance")}><Palette /> Appearance</button>
          </div>

          <div className="settings-tab-panel" role="tabpanel">
            {tab === "playback" && (
              <div className="settings-panel-stack">
                <section>
                  <div className="settings-section-heading"><strong>Default playback device</strong><small>Used whenever a matching version of the room track is available.</small></div>
                  <div className="playback-option-list">
                    {playbackOptions.map((option) => {
                      const unavailable = option.value.startsWith("spotify") ? spotifyUnavailable : option.value === "apple" && appleUnavailable;
                      const selected = settings.playback.preference === option.value;
                      const Icon = option.icon;
                      return (
                        <button type="button" key={option.value} className={selected ? "playback-option selected" : "playback-option"} disabled={unavailable} aria-pressed={selected} onClick={() => updatePlayback({ preference: option.value })}>
                          <span className="playback-option-icon"><Icon /></span>
                          <span><strong>{option.title}</strong><small>{unavailable ? "Not configured by the host" : option.description}</small></span>
                          {selected && <CircleCheck className="playback-option-check" />}
                        </button>
                      );
                    })}
                  </div>
                  {settings.playback.preference.startsWith("spotify") && !connections.spotifyConnected && (
                    <div className="settings-inline-notice">
                      <span>Connect Spotify before using this playback device.</span>
                      <Button size="sm" onClick={onConnectSpotify} disabled={!accessToken || spotifyUnavailable}>Connect Spotify</Button>
                    </div>
                  )}
                </section>

                <section className="settings-control-group">
                  <Label htmlFor="default-volume">Default volume <strong>{settings.playback.defaultVolume}%</strong></Label>
                  <input id="default-volume" type="range" min={0} max={100} value={settings.playback.defaultVolume} onChange={(event) => updatePlayback({ defaultVolume: Number(event.target.value) })} />
                </section>

                {settings.playback.preference === "spotify-desktop" && (
                  <section className="settings-control-group">
                    <Label htmlFor="spotify-device">Spotify Connect device</Label>
                    <div className="settings-select-row">
                      <select id="spotify-device" value={settings.playback.spotifyDeviceId} onChange={(event) => updatePlayback({ spotifyDeviceId: event.target.value })} disabled={!devices.length}>
                        <option value="">Automatic selection</option>
                        {devices.map((device) => <option key={device.id!} value={device.id!}>{device.name} · {device.type}{device.is_active ? " · Active" : ""}</option>)}
                      </select>
                      <Button variant="outline" size="icon" onClick={refreshDevices} disabled={loadingDevices} title="Refresh Spotify devices"><RefreshCw className={loadingDevices ? "spin" : ""} /></Button>
                    </div>
                    {deviceError && <small className="settings-field-error">{deviceError}</small>}
                  </section>
                )}

                <section className="settings-control-group">
                  <Label htmlFor="fallback-behavior">When the preferred provider has no match</Label>
                  <select id="fallback-behavior" value={settings.playback.fallback} onChange={(event) => updatePlayback({ fallback: event.target.value as SoundSpinUserSettings["playback"]["fallback"] })}>
                    <option value="source">Use the room source automatically</option>
                    <option value="ask">Ask for each unavailable track</option>
                    <option value="silent">Keep local playback silent</option>
                  </select>
                </section>

                <SettingSwitch title="Resume after reconnecting" description="Catch up to the room automatically when the playback device reconnects." checked={settings.playback.resumeAfterReconnect} onChange={(checked) => updatePlayback({ resumeAfterReconnect: checked })} />
              </div>
            )}

            {tab === "connections" && (
              <div className="connection-list">
                <div className="connection-row connection-row-expanded">
                  <span className="connection-logo spotify">S</span>
                  <span><strong>{connections.spotifyProfile?.displayName || "Spotify"}</strong><small>{connections.spotifyConnected ? `${connections.spotifyProfile?.product === "premium" ? "Premium" : "Connected"} · ${selectedSpotifyDevice ? `Selected: ${selectedSpotifyDevice.name}` : `${devices.length} playback device${devices.length === 1 ? "" : "s"} found`}` : spotifyUnavailable ? "Not configured by the host" : "Connect for web and desktop playback"}</small></span>
                  <span className="connection-actions">
                    {connections.spotifyConnected && <Button variant="ghost" size="sm" onClick={refreshDevices}><RefreshCw /> Refresh</Button>}
                    <Button variant="outline" size="sm" onClick={onConnectSpotify} disabled={!accessToken || spotifyUnavailable}>{connections.spotifyConnected ? "Reconnect" : "Connect"}</Button>
                    {connections.spotifyConnected && <Button variant="ghost" size="sm" onClick={onDisconnectSpotify}><Unplug /> Disconnect</Button>}
                  </span>
                </div>
                <div className="connection-row">
                  <span className="connection-logo apple">A</span>
                  <span><strong>Apple Music</strong><small>{appleUnavailable ? "Not configured by the host" : appleAuthorized ? "Authorized in this browser" : "Authorization is requested when first used"}</small></span>
                  <Badge variant="outline">{appleUnavailable ? "Unavailable" : appleAuthorized ? "Authorized" : "Available"}</Badge>
                </div>
                {deviceError && <div className="dialog-error">{deviceError}</div>}
              </div>
            )}

            {tab === "notifications" && (
              <div className="settings-panel-stack">
                {notificationPermission !== "granted" && <div className="settings-inline-notice"><span>Browser permission is required for system notifications.</span><Button size="sm" onClick={() => void Notification.requestPermission().then(setNotificationPermission)} disabled={!("Notification" in window)}>Enable notifications</Button></div>}
                <SettingSwitch title="DJ turn" description="Notify me when my turn on the decks begins." checked={settings.notifications.djTurn} onChange={(checked) => void updateNotification("djTurn", checked)} />
                <SettingSwitch title="Unavailable tracks" description="Notify me when my preferred provider has no matching recording." checked={settings.notifications.unavailableTrack} onChange={(checked) => void updateNotification("unavailableTrack", checked)} />
                <SettingSwitch title="Chat mentions" description="Notify me when another listener mentions my display name." checked={settings.notifications.chatMentions} onChange={(checked) => void updateNotification("chatMentions", checked)} />
                <SettingSwitch title="Playback errors" description="Notify me when the selected playback device fails." checked={settings.notifications.playbackErrors} onChange={(checked) => void updateNotification("playbackErrors", checked)} />
              </div>
            )}

            {tab === "appearance" && (
              <div className="settings-panel-stack">
                <SettingSwitch title="Compact player by default" description="Keep the center player collapsed between visits." checked={settings.playback.compactPlayer} onChange={(checked) => updatePlayback({ compactPlayer: checked })} />
                <SettingSwitch title="Reduced motion" description="Disable decorative transitions and movement." checked={settings.appearance.reducedMotion} onChange={(checked) => updateAppearance({ reducedMotion: checked })} />
                <section className="settings-control-group">
                  <Label htmlFor="artwork-blur">Artwork background blur <strong>{settings.appearance.artworkBlur}px</strong></Label>
                  <input id="artwork-blur" type="range" min={0} max={60} value={settings.appearance.artworkBlur} onChange={(event) => updateAppearance({ artworkBlur: Number(event.target.value) })} />
                </section>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingSwitch({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="settings-switch-row">
      <span><strong>{title}</strong><small>{description}</small></span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}
