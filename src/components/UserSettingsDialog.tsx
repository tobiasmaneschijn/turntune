import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CircleCheck, Link2, MonitorSpeaker, Music2, Palette, Radio, RefreshCw, Unplug } from "lucide-react";
import { useTheme } from "next-themes";
import type { PlaybackPreference, SoundSpinUserSettings } from "../playback-settings";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { Slider } from "./ui/slider";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { useMediaQuery } from "../hooks/use-media-query";
import { notificationPermissionDescription, readNotificationPermission, requestNotificationPermission } from "../notifications";

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
  { value: "spotify-web", title: "Spotify in Lydman", description: "Play through the Spotify device in this browser.", icon: Music2 },
  { value: "spotify-desktop", title: "Spotify Desktop", description: "Send playback to a selected Spotify Connect device.", icon: MonitorSpeaker },
  { value: "apple", title: "Apple Music", description: "Play matching tracks through MusicKit in Lydman.", icon: Music2 }
];

export function UserSettingsDialog({
  settings,
  connections,
  accessToken,
  onSettingsChange,
  onConnectSpotify,
  onDisconnectSpotify,
  connectionError,
  onRetryConnections,
  onClose
}: {
  settings: SoundSpinUserSettings;
  connections: MusicConnections;
  accessToken?: string;
  onSettingsChange: (settings: SoundSpinUserSettings) => void;
  onConnectSpotify: () => void;
  onDisconnectSpotify: () => void;
  connectionError?: string;
  onRetryConnections?: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"playback" | "connections" | "notifications" | "appearance">("playback");
  const isMobile = useMediaQuery("(max-width: 600px)");
  const categoriesRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    if (!isMobile) return;
    const frame = requestAnimationFrame(() => {
      const list = categoriesRef.current;
      const selected = list?.querySelector<HTMLElement>(`[data-settings-category="${tab}"]`);
      if (!list || !selected) return;
      const bounds = list.getBoundingClientRect();
      const target = selected.getBoundingClientRect();
      const inset = 8;
      if (target.left < bounds.left + inset) list.scrollLeft += target.left - bounds.left - inset;
      else if (target.right > bounds.right - inset) list.scrollLeft += target.right - bounds.right + inset;
    });
    return () => cancelAnimationFrame(frame);
  }, [tab, isMobile]);
  const { theme = settings.appearance.theme, setTheme } = useTheme();
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [deviceError, setDeviceError] = useState("");
  const [appleAuthorized, setAppleAuthorized] = useState(() => localStorage.getItem("soundspin-apple-authorized") === "true");
  const [notificationPermission, setNotificationPermission] = useState(readNotificationPermission);
  const [requestingPermission, setRequestingPermission] = useState(false);
  useEffect(() => {
    const refresh = () => setNotificationPermission(readNotificationPermission());
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
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
  const updateTheme = (nextTheme: SoundSpinUserSettings["appearance"]["theme"]) => {
    setTheme(nextTheme);
    updateAppearance({ theme: nextTheme });
  };

  const refreshDevices = useCallback(() => {
    if (!accessToken || !connections.spotifyConnected) return;
    setLoadingDevices(true);
    setDeviceError("");
    void fetch("/api/spotify/devices", { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(async (response) => {
        const payload = await response.json() as { devices?: SpotifyDevice[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Could not load Spotify devices.");
        setDevices((payload.devices || []).filter((device) => device.id && !device.is_restricted));
        setDevicesLoaded(true);
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

  const updateNotification = (key: keyof SoundSpinUserSettings["notifications"], enabled: boolean) => {
    onSettingsChange({
      ...settings,
      notifications: { ...settings.notifications, [key]: enabled }
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="user-settings-dialog max-w-3xl" finalFocus={() => {
        const previous = returnFocusRef.current;
        return previous?.isConnected && previous !== document.body ? previous
          : document.querySelector<HTMLButtonElement>(".room-more-actions") ?? true;
      }}>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Customize playback, connected services, notifications, and appearance.</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)} orientation={isMobile ? "horizontal" : "vertical"} className="user-settings-layout">
          <TabsList ref={categoriesRef} className="settings-tabs" aria-label="Setting categories" activateOnFocus>
            <TabsTrigger value="playback" data-settings-category="playback"><Radio /> Playback</TabsTrigger>
            <TabsTrigger value="connections" data-settings-category="connections"><Link2 /> Connections</TabsTrigger>
            <TabsTrigger value="notifications" data-settings-category="notifications"><Bell /> Notifications</TabsTrigger>
            <TabsTrigger value="appearance" data-settings-category="appearance"><Palette /> Appearance</TabsTrigger>
          </TabsList>

          <div className="settings-tab-panel">
            <TabsContent value="playback">
              <div className="settings-panel-stack">
                <section>
                  <div className="settings-section-heading"><strong>Default playback device</strong><small>Used whenever a matching version of the room track is available.</small></div>
                  <ToggleGroup className="playback-option-list" aria-label="Default playback device">
                    {playbackOptions.map((option) => {
                      const unavailable = option.value.startsWith("spotify") ? spotifyUnavailable : option.value === "apple" && appleUnavailable;
                      const selected = settings.playback.preference === option.value;
                      const Icon = option.icon;
                      return (
                        <ToggleGroupItem key={option.value} className={selected ? "playback-option selected" : "playback-option"} disabled={unavailable} pressed={selected} onPressedChange={() => updatePlayback({ preference: option.value })}>
                          <span className="playback-option-icon"><Icon /></span>
                          <span><strong>{option.title}</strong><small>{unavailable ? "Not configured by the host" : option.description}</small></span>
                          {selected && <CircleCheck className="playback-option-check" />}
                        </ToggleGroupItem>
                      );
                    })}
                  </ToggleGroup>
                  {settings.playback.preference.startsWith("spotify") && !connections.spotifyConnected && (
                    <div className="settings-inline-notice">
                      <span>Connect Spotify before using this playback device.</span>
                      <Button size="sm" onClick={onConnectSpotify} disabled={!accessToken || spotifyUnavailable}>Connect Spotify</Button>
                    </div>
                  )}
                </section>

                <section className="settings-control-group">
                  <Label htmlFor="default-volume">Default volume <strong>{settings.playback.defaultVolume}%</strong></Label>
                  <Slider id="default-volume" min={0} max={100} value={[settings.playback.defaultVolume]} onValueChange={(value) => updatePlayback({ defaultVolume: typeof value === "number" ? value : value[0] })} aria-label="Default volume" getAriaValueText={(_formatted, value) => `${value} percent`} />
                </section>

                {settings.playback.preference === "spotify-desktop" && (
                  <section className="settings-control-group">
                    <Label htmlFor="spotify-device">Spotify Connect device</Label>
                    <div className="settings-select-row">
                      <Select value={settings.playback.spotifyDeviceId || "automatic"} onValueChange={(value) => updatePlayback({ spotifyDeviceId: !value || value === "automatic" ? "" : value })}>
                        <SelectTrigger id="spotify-device" className="w-full" disabled={!devices.length}><SelectValue>{settings.playback.spotifyDeviceId ? devices.find(device => device.id === settings.playback.spotifyDeviceId)?.name || "Selected device unavailable" : "Automatic selection"}</SelectValue></SelectTrigger>
                        <SelectContent><SelectGroup>
                          <SelectItem value="automatic">Automatic selection</SelectItem>
                          {devices.map((device) => <SelectItem key={device.id!} value={device.id!}>{device.name} · {device.type}{device.is_active ? " · Active" : ""}</SelectItem>)}
                        </SelectGroup></SelectContent>
                      </Select>
                      <Button variant="outline" size="icon" onClick={refreshDevices} disabled={loadingDevices} title="Refresh Spotify devices" aria-label="Refresh Spotify devices"><RefreshCw className={loadingDevices ? "spin" : ""} /></Button>
                    </div>
                    {deviceError && <small className="settings-field-error">{deviceError}</small>}
                    {connections.spotifyConnected && devicesLoaded && !loadingDevices && !deviceError && !devices.length && <p className="settings-empty-devices" role="status">No available Spotify devices yet. Open Spotify on a device, then Refresh devices.</p>}
                  </section>
                )}

                <section className="settings-control-group">
                  <Label htmlFor="fallback-behavior">When the preferred provider has no match</Label>
                  <Select value={settings.playback.fallback} onValueChange={(value) => updatePlayback({ fallback: value as SoundSpinUserSettings["playback"]["fallback"] })}>
                    <SelectTrigger id="fallback-behavior" className="w-full"><SelectValue>{settings.playback.fallback === "ask" ? "Ask for each unavailable track" : settings.playback.fallback === "silent" ? "Keep local playback silent" : "Use the room source automatically"}</SelectValue></SelectTrigger>
                    <SelectContent><SelectGroup>
                      <SelectItem value="source">Use the room source automatically</SelectItem>
                      <SelectItem value="ask">Ask for each unavailable track</SelectItem>
                      <SelectItem value="silent">Keep local playback silent</SelectItem>
                    </SelectGroup></SelectContent>
                  </Select>
                </section>

                <SettingSwitch title="Resume after reconnecting" description="Catch up to the room automatically when the playback device reconnects." checked={settings.playback.resumeAfterReconnect} onChange={(checked) => updatePlayback({ resumeAfterReconnect: checked })} />
              </div>
            </TabsContent>

            <TabsContent value="connections">
              <div className="connection-list">
                {connectionError && <div className="settings-inline-notice" role="alert"><span>{connectionError}</span>{onRetryConnections && <Button size="sm" variant="outline" onClick={onRetryConnections}>Retry connection check</Button>}</div>}
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
                {connections.spotifyConnected && devicesLoaded && !loadingDevices && !deviceError && !devices.length && <p className="settings-empty-devices" role="status">No available Spotify devices yet. Open Spotify on a device, then Refresh devices.</p>}
              </div>
            </TabsContent>

            <TabsContent value="notifications">
              <div className="settings-panel-stack">
                <div className="settings-inline-notice"><span>{notificationPermissionDescription(notificationPermission)}</span>{notificationPermission === "default" && <Button size="sm" disabled={requestingPermission} onClick={() => {
                  setRequestingPermission(true);
                  void requestNotificationPermission().then(setNotificationPermission).finally(() => setRequestingPermission(false));
                }}>{requestingPermission ? "Requesting permission…" : "Enable notifications"}</Button>}</div>
                <SettingSwitch title="Notify when Lydman is in the background" description="Use system notifications when this tab is hidden or unfocused. In-app feedback remains available while you are here." checked={settings.notifications.backgroundOnly !== false} onChange={(checked) => updateNotification("backgroundOnly", checked)} />
                <SettingSwitch title="DJ turn" description="Notify me when my on-air turn begins." checked={settings.notifications.djTurn} onChange={(checked) => void updateNotification("djTurn", checked)} />
                <SettingSwitch title="Unavailable tracks" description="Notify me when my preferred provider has no matching recording." checked={settings.notifications.unavailableTrack} onChange={(checked) => void updateNotification("unavailableTrack", checked)} />
                <SettingSwitch title="Chat mentions" description="Notify me when another listener mentions my display name." checked={settings.notifications.chatMentions} onChange={(checked) => void updateNotification("chatMentions", checked)} />
                <SettingSwitch title="Playback errors" description="Notify me when the selected playback device fails." checked={settings.notifications.playbackErrors} onChange={(checked) => void updateNotification("playbackErrors", checked)} />
              </div>
            </TabsContent>

            <TabsContent value="appearance">
              <div className="settings-panel-stack">
                <section className="settings-control-group">
                  <Label htmlFor="color-theme">Color theme</Label>
                  <Select value={theme} onValueChange={(value) => updateTheme(value as SoundSpinUserSettings["appearance"]["theme"])}>
                    <SelectTrigger id="color-theme" className="w-full"><SelectValue>{theme === "system" ? "System" : theme === "light" ? "Light" : "Dark"}</SelectValue></SelectTrigger>
                    <SelectContent><SelectGroup><SelectItem value="dark">Dark</SelectItem><SelectItem value="light">Light</SelectItem><SelectItem value="system">System</SelectItem></SelectGroup></SelectContent>
                  </Select>
                  <small>Dark stays the default. System follows your device preference.</small>
                </section>
                <SettingSwitch title="Compact player by default" description="Keep the center player collapsed between visits." checked={settings.playback.compactPlayer} onChange={(checked) => updatePlayback({ compactPlayer: checked })} />
                <SettingSwitch title="Reduced motion" description="Disable decorative transitions and movement." checked={settings.appearance.reducedMotion} onChange={(checked) => updateAppearance({ reducedMotion: checked })} />
                <section className="settings-control-group">
                  <Label htmlFor="artwork-blur">Artwork background blur <strong>{settings.appearance.artworkBlur}px</strong></Label>
                  <Slider id="artwork-blur" min={0} max={60} value={[settings.appearance.artworkBlur]} onValueChange={(value) => updateAppearance({ artworkBlur: typeof value === "number" ? value : value[0] })} aria-label="Artwork background blur" />
                </section>
              </div>
            </TabsContent>
          </div>
        </Tabs>
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
