import { useCallback, useEffect, useRef, useState } from "react";
import type { SoundSpinUserSettings } from "../playback-settings";
import { requestJson } from "../lib/authenticated-http";
import { resetProviderSession } from "../provider-session";
import { UserSettingsDialog, type MusicConnections } from "./UserSettingsDialog";

/** Personal settings are also available before joining a room or mounting a player. */
export function DirectorySettingsDialog({ accessToken, settings, onSettingsChange, onClose }: {
  accessToken: string;
  settings: SoundSpinUserSettings;
  onSettingsChange: (settings: SoundSpinUserSettings) => void;
  onClose: () => void;
}) {
  const [connections, setConnections] = useState<MusicConnections>({ loaded: false, spotifyConfigured: false, spotifyConnected: false, appleConfigured: false });
  const [connectionError, setConnectionError] = useState("");
  const connectionRequest = useRef<AbortController | null>(null);
  const operationRequest = useRef<AbortController | null>(null);
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;

  const loadConnections = useCallback(() => {
    connectionRequest.current?.abort();
    const controller = new AbortController();
    connectionRequest.current = controller;
    setConnectionError("");
    void requestJson<{ spotify?: { configured?: boolean; connected?: boolean; profile?: MusicConnections["spotifyProfile"] }; apple?: { configured?: boolean } }>("/api/music/connections", {
      accessToken, signal: controller.signal, errorMessage: "Could not load music connections."
    }).then(payload => {
      if (controller.signal.aborted || tokenRef.current !== accessToken) return;
      setConnections({ loaded: true, spotifyConfigured: Boolean(payload.spotify?.configured), spotifyConnected: Boolean(payload.spotify?.connected),
        spotifyProfile: payload.spotify?.profile ?? null, appleConfigured: Boolean(payload.apple?.configured) });
    }).catch(() => {
      if (!controller.signal.aborted && tokenRef.current === accessToken) setConnectionError("Could not check your music connections. Try again.");
    });
  }, [accessToken]);

  useEffect(() => {
    setConnections({ loaded: false, spotifyConfigured: false, spotifyConnected: false, appleConfigured: false });
    loadConnections();
    return () => { connectionRequest.current?.abort(); operationRequest.current?.abort(); operationRequest.current = null; };
  }, [loadConnections]);

  const spotifyAction = async (disconnect: boolean) => {
    if (operationRequest.current) return;
    const controller = new AbortController();
    operationRequest.current = controller;
    setConnectionError("");
    try {
      if (disconnect) {
        const response = await fetch("/api/spotify/connection", { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        if (!response.ok) throw new Error("Could not disconnect Spotify. Try again.");
        if (controller.signal.aborted || tokenRef.current !== accessToken) return;
        connectionRequest.current?.abort();
        void resetProviderSession("spotify");
        setConnections(current => ({ ...current, spotifyConnected: false, spotifyProfile: null }));
      } else {
        const payload = await requestJson<{ url?: string }>(`/api/spotify/connect?returnTo=${encodeURIComponent(location.pathname)}`, {
          accessToken, signal: controller.signal, errorMessage: "Could not connect Spotify."
        });
        if (controller.signal.aborted || tokenRef.current !== accessToken) return;
        if (!payload.url) throw new Error("Could not connect Spotify.");
        location.assign(payload.url);
      }
    } catch (error) {
      if (!controller.signal.aborted && tokenRef.current === accessToken) setConnectionError(error instanceof Error ? error.message : "Could not update Spotify. Try again.");
    } finally {
      if (operationRequest.current === controller) operationRequest.current = null;
    }
  };

  return <UserSettingsDialog settings={settings} connections={connections} accessToken={accessToken} onSettingsChange={onSettingsChange}
    connectionError={connectionError} onRetryConnections={loadConnections} onConnectSpotify={() => void spotifyAction(false)}
    onDisconnectSpotify={() => void spotifyAction(true)} onClose={onClose} />;
}
