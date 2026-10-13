import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CircleCheck, Link2, MonitorSpeaker, Music2, Palette, Radio, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
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
import { readStoredValue } from "../lib/browser-storage";
import { Input } from "./ui/input";
import { getSupabaseClient } from "../supabase";
import { requestJson } from "../lib/authenticated-http";
import { resetProviderSession } from "../provider-session";

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
  icon: typeof Radio;
}> = [
  { value: "source", title: "Room source", icon: Radio },
  { value: "spotify-web", title: "Spotify in browser", icon: Music2 },
  { value: "spotify-desktop", title: "Spotify Connect", icon: MonitorSpeaker },
  { value: "apple", title: "Apple Music", icon: Music2 }
];

function readAppleAuthorization(): boolean | null {
  // A configured provider is authoritative; storage is only a previous-session hint.
  try {
    const authorized = window.MusicKit?.getInstance().isAuthorized;
    if (typeof authorized === "boolean") return authorized;
  } catch {
    // MusicKit can be present before its instance has been configured.
  }
  const hint = readStoredValue("soundspin-apple-authorized");
  return hint === "true" ? true : hint === "false" ? false : null;
}

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
  const [tab, setTab] = useState<"playback" | "connections" | "notifications" | "appearance" | "account">("playback");
  const isMobile = useMediaQuery("(max-width: 600px)");
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const { theme = settings.appearance.theme, setTheme } = useTheme();
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [deviceError, setDeviceError] = useState("");
  const [appleAuthorized, setAppleAuthorized] = useState(readAppleAuthorization);
  const [notificationPermission, setNotificationPermission] = useState(readNotificationPermission);
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [accountStatus, setAccountStatus] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [deleteOwnedRooms, setDeleteOwnedRooms] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaFactor, setMfaFactor] = useState<{ id: string; qrCode?: string; secret?: string } | null>(null);
  const accountActiveRef = useRef(true);
  useEffect(() => { accountActiveRef.current = true; return () => { accountActiveRef.current = false; }; }, []);
  const accountOperation = async (operation: () => Promise<string>) => {
    setAccountBusy(true); setAccountError(""); setAccountStatus("");
    try { const status = await operation(); if (accountActiveRef.current) setAccountStatus(status); }
    catch (error) { if (accountActiveRef.current) setAccountError(error instanceof Error ? error.message : "Could not complete the request. Try again."); }
    finally { if (accountActiveRef.current) setAccountBusy(false); }
  };
  const startMfa = () => accountOperation(async () => {
    const client = await getSupabaseClient();
    const factors = await client.auth.mfa.listFactors();
    if (factors.error) throw new Error("Could not load authentication factors. Sign in again.");
    const verified = factors.data.totp.find((factor) => factor.status === "verified");
    if (verified) { setMfaFactor({ id: verified.id }); return "Enter the code from your authenticator."; }
    for (const factor of factors.data.all.filter((factor) => factor.status === "unverified" && factor.friendly_name === "SoundSpin")) {
      const removed = await client.auth.mfa.unenroll({ factorId: factor.id });
      if (removed.error) throw new Error("Could not clear an unfinished setup. Try again after signing in.");
    }
    const enrollment = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "SoundSpin" });
    if (enrollment.error) throw new Error("Could not set up an authenticator. Check your account factors in Supabase.");
    if (accountActiveRef.current) setMfaFactor({ id: enrollment.data.id, qrCode: enrollment.data.totp.qr_code, secret: enrollment.data.totp.secret });
    return "Add this account to your authenticator, then enter its code.";
  });
  const verifyMfa = () => accountOperation(async () => {
    if (!mfaFactor || !/^\d{6}$/.test(mfaCode)) throw new Error("Enter a six-digit authenticator code.");
    const client = await getSupabaseClient();
    const verified = await client.auth.mfa.challengeAndVerify({ factorId: mfaFactor.id, code: mfaCode });
    if (verified.error) throw new Error("Code was not accepted. Enter the current code.");
    if (accountActiveRef.current) { setMfaFactor(null); setMfaCode(""); }
    return "Authenticator verified for this session.";
  });
  const requestDeletion = () => accountOperation(async () => {
    const result = await requestJson<{ request: { id: string } }>("/api/account/deletion-request", {
      accessToken, method: "POST", body: JSON.stringify({ confirmation, deleteOwnedRooms }),
      validate: (value): value is { request: { id: string } } => Boolean(value && typeof value === "object" && "request" in value && value.request &&
        typeof value.request === "object" && "id" in value.request && typeof value.request.id === "string" && /^[0-9a-f-]{36}$/i.test(value.request.id))
    });
    setConfirmation("");
    return `Deletion requested. Reference: ${result.request.id}. An operator will verify your identity before deleting the account.`;
  });
  const exportAccount = () => accountOperation(async () => {
    const categories = ["profile", "library", "feedback", "messages", "reactions", "votes", "memberships", "roomFavorites", "ownedRooms", "friendships", "invitations", "blocks", "providerConnections"];
    const exportData: Record<string, unknown[]> = {};
    let size = 0;
    for (const category of categories) {
      exportData[category] = [];
      for (let page = 0; ; page++) {
        const payload = await requestJson<{ data: unknown[]; hasMore: boolean }>(`/api/account/export/${category}?page=${page}`, { accessToken,
          validate: (value): value is { data: unknown[]; hasMore: boolean } => Boolean(value && typeof value === "object" && "data" in value && Array.isArray(value.data) && "hasMore" in value && typeof value.hasMore === "boolean") });
        size += JSON.stringify(payload.data).length;
        if (size > 20_000_000 || page > 1000) throw new Error("This export needs operator assistance. Contact the privacy support channel.");
        exportData[category].push(...payload.data);
        if (!payload.hasMore) break;
      }
    }
    if (!accountActiveRef.current) return "";
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "soundspin-account-data.json"; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return "Account data downloaded. Keep this file private.";
  });
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
    const update = () => setAppleAuthorized(readAppleAuthorization());
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
          <DialogDescription className="sr-only">Playback, connections, notifications, and appearance.</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)} orientation={isMobile ? "horizontal" : "vertical"} className="user-settings-layout">
          <TabsList className="settings-tabs" aria-label="Setting categories" activateOnFocus>
            <TabsTrigger value="playback" data-settings-category="playback"><Radio /> Playback</TabsTrigger>
            <TabsTrigger value="connections" data-settings-category="connections"><Link2 /> Connections</TabsTrigger>
            <TabsTrigger value="notifications" data-settings-category="notifications"><Bell /> Notifications</TabsTrigger>
            <TabsTrigger value="appearance" data-settings-category="appearance"><Palette /> Appearance</TabsTrigger>
            <TabsTrigger value="account" data-settings-category="account"><ShieldCheck /> Account</TabsTrigger>
          </TabsList>

          <div className="settings-tab-panel">
            <TabsContent value="account">
              <div className="settings-panel-stack">
                <section className="settings-control-group">
                  <strong>Authenticator</strong>
                  <p>Administrator actions require an authenticator code for the current session.</p>
                  {!mfaFactor ? <Button variant="outline" onClick={() => void startMfa()} disabled={accountBusy || !accessToken}>Set up or verify authenticator</Button> : <>
                    {mfaFactor.qrCode && <img src={mfaFactor.qrCode} alt="Authenticator setup QR code" width={180} height={180} />}
                    {mfaFactor.secret && <p>Setup key: <code className="break-all">{mfaFactor.secret}</code></p>}
                    <Label htmlFor="authenticator-code">Authenticator code</Label>
                    <Input id="authenticator-code" inputMode="numeric" autoComplete="one-time-code" value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
                    <Button onClick={() => void verifyMfa()} disabled={accountBusy || mfaCode.length !== 6}>Verify code</Button>
                  </>}
                </section>
                <section className="settings-control-group">
                  <strong>Account data</strong>
                  <Button variant="outline" disabled={accountBusy || !accessToken} onClick={() => void exportAccount()}>Download account data</Button>
                </section>
                <section className="settings-control-group">
                  <strong>Delete account</strong>
                  <p>Deletion removes your account, uploads, and every room you own, including other listeners’ room history. An operator verifies your identity before processing the request.</p>
                  <SettingSwitch title="Delete all rooms I own" checked={deleteOwnedRooms} onChange={setDeleteOwnedRooms} />
                  <Label htmlFor="delete-account-confirmation">Type DELETE to request deletion</Label>
                  <Input id="delete-account-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} maxLength={6} />
                  <Button variant="destructive" disabled={accountBusy || !accessToken || confirmation !== "DELETE" || !deleteOwnedRooms} onClick={() => void requestDeletion()}>Request account deletion</Button>
                </section>
                {accountError && <p role="alert" className="settings-field-error">{accountError}</p>}
                {accountStatus && <p role="status">{accountStatus}</p>}
              </div>
            </TabsContent>
            <TabsContent value="playback">
              <div className="settings-panel-stack">
                <section>
                  <div className="settings-section-heading"><strong>Default playback</strong></div>
                  <ToggleGroup className="playback-option-list" aria-label="Default playback provider" orientation="vertical" value={[settings.playback.preference]} onValueChange={(value) => {
                    if (value[0]) updatePlayback({ preference: value[0] as PlaybackPreference });
                  }}>
                    {playbackOptions.map((option) => {
                      const unavailable = option.value.startsWith("spotify") ? spotifyUnavailable : option.value === "apple" && appleUnavailable;
                      const selected = settings.playback.preference === option.value;
                      const Icon = option.icon;
                      return (
                        <ToggleGroupItem key={option.value} value={option.value} className={selected ? "playback-option selected" : "playback-option"} disabled={unavailable}>
                          <span className="playback-option-icon"><Icon /></span>
                          <span><strong>{option.title}</strong>{unavailable && <small>Not configured</small>}</span>
                          {selected && <CircleCheck className="playback-option-check" />}
                        </ToggleGroupItem>
                      );
                    })}
                  </ToggleGroup>
                  {settings.playback.preference !== "source" && <small>Requires a matching track.</small>}
                  {settings.playback.preference.startsWith("spotify") && !connections.spotifyConnected && (
                    <div className="settings-inline-notice">
                      <span>Spotify connection required.</span>
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
                        <SelectTrigger id="spotify-device" className="w-full"><SelectValue>{settings.playback.spotifyDeviceId ? devices.find(device => device.id === settings.playback.spotifyDeviceId)?.name || "Selected device unavailable" : "Automatic selection"}</SelectValue></SelectTrigger>
                        <SelectContent><SelectGroup>
                          <SelectItem value="automatic">Automatic selection</SelectItem>
                          {devices.map((device) => <SelectItem key={device.id!} value={device.id!}>{device.name} · {device.type}{device.is_active ? " · Active" : ""}</SelectItem>)}
                        </SelectGroup></SelectContent>
                      </Select>
                      <Button variant="outline" size="icon" onClick={refreshDevices} disabled={loadingDevices} title="Refresh Spotify devices" aria-label="Refresh Spotify devices"><RefreshCw className={loadingDevices ? "spin" : ""} /></Button>
                    </div>
                    {deviceError && <small className="settings-field-error">{deviceError}</small>}
                    {connections.spotifyConnected && devicesLoaded && !loadingDevices && !deviceError && !devices.length && <p className="settings-empty-devices" role="status">No Spotify devices available. Open Spotify on a device, then refresh.</p>}
                  </section>
                )}

                {settings.playback.preference !== "source" && <section className="settings-control-group">
                  <Label htmlFor="fallback-behavior">When the preferred provider has no match</Label>
                  <Select value={settings.playback.fallback} onValueChange={(value) => updatePlayback({ fallback: value as SoundSpinUserSettings["playback"]["fallback"] })}>
                    <SelectTrigger id="fallback-behavior" className="w-full"><SelectValue>{settings.playback.fallback === "ask" ? "Ask for each unavailable track" : settings.playback.fallback === "silent" ? "Keep local playback silent" : "Use the room source automatically"}</SelectValue></SelectTrigger>
                    <SelectContent><SelectGroup>
                      <SelectItem value="source">Use the room source automatically</SelectItem>
                      <SelectItem value="ask">Ask for each unavailable track</SelectItem>
                      <SelectItem value="silent">Keep local playback silent</SelectItem>
                    </SelectGroup></SelectContent>
                  </Select>
                </section>}

                {settings.playback.preference === "spotify-web" && <SettingSwitch title="Resume when Spotify reconnects" description="Catch up to the room's current position." checked={settings.playback.resumeAfterReconnect} onChange={(checked) => updatePlayback({ resumeAfterReconnect: checked })} />}
              </div>
            </TabsContent>

            <TabsContent value="connections">
              <div className="connection-list">
                {connectionError && <div className="settings-inline-notice" role="alert"><span>{connectionError}</span>{onRetryConnections && <Button size="sm" variant="outline" onClick={onRetryConnections}>Retry connection check</Button>}</div>}
                <div className="connection-row connection-row-expanded">
                  <span className="connection-logo spotify">S</span>
                  <span><strong>{connections.spotifyProfile?.displayName || "Spotify"}</strong>{(connections.spotifyConnected || spotifyUnavailable) && <small>{connections.spotifyConnected ? [connections.spotifyProfile?.product === "premium" ? "Premium" : "Connected", selectedSpotifyDevice?.name].filter(Boolean).join(" · ") : "Not configured"}</small>}</span>
                  <span className="connection-actions">
                    {connections.spotifyConnected && <Button variant="ghost" size="sm" onClick={refreshDevices}><RefreshCw /> Refresh</Button>}
                    <Button variant="outline" size="sm" onClick={onConnectSpotify} disabled={!accessToken || spotifyUnavailable}>{connections.spotifyConnected ? "Reconnect" : "Connect"}</Button>
                    {connections.spotifyConnected && <Button variant="ghost" size="sm" onClick={onDisconnectSpotify}><Unplug /> Disconnect</Button>}
                  </span>
                </div>
                <div className="connection-row">
                  <span className="connection-logo apple">A</span>
                  <span><strong>Apple Music</strong></span>
                  <Badge variant="outline">{appleUnavailable ? "Unavailable" : appleAuthorized ? "Authorized" : "Available"}</Badge>
                  {appleAuthorized && <Button variant="ghost" size="sm" aria-label="Disconnect Apple Music" onClick={() => void resetProviderSession("apple")}><Unplug /> Disconnect</Button>}
                </div>
                {deviceError && <div className="dialog-error">{deviceError}</div>}
                {connections.spotifyConnected && devicesLoaded && !loadingDevices && !deviceError && !devices.length && <p className="settings-empty-devices" role="status">No Spotify devices available. Open Spotify on a device, then refresh.</p>}
              </div>
            </TabsContent>

            <TabsContent value="notifications">
              <div className="settings-panel-stack">
                <div className="settings-inline-notice"><span>{notificationPermissionDescription(notificationPermission)}</span>{notificationPermission === "default" && <Button size="sm" disabled={requestingPermission} onClick={() => {
                  setRequestingPermission(true);
                  void requestNotificationPermission().then(setNotificationPermission).finally(() => setRequestingPermission(false));
                }}>{requestingPermission ? "Requesting permission…" : "Enable notifications"}</Button>}</div>
                <SettingSwitch title="Background notifications only" description="Only when this tab is inactive." checked={settings.notifications.backgroundOnly !== false} onChange={(checked) => updateNotification("backgroundOnly", checked)} />
                <SettingSwitch title="DJ turn" checked={settings.notifications.djTurn} onChange={(checked) => void updateNotification("djTurn", checked)} />
                <SettingSwitch title="Unavailable tracks" description="No match on your provider." checked={settings.notifications.unavailableTrack} onChange={(checked) => void updateNotification("unavailableTrack", checked)} />
                <SettingSwitch title="Chat mentions" checked={settings.notifications.chatMentions} onChange={(checked) => void updateNotification("chatMentions", checked)} />
                <SettingSwitch title="Playback errors" checked={settings.notifications.playbackErrors} onChange={(checked) => void updateNotification("playbackErrors", checked)} />
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
                </section>
                <SettingSwitch title="Compact player by default" checked={settings.playback.compactPlayer} onChange={(checked) => updatePlayback({ compactPlayer: checked })} />
                <SettingSwitch title="Reduced motion" checked={settings.appearance.reducedMotion} onChange={(checked) => updateAppearance({ reducedMotion: checked })} />
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

function SettingSwitch({ title, description, checked, onChange }: { title: string; description?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="settings-switch-row">
      <span><strong>{title}</strong>{description && <small>{description}</small>}</span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}
