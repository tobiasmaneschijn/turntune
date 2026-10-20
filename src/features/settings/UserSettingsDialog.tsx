import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CircleCheck, Link2, MonitorSpeaker, Music2, Palette, Radio, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { useTheme } from "next-themes";
import type { PlaybackPreference, SoundSpinUserSettings } from "./user-settings";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { Slider } from "../../components/ui/slider";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { useMediaQuery } from "../../hooks/use-media-query";
import { notificationPermissionDescription, readNotificationPermission, requestNotificationPermission } from "../../lib/notifications";
import { readStoredValue } from "../../lib/browser-storage";
import { Input } from "../../components/ui/input";
import { getSupabaseClient } from "../../lib/supabase";
import { requestJson } from "../../lib/authenticated-http";
import { resetProviderSession } from "../playback/provider-session";
import { PLAYBACK_PREFERENCES, playbackPreferenceAllowed } from "../playback/playback-selection";

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
  spotifyEnabled = false,
  roomSlug,
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
  spotifyEnabled?: boolean;
  roomSlug?: string;
  onSettingsChange: (settings: SoundSpinUserSettings) => void;
  onConnectSpotify: () => void;
  onDisconnectSpotify: () => void;
  connectionError?: string;
  onRetryConnections?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("rooms");
  const playbackOptions: Array<{
    value: PlaybackPreference;
    title: string;
    icon: typeof Radio;
  }> = (Object.entries(PLAYBACK_PREFERENCES) as Array<[PlaybackPreference, typeof PLAYBACK_PREFERENCES[PlaybackPreference]]>)
    .map(([value, definition]) => ({ value, title: t(definition.titleKey),
      icon: definition.icon === "radio" ? Radio : definition.icon === "device" ? MonitorSpeaker : Music2 }));
  const [tab, setTab] = useState<"playback" | "connections" | "notifications" | "appearance" | "account">("playback");
  const isMobile = useMediaQuery("(max-width: 600px)");
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const { theme = settings.appearance.theme, setTheme } = useTheme();
  const playbackPreference = playbackPreferenceAllowed(settings.playback.preference, spotifyEnabled) ? settings.playback.preference : "source";
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
    catch (error) { if (accountActiveRef.current) setAccountError(error instanceof Error ? error.message : t("userSettingsDialog.couldNotCompleteTheRequestTryAgain")); }
    finally { if (accountActiveRef.current) setAccountBusy(false); }
  };
  const startMfa = () => accountOperation(async () => {
    const client = await getSupabaseClient();
    const factors = await client.auth.mfa.listFactors();
    if (factors.error) throw new Error(t("userSettingsDialog.couldNotLoadAuthenticationFactorsSignInAgain"));
    const verified = factors.data.totp.find((factor) => factor.status === "verified");
    if (verified) { setMfaFactor({ id: verified.id }); return t("userSettingsDialog.enterTheCodeFromYourAuthenticator"); }
    for (const factor of factors.data.all.filter((factor) => factor.status === "unverified" && ["SoundSpin", "turntune"].includes(factor.friendly_name ?? ""))) {
      const removed = await client.auth.mfa.unenroll({ factorId: factor.id });
      if (removed.error) throw new Error(t("userSettingsDialog.couldNotClearAnUnfinishedSetupTryAgain"));
    }
    const enrollment = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "turntune" });
    if (enrollment.error) throw new Error(t("userSettingsDialog.couldNotSetUpAnAuthenticatorCheckYour"));
    if (accountActiveRef.current) setMfaFactor({ id: enrollment.data.id, qrCode: enrollment.data.totp.qr_code, secret: enrollment.data.totp.secret });
    return t("userSettingsDialog.addThisAccountToYourAuthenticatorThenEnter");
  });
  const verifyMfa = () => accountOperation(async () => {
    if (!mfaFactor || !/^\d{6}$/.test(mfaCode)) throw new Error(t("userSettingsDialog.enterASixDigitAuthenticatorCode"));
    const client = await getSupabaseClient();
    const verified = await client.auth.mfa.challengeAndVerify({ factorId: mfaFactor.id, code: mfaCode });
    if (verified.error) throw new Error(t("userSettingsDialog.codeWasNotAcceptedEnterTheCurrentCode"));
    if (accountActiveRef.current) { setMfaFactor(null); setMfaCode(""); }
    return t("userSettingsDialog.authenticatorVerifiedForThisSession");
  });
  const requestDeletion = () => accountOperation(async () => {
    const result = await requestJson<{ request: { id: string } }>("/api/account/deletion-request", {
      accessToken, method: "POST", body: JSON.stringify({ confirmation, deleteOwnedRooms }),
      validate: (value): value is { request: { id: string } } => Boolean(value && typeof value === "object" && "request" in value && value.request &&
        typeof value.request === "object" && "id" in value.request && typeof value.request.id === "string" && /^[0-9a-f-]{36}$/i.test(value.request.id))
    });
    setConfirmation("");
    return t("userSettingsDialog.deletionRequestedReferenceIdAnOperatorWillVerify", { id: result.request.id });
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
        if (size > 20_000_000 || page > 1000) throw new Error(t("userSettingsDialog.thisExportNeedsOperatorAssistanceContactThePrivacy"));
        exportData[category].push(...payload.data);
        if (!payload.hasMore) break;
      }
    }
    if (!accountActiveRef.current) return "";
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "turntune-account-data.json"; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return t("userSettingsDialog.accountDataDownloadedKeepThisFilePrivate");
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

  const deviceRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    deviceRequest.current?.abort(); deviceRequest.current = null;
    setDevices([]); setDevicesLoaded(false); setLoadingDevices(false); setDeviceError("");
    return () => { deviceRequest.current?.abort(); deviceRequest.current = null; };
  }, [spotifyEnabled, roomSlug, accessToken]);
  const refreshDevices = useCallback(() => {
    if (!accessToken || !spotifyEnabled || !connections.spotifyConnected || deviceRequest.current) return;
    const controller = new AbortController(); deviceRequest.current = controller;
    setLoadingDevices(true);
    setDeviceError("");
    void fetch("/api/spotify/devices", { headers: { Authorization: `Bearer ${accessToken}`, "x-soundspin-room": roomSlug ?? "" }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then(async (response) => {
        const payload = await response.json() as { devices?: SpotifyDevice[]; error?: string };
        if (!response.ok) throw new Error(payload.error || t("userSettingsDialog.couldNotLoadSpotifyDevices"));
        if (controller.signal.aborted) return;
        setDevices((payload.devices || []).filter((device) => device.id && !device.is_restricted));
        setDevicesLoaded(true);
      })
      .catch((error) => { if (!controller.signal.aborted) setDeviceError(error instanceof Error ? error.message : t("userSettingsDialog.couldNotLoadSpotifyDevices")); })
      .finally(() => { if (deviceRequest.current === controller) { deviceRequest.current = null; setLoadingDevices(false); } });
  }, [accessToken, spotifyEnabled, roomSlug, connections.spotifyConnected]);

  useEffect(() => {
    if ((tab === "playback" || tab === "connections") && spotifyEnabled && connections.spotifyConnected && !devices.length) refreshDevices();
  }, [tab, spotifyEnabled, connections.spotifyConnected, devices.length, refreshDevices]);

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
          : document.querySelector<HTMLButtonElement>(".shared-account-trigger, .room-more-actions") ?? true;
      }}>
        <DialogHeader>
          <DialogTitle>{t("userSettingsDialog.settings")}</DialogTitle>
          <DialogDescription className="sr-only">{t("userSettingsDialog.playbackConnectionsNotificationsAndAppearance")}</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)} orientation={isMobile ? "horizontal" : "vertical"} className="user-settings-layout">
          <TabsList className="settings-tabs" aria-label={t("userSettingsDialog.settingCategories")} activateOnFocus>
            <TabsTrigger value="playback" data-settings-category="playback"><Radio />{t("userSettingsDialog.playback")}</TabsTrigger>
            <TabsTrigger value="connections" data-settings-category="connections"><Link2 />{t("userSettingsDialog.connections")}</TabsTrigger>
            <TabsTrigger value="notifications" data-settings-category="notifications"><Bell />{t("userSettingsDialog.notifications")}</TabsTrigger>
            <TabsTrigger value="appearance" data-settings-category="appearance"><Palette />{t("userSettingsDialog.appearance")}</TabsTrigger>
            <TabsTrigger value="account" data-settings-category="account"><ShieldCheck />{t("userSettingsDialog.account")}</TabsTrigger>
          </TabsList>

          <div className="settings-tab-panel">
            <TabsContent value="account">
              <div className="settings-panel-stack">
                <section className="settings-control-group">
                  <strong>{t("userSettingsDialog.authenticator")}</strong>
                  <p>{t("userSettingsDialog.administratorActionsRequireAnAuthenticatorCodeForThe")}</p>
                  {!mfaFactor ? <Button variant="outline" onClick={() => void startMfa()} disabled={accountBusy || !accessToken}>{t("userSettingsDialog.setUpOrVerifyAuthenticator")}</Button> : <>
                    {mfaFactor.qrCode && <img src={mfaFactor.qrCode} alt={t("userSettingsDialog.authenticatorSetupQRCode")} width={180} height={180} />}
                    {mfaFactor.secret && <p>{t("userSettingsDialog.setupKey")}{" "}<code className="break-all">{mfaFactor.secret}</code></p>}
                    <Label htmlFor="authenticator-code">{t("userSettingsDialog.authenticatorCode")}</Label>
                    <Input id="authenticator-code" inputMode="numeric" autoComplete="one-time-code" value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
                    <Button onClick={() => void verifyMfa()} disabled={accountBusy || mfaCode.length !== 6}>{t("userSettingsDialog.verifyCode")}</Button>
                  </>}
                </section>
                <section className="settings-control-group">
                  <strong>{t("userSettingsDialog.accountData")}</strong>
                  <Button variant="outline" disabled={accountBusy || !accessToken} onClick={() => void exportAccount()}>{t("userSettingsDialog.downloadAccountData")}</Button>
                </section>
                <section className="settings-control-group">
                  <strong>{t("userSettingsDialog.deleteAccount")}</strong>
                  <p>{t("userSettingsDialog.deletionRemovesYourAccountUploadsAndEveryRoom")}</p>
                  <SettingSwitch title={t("userSettingsDialog.deleteAllRoomsIOwn")} checked={deleteOwnedRooms} onChange={setDeleteOwnedRooms} />
                  <Label htmlFor="delete-account-confirmation">{t("userSettingsDialog.typeDELETEToRequestDeletion")}</Label>
                  <Input id="delete-account-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} maxLength={6} />
                  <Button variant="destructive" disabled={accountBusy || !accessToken || confirmation !== "DELETE" || !deleteOwnedRooms} onClick={() => void requestDeletion()}>{t("userSettingsDialog.requestAccountDeletion")}</Button>
                </section>
                {accountError && <p role="alert" className="settings-field-error">{accountError}</p>}
                {accountStatus && <p role="status">{accountStatus}</p>}
              </div>
            </TabsContent>
            <TabsContent value="playback">
              <div className="settings-panel-stack">
                <section>
                  <div className="settings-section-heading"><strong>{t("userSettingsDialog.defaultPlayback")}</strong></div>
                  <ToggleGroup className="playback-option-list" aria-label={t("userSettingsDialog.defaultPlaybackProvider")} orientation="vertical" value={[playbackPreference]} onValueChange={(value) => {
                    if (value[0]) updatePlayback({ preference: value[0] as PlaybackPreference });
                  }}>
                    {playbackOptions.filter(option => playbackPreferenceAllowed(option.value, spotifyEnabled)).map((option) => {
                      const unavailable = option.value.startsWith("spotify") ? spotifyUnavailable : option.value === "apple" && appleUnavailable;
                      const selected = playbackPreference === option.value;
                      const Icon = option.icon;
                      return (
                        <ToggleGroupItem key={option.value} value={option.value} className={selected ? "playback-option selected" : "playback-option"} disabled={unavailable}>
                          <span className="playback-option-icon"><Icon /></span>
                          <span><strong>{option.title}</strong>{unavailable && <small>{t("userSettingsDialog.notConfigured")}</small>}</span>
                          {selected && <CircleCheck className="playback-option-check" />}
                        </ToggleGroupItem>
                      );
                    })}
                  </ToggleGroup>
                  {playbackPreference !== "source" && <small>{t("userSettingsDialog.requiresAMatchingTrack")}</small>}
                  {spotifyEnabled && playbackPreference.startsWith("spotify") && !connections.spotifyConnected && (
                    <div className="settings-inline-notice">
                      <span>{t("userSettingsDialog.spotifyConnectionRequired")}</span>
                      <Button size="sm" onClick={onConnectSpotify} disabled={!accessToken || spotifyUnavailable}>{t("userSettingsDialog.connectSpotify")}</Button>
                    </div>
                  )}
                </section>

                <section className="settings-control-group">
                  <Label htmlFor="default-volume">{t("userSettingsDialog.defaultVolume")}{" "}<strong>{t("userSettingsDialog.volumePercentSymbol", { value: settings.playback.defaultVolume })}</strong></Label>
                  <Slider id="default-volume" min={0} max={100} value={[settings.playback.defaultVolume]} onValueChange={(value) => updatePlayback({ defaultVolume: typeof value === "number" ? value : value[0] })} aria-label={t("userSettingsDialog.defaultVolume")} getAriaValueText={(_formatted, value) => t("userSettingsDialog.volumePercent", { value })} />
                </section>

                {spotifyEnabled && playbackPreference === "spotify-desktop" && (
                  <section className="settings-control-group">
                    <Label htmlFor="spotify-device">{t("userSettingsDialog.spotifyConnectDevice")}</Label>
                    <div className="settings-select-row">
                      <Select value={settings.playback.spotifyDeviceId || "automatic"} onValueChange={(value) => updatePlayback({ spotifyDeviceId: !value || value === "automatic" ? "" : value })}>
                        <SelectTrigger id="spotify-device" className="w-full"><SelectValue>{settings.playback.spotifyDeviceId ? devices.find(device => device.id === settings.playback.spotifyDeviceId)?.name || t("userSettingsDialog.selectedDeviceUnavailable") : t("userSettingsDialog.automaticSelection")}</SelectValue></SelectTrigger>
                        <SelectContent><SelectGroup>
                          <SelectItem value="automatic">{t("userSettingsDialog.automaticSelection")}</SelectItem>
                          {devices.map((device) => <SelectItem key={device.id!} value={device.id!}>{t(device.is_active ? "userSettingsDialog.activeDevice" : "userSettingsDialog.device", { name: device.name, type: t(`devices.${device.type}`, { defaultValue: device.type }) })}</SelectItem>)}
                        </SelectGroup></SelectContent>
                      </Select>
                      <Button variant="outline" size="icon" onClick={refreshDevices} disabled={loadingDevices} title={t("userSettingsDialog.refreshSpotifyDevices")} aria-label={t("userSettingsDialog.refreshSpotifyDevices")}><RefreshCw className={loadingDevices ? "spin" : ""} /></Button>
                    </div>
                    {deviceError && <small className="settings-field-error">{deviceError}</small>}
                    {spotifyEnabled && connections.spotifyConnected && devicesLoaded && !loadingDevices && !deviceError && !devices.length && <p className="settings-empty-devices" role="status">{t("userSettingsDialog.noSpotifyDevicesAvailableOpenSpotifyOnA")}</p>}
                  </section>
                )}

                {playbackPreference !== "source" && <section className="settings-control-group">
                  <Label htmlFor="fallback-behavior">{t("userSettingsDialog.whenThePreferredProviderHasNoMatch")}</Label>
                  <Select value={settings.playback.fallback} onValueChange={(value) => updatePlayback({ fallback: value as SoundSpinUserSettings["playback"]["fallback"] })}>
                    <SelectTrigger id="fallback-behavior" className="w-full"><SelectValue>{settings.playback.fallback === "ask" ? t("userSettingsDialog.askForEachUnavailableTrack") : settings.playback.fallback === "silent" ? t("userSettingsDialog.keepLocalPlaybackSilent") : t("userSettingsDialog.useTheRoomSourceAutomatically")}</SelectValue></SelectTrigger>
                    <SelectContent><SelectGroup>
                      <SelectItem value="source">{t("userSettingsDialog.useTheRoomSourceAutomatically")}</SelectItem>
                      <SelectItem value="ask">{t("userSettingsDialog.askForEachUnavailableTrack")}</SelectItem>
                      <SelectItem value="silent">{t("userSettingsDialog.keepLocalPlaybackSilent")}</SelectItem>
                    </SelectGroup></SelectContent>
                  </Select>
                </section>}

                {spotifyEnabled && playbackPreference === "spotify-web" && <SettingSwitch title={t("userSettingsDialog.resumeWhenSpotifyReconnects")} description={t("userSettingsDialog.catchUpToTheRoomSCurrentPosition")} checked={settings.playback.resumeAfterReconnect} onChange={(checked) => updatePlayback({ resumeAfterReconnect: checked })} />}
              </div>
            </TabsContent>

            <TabsContent value="connections">
              <div className="connection-list">
                {connectionError && <div className="settings-inline-notice" role="alert"><span>{connectionError}</span>{onRetryConnections && <Button size="sm" variant="outline" onClick={onRetryConnections}>{t("userSettingsDialog.retryConnectionCheck")}</Button>}</div>}
                {spotifyEnabled && <div className="connection-row connection-row-expanded">
                  <span className="connection-logo spotify">{t("userSettingsDialog.s")}</span>
                  <span><strong>{connections.spotifyProfile?.displayName || t("userSettingsDialog.spotify")}</strong>{(connections.spotifyConnected || spotifyUnavailable) && <small>{connections.spotifyConnected ? [connections.spotifyProfile?.product === "premium" ? t("userSettingsDialog.premium") : t("userSettingsDialog.connected"), selectedSpotifyDevice?.name].filter(Boolean).join(" · ") : t("userSettingsDialog.notConfigured")}</small>}</span>
                  <span className="connection-actions">
                    {connections.spotifyConnected && <Button variant="ghost" size="sm" onClick={refreshDevices}><RefreshCw />{t("userSettingsDialog.refresh")}</Button>}
                    <Button variant="outline" size="sm" onClick={onConnectSpotify} disabled={!accessToken || spotifyUnavailable}>{connections.spotifyConnected ? t("userSettingsDialog.reconnect") : t("userSettingsDialog.connect")}</Button>
                    {connections.spotifyConnected && <Button variant="ghost" size="sm" onClick={onDisconnectSpotify}><Unplug />{t("userSettingsDialog.disconnect")}</Button>}
                  </span>
                </div>}
                <div className="connection-row">
                  <span className="connection-logo apple">{t("userSettingsDialog.a")}</span>
                  <span><strong>{t("userSettingsDialog.appleMusic")}</strong></span>
                  <Badge variant="outline">{appleUnavailable ? t("userSettingsDialog.unavailable") : appleAuthorized ? t("userSettingsDialog.authorized") : t("userSettingsDialog.available")}</Badge>
                  {appleAuthorized && <Button variant="ghost" size="sm" aria-label={t("userSettingsDialog.disconnectAppleMusic")} onClick={() => void resetProviderSession("apple")}><Unplug />{t("userSettingsDialog.disconnect")}</Button>}
                </div>
                {spotifyEnabled && deviceError && <div className="dialog-error">{deviceError}</div>}
                {spotifyEnabled && connections.spotifyConnected && devicesLoaded && !loadingDevices && !deviceError && !devices.length && <p className="settings-empty-devices" role="status">{t("userSettingsDialog.noSpotifyDevicesAvailableOpenSpotifyOnA")}</p>}
              </div>
            </TabsContent>

            <TabsContent value="notifications">
              <div className="settings-panel-stack">
                <div className="settings-inline-notice"><span>{notificationPermissionDescription(notificationPermission)}</span>{notificationPermission === "default" && <Button size="sm" disabled={requestingPermission} onClick={() => {
                  setRequestingPermission(true);
                  void requestNotificationPermission().then(setNotificationPermission).finally(() => setRequestingPermission(false));
                }}>{requestingPermission ? t("userSettingsDialog.requestingPermission") : t("userSettingsDialog.enableNotifications")}</Button>}</div>
                <SettingSwitch title={t("userSettingsDialog.backgroundNotificationsOnly")} description={t("userSettingsDialog.onlyWhenThisTabIsInactive")} checked={settings.notifications.backgroundOnly !== false} onChange={(checked) => updateNotification("backgroundOnly", checked)} />
                <SettingSwitch title={t("userSettingsDialog.dJTurn")} checked={settings.notifications.djTurn} onChange={(checked) => void updateNotification("djTurn", checked)} />
                <SettingSwitch title={t("userSettingsDialog.unavailableTracks")} description={t("userSettingsDialog.noMatchOnYourProvider")} checked={settings.notifications.unavailableTrack} onChange={(checked) => void updateNotification("unavailableTrack", checked)} />
                <SettingSwitch title={t("userSettingsDialog.chatMentions")} checked={settings.notifications.chatMentions} onChange={(checked) => void updateNotification("chatMentions", checked)} />
                <SettingSwitch title={t("userSettingsDialog.playbackErrors")} checked={settings.notifications.playbackErrors} onChange={(checked) => void updateNotification("playbackErrors", checked)} />
              </div>
            </TabsContent>

            <TabsContent value="appearance">
              <div className="settings-panel-stack">
                <section className="settings-control-group">
                  <Label htmlFor="color-theme">{t("userSettingsDialog.colorTheme")}</Label>
                  <Select value={theme} onValueChange={(value) => updateTheme(value as SoundSpinUserSettings["appearance"]["theme"])}>
                    <SelectTrigger id="color-theme" className="w-full"><SelectValue>{theme === "system" ? t("userSettingsDialog.system") : theme === "light" ? t("userSettingsDialog.light") : t("userSettingsDialog.dark")}</SelectValue></SelectTrigger>
                    <SelectContent><SelectGroup><SelectItem value="dark">{t("userSettingsDialog.dark")}</SelectItem><SelectItem value="light">{t("userSettingsDialog.light")}</SelectItem><SelectItem value="system">{t("userSettingsDialog.system")}</SelectItem></SelectGroup></SelectContent>
                  </Select>
                </section>
                <SettingSwitch title={t("userSettingsDialog.compactPlayerByDefault")} checked={settings.playback.compactPlayer} onChange={(checked) => updatePlayback({ compactPlayer: checked })} />
                <SettingSwitch title={t("userSettingsDialog.reducedMotion")} checked={settings.appearance.reducedMotion} onChange={(checked) => updateAppearance({ reducedMotion: checked })} />
                <section className="settings-control-group">
                  <Label htmlFor="artwork-blur">{t("userSettingsDialog.artworkBackgroundBlur")}{" "}<strong>{t("userSettingsDialog.blurPixels", { value: settings.appearance.artworkBlur })}</strong></Label>
                  <Slider id="artwork-blur" min={0} max={60} value={[settings.appearance.artworkBlur]} onValueChange={(value) => updateAppearance({ artworkBlur: typeof value === "number" ? value : value[0] })} aria-label={t("userSettingsDialog.artworkBackgroundBlur")} />
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
