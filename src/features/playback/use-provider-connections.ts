import { useCallback, useEffect, useRef, useState } from "react";
import i18n from "../../i18n";
import { requestJson } from "../../lib/authenticated-http";
import { MUSIC_PROVIDERS, PROVIDER_DEFINITIONS } from "../../../shared/provider-definitions";
import type { Provider } from "../../types";
import type { PlaybackConnections, ProviderConnection } from "./provider-registry";
import { PROVIDER_CONNECTION_ACTIONS } from "./provider-connection-actions";
import { resetProviderSession, setProviderAccount, type PersonalProvider } from "./provider-session";

interface ProviderConnectionOptions {
  accessToken?: string;
  userId: string;
  roomSlug: string;
  spotifyEnabled: boolean;
  isolatedPreview: boolean;
  onPlaybackError: (message: string) => void;
  onProviderError: (message: string) => void;
}

type ConnectionContext = Pick<ProviderConnectionOptions,
  "accessToken" | "userId" | "roomSlug" | "spotifyEnabled" | "isolatedPreview">;

function sameContext(current: ConnectionContext, expected: ConnectionContext) {
  return current.accessToken === expected.accessToken && current.userId === expected.userId &&
    current.roomSlug === expected.roomSlug && current.spotifyEnabled === expected.spotifyEnabled &&
    current.isolatedPreview === expected.isolatedPreview;
}

const connectionsWithProviders = (providers: PlaybackConnections["providers"], loaded: boolean): PlaybackConnections => ({
  providers,
  loaded,
  spotifyConfigured: Boolean(providers.spotify?.configured),
  spotifyConnected: Boolean(providers.spotify?.connected),
  spotifyProfile: providers.spotify?.profile || null,
  appleConfigured: Boolean(providers.apple?.configured)
});
const emptyConnections = () => connectionsWithProviders({}, false);
const personalProvidersWithRoomGrant = MUSIC_PROVIDERS.filter((provider): provider is PersonalProvider =>
  PROVIDER_DEFINITIONS[provider].personalSession && PROVIDER_DEFINITIONS[provider].requiresSpotifyGrant);

export function useProviderConnections({
  accessToken, userId, roomSlug, spotifyEnabled, isolatedPreview, onPlaybackError, onProviderError
}: ProviderConnectionOptions) {
  const [connections, setConnections] = useState(emptyConnections);
  const [connectionError, setConnectionError] = useState("");
  const aliveRef = useRef(true);
  const connectionRequestRef = useRef<AbortController | null>(null);
  const providerOperationRef = useRef<AbortController | null>(null);
  const context: ConnectionContext = { accessToken, userId, roomSlug, spotifyEnabled, isolatedPreview };
  const contextRef = useRef(context);
  const callbacksRef = useRef({ onPlaybackError, onProviderError });
  contextRef.current = context;
  callbacksRef.current = { onPlaybackError, onProviderError };

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      connectionRequestRef.current?.abort();
      providerOperationRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (isolatedPreview) return;
    setProviderAccount(userId);
    setConnections(emptyConnections());
  }, [userId, isolatedPreview]);

  useEffect(() => {
    if (!isolatedPreview && !spotifyEnabled) {
      for (const provider of personalProvidersWithRoomGrant) void resetProviderSession(provider);
    }
  }, [spotifyEnabled, roomSlug, isolatedPreview]);

  useEffect(() => {
    connectionRequestRef.current?.abort();
    providerOperationRef.current?.abort();
    providerOperationRef.current = null;
    return () => {
      connectionRequestRef.current?.abort();
      providerOperationRef.current?.abort();
      providerOperationRef.current = null;
    };
  }, [accessToken, userId, roomSlug, spotifyEnabled, isolatedPreview]);

  const loadConnections = useCallback(() => {
    if (!accessToken) return;
    const expected = { accessToken, userId, roomSlug, spotifyEnabled, isolatedPreview };
    if (!aliveRef.current || !sameContext(contextRef.current, expected)) return;
    connectionRequestRef.current?.abort();
    const controller = new AbortController();
    connectionRequestRef.current = controller;
    const current = () => !controller.signal.aborted && aliveRef.current && sameContext(contextRef.current, expected);
    setConnectionError("");
    void requestJson<Partial<Record<Provider, ProviderConnection>>>("/api/music/connections", {
      accessToken, headers: { "x-soundspin-room": roomSlug }, signal: controller.signal,
      errorMessage: i18n.t("music:nowPlaying.connectionsFailed")
    }).then((payload) => {
      if (!current()) return;
      const providers: PlaybackConnections["providers"] = {};
      for (const provider of MUSIC_PROVIDERS) {
        const granted = !PROVIDER_DEFINITIONS[provider].requiresSpotifyGrant || spotifyEnabled;
        const connection = granted ? payload[provider] : undefined;
        if (granted && !connection) continue;
        providers[provider] = {
          configured: Boolean(connection?.configured),
          connected: Boolean(connection?.connected),
          profile: connection?.profile || null
        };
      }
      setConnections(connectionsWithProviders(providers, true));
    }).catch(() => {
      if (current()) setConnectionError(i18n.t("music:nowPlaying.connectionCheckFailed"));
    });
  }, [accessToken, userId, spotifyEnabled, roomSlug, isolatedPreview]);

  useEffect(loadConnections, [loadConnections]);

  const handleConnectionLost = useCallback((message: string) => {
    const expected = { accessToken, userId, roomSlug, spotifyEnabled, isolatedPreview };
    if (!aliveRef.current || !sameContext(contextRef.current, expected)) return;
    loadConnections();
    callbacksRef.current.onProviderError(message);
  }, [accessToken, userId, roomSlug, spotifyEnabled, isolatedPreview, loadConnections]);

  const connectProvider = useCallback((provider: Provider) => {
    const actions = PROVIDER_CONNECTION_ACTIONS[provider];
    if (!actions || !accessToken || isolatedPreview || providerOperationRef.current ||
      PROVIDER_DEFINITIONS[provider].requiresSpotifyGrant && !spotifyEnabled) return;
    const expected = { accessToken, userId, roomSlug, spotifyEnabled, isolatedPreview };
    if (!aliveRef.current || !sameContext(contextRef.current, expected)) return;
    const controller = new AbortController();
    providerOperationRef.current = controller;
    const current = () => !controller.signal.aborted && aliveRef.current && sameContext(contextRef.current, expected);
    void actions.connect({ accessToken, roomSlug, signal: controller.signal, current }).then((payload) => {
      if (!current()) return;
      location.assign(payload.url);
    }).catch((error) => {
      if (current()) callbacksRef.current.onPlaybackError(error instanceof Error ? error.message : i18n.t("common:authenticated_http_the_request_could_not_be_completed_try_again"));
    }).finally(() => {
      if (providerOperationRef.current === controller) providerOperationRef.current = null;
    });
  }, [accessToken, userId, spotifyEnabled, roomSlug, isolatedPreview]);

  const disconnectProvider = useCallback((provider: Provider) => {
    const actions = PROVIDER_CONNECTION_ACTIONS[provider];
    if (!actions || !accessToken || isolatedPreview || providerOperationRef.current ||
      PROVIDER_DEFINITIONS[provider].requiresSpotifyGrant && !spotifyEnabled) return;
    const expected = { accessToken, userId, roomSlug, spotifyEnabled, isolatedPreview };
    if (!aliveRef.current || !sameContext(contextRef.current, expected)) return;
    const controller = new AbortController();
    providerOperationRef.current = controller;
    const current = () => !controller.signal.aborted && aliveRef.current && sameContext(contextRef.current, expected);
    void actions.disconnect({ accessToken, roomSlug, signal: controller.signal, current }).then(() => {
      if (!current()) return;
      connectionRequestRef.current?.abort();
      setConnections((previous) => connectionsWithProviders({
        ...previous.providers,
        [provider]: { ...previous.providers[provider], connected: false, profile: null }
      }, previous.loaded));
    }).catch((error) => {
      if (current()) callbacksRef.current.onPlaybackError(error instanceof Error ? error.message : i18n.t("common:authenticated_http_the_request_could_not_be_completed_try_again"));
    }).finally(() => {
      if (providerOperationRef.current === controller) providerOperationRef.current = null;
    });
  }, [accessToken, userId, spotifyEnabled, roomSlug, isolatedPreview]);

  const connectSpotify = useCallback(() => connectProvider("spotify"), [connectProvider]);
  const disconnectSpotify = useCallback(() => disconnectProvider("spotify"), [disconnectProvider]);

  return {
    connections, connectionError, loadConnections, connectProvider, disconnectProvider,
    connectSpotify, disconnectSpotify, handleConnectionLost
  };
}
