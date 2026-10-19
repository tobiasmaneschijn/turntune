import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SoundSpinUserSettings } from "../playback-settings";
import { requestJson } from "../lib/authenticated-http";
import { UserSettingsDialog, type MusicConnections } from "./UserSettingsDialog";

/** Personal settings are also available before joining a room or mounting a player. */
export function DirectorySettingsDialog({ accessToken, settings, onSettingsChange, onClose }: {
  accessToken: string;
  settings: SoundSpinUserSettings;
  onSettingsChange: (settings: SoundSpinUserSettings) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("public");
  const [connections, setConnections] = useState<MusicConnections>({ loaded: false, spotifyConfigured: false, spotifyConnected: false, appleConfigured: false });
  const [connectionError, setConnectionError] = useState("");
  const connectionRequest = useRef<AbortController | null>(null);
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;

  const loadConnections = useCallback(() => {
    connectionRequest.current?.abort();
    const controller = new AbortController();
    connectionRequest.current = controller;
    setConnectionError("");
    void requestJson<{ spotify?: { configured?: boolean; connected?: boolean; profile?: MusicConnections["spotifyProfile"] }; apple?: { configured?: boolean } }>("/api/music/connections", {
      accessToken, signal: controller.signal, errorMessage: t("musicConnectionsLoadError")
    }).then(payload => {
      if (controller.signal.aborted || tokenRef.current !== accessToken) return;
      setConnections({ loaded: true, spotifyConfigured: false, spotifyConnected: false,
        spotifyProfile: null, appleConfigured: Boolean(payload.apple?.configured) });
    }).catch(() => {
      if (!controller.signal.aborted && tokenRef.current === accessToken) setConnectionError(t("musicConnectionsCheckError"));
    });
  }, [accessToken, t]);

  useEffect(() => {
    setConnections({ loaded: false, spotifyConfigured: false, spotifyConnected: false, appleConfigured: false });
    loadConnections();
    return () => connectionRequest.current?.abort();
  }, [loadConnections]);

  return <UserSettingsDialog settings={settings} connections={connections} accessToken={accessToken} onSettingsChange={onSettingsChange}
    connectionError={connectionError} onRetryConnections={loadConnections} onConnectSpotify={() => {}}
    onDisconnectSpotify={() => {}} onClose={onClose} />;
}
