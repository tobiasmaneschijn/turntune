import { createElement, type ComponentProps, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import type { Provider, ProviderTrackMapping } from "../../types";
import type { SoundSpinUserSettings } from "../settings/user-settings";
import type { CheckpointProviderPlaybackProps } from "./provider-playback";
import { AppleMusicPlayer } from "./providers/AppleMusicPlayer";
import { MixcloudPlayer } from "./providers/MixcloudPlayer";
import { SoundCloudPlayer } from "./providers/SoundCloudPlayer";
import { SpotifyPlayer } from "./providers/SpotifyPlayer";
import { YouTubePlayer } from "./providers/YouTubePlayer";

const nativePlayers = { youtube: YouTubePlayer, soundcloud: SoundCloudPlayer, spotify: SpotifyPlayer, apple: AppleMusicPlayer, mixcloud: MixcloudPlayer };
export type ProviderPlayerOverrides = Partial<{ [P in keyof typeof nativePlayers]: ComponentType<ComponentProps<(typeof nativePlayers)[P]>> }>;

export interface ProviderConnection {
  configured?: boolean;
  connected?: boolean;
  profile?: { displayName: string; product?: string } | null;
}

export interface PlaybackConnections {
  providers: Partial<Record<Provider, ProviderConnection>>;
  loaded: boolean;
  spotifyConfigured: boolean;
  spotifyConnected: boolean;
  spotifyProfile: { displayName: string; product?: string } | null;
  appleConfigured: boolean;
}

export interface RegisteredPlaybackProps extends CheckpointProviderPlaybackProps {
  mapping?: ProviderTrackMapping;
  mode: string;
  accessToken?: string;
  userId: string;
  roomSlug: string;
  settings: SoundSpinUserSettings["playback"];
  connections: PlaybackConnections;
  onConnectionLost: (message: string) => void;
  onConnect: () => void;
  players?: ProviderPlayerOverrides;
}

interface PlaybackProviderRegistration {
  Player: ComponentType<RegisteredPlaybackProps>;
  stageClassName?: string;
  artworkPreview?: boolean;
  /** Session players can remain mounted through an empty queue without recreating the SDK. */
  persistent?: (mode: string, props: Pick<RegisteredPlaybackProps, "accessToken" | "connections">) => boolean;
  connectionState?: (connections: PlaybackConnections, accessToken?: string) => "unconfigured" | "needs-connection" | undefined;
}

function SpotifyAdapter(props: RegisteredPlaybackProps) {
  const { t } = useTranslation("music");
  if (!props.accessToken || !props.connections.providers.spotify?.connected) return <div className="provider-player-shell spotify-player-shell">
    <strong>{t("nowPlaying.connectSpotifyHelp")}</strong>
    <Button type="button" onClick={props.onConnect} disabled={!props.connections.providers.spotify?.configured}>{t("nowPlaying.connectSpotify")}</Button>
  </div>;
  const Player = props.players?.spotify || SpotifyPlayer;
  return <Player {...props} accessToken={props.accessToken} mode={props.mode === "desktop" ? "desktop" : "web"}
    preferredDeviceId={props.settings.spotifyDeviceId} resumeAfterReconnect={props.settings.resumeAfterReconnect} />;
}

export const PLAYBACK_PROVIDER_REGISTRY = {
  youtube: { Player: (props) => createElement(props.players?.youtube || YouTubePlayer, props) },
  soundcloud: { Player: (props) => createElement(props.players?.soundcloud || SoundCloudPlayer, props) },
  mixcloud: { Player: (props) => createElement(props.players?.mixcloud || MixcloudPlayer, props), stageClassName: "has-mixcloud" },
  apple: {
    Player: (props) => props.accessToken && props.mapping
      ? createElement(props.players?.apple || AppleMusicPlayer, { ...props, accessToken: props.accessToken, mapping: props.mapping }) : null,
    connectionState: (connections) => connections.loaded && !connections.providers.apple?.configured ? "unconfigured" : undefined
  },
  spotify: {
    Player: SpotifyAdapter,
    artworkPreview: true,
    persistent: (mode, props) => mode !== "desktop" && Boolean(props.accessToken && props.connections.providers.spotify?.connected),
    connectionState: (connections, accessToken) => connections.loaded && !connections.providers.spotify?.configured ? "unconfigured"
      : !accessToken || !connections.providers.spotify?.connected ? "needs-connection" : undefined
  }
} satisfies Record<Provider, PlaybackProviderRegistration>;

export function playbackProvider(provider: Provider): PlaybackProviderRegistration {
  return PLAYBACK_PROVIDER_REGISTRY[provider];
}
