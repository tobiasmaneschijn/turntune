import type { Provider } from "../../types";
import i18n from "../../i18n";
import { requestJson } from "../../lib/authenticated-http";
import { resetProviderSession } from "./provider-session";

export interface ProviderConnectionActionContext {
  accessToken: string;
  roomSlug: string;
  signal: AbortSignal;
  current(): boolean;
}

interface ProviderConnectionActions {
  connect(context: ProviderConnectionActionContext): Promise<{ url: string }>;
  disconnect(context: ProviderConnectionActionContext): Promise<void>;
}

export const PROVIDER_CONNECTION_ACTIONS: Partial<Record<Provider, ProviderConnectionActions>> = {
  spotify: {
    async connect({ accessToken, roomSlug, signal }) {
      try {
        const payload = await requestJson<{ url?: string }>(`/api/spotify/connect?roomSlug=${encodeURIComponent(roomSlug)}&returnTo=${encodeURIComponent(location.pathname)}`, {
          accessToken, signal, headers: { "x-soundspin-room": roomSlug },
          errorMessage: i18n.t("music:nowPlaying.spotifyConnectFailed")
        });
        if (!payload.url) throw new Error(i18n.t("music:nowPlaying.spotifyConnectFailed"));
        return { url: payload.url };
      } catch (error) {
        throw error instanceof Error ? error : new Error(i18n.t("music:nowPlaying.spotifyConnectFailed"));
      }
    },
    async disconnect({ accessToken, roomSlug, signal, current }) {
      try {
        const response = await fetch("/api/spotify/connection", {
          method: "DELETE",
          signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
          headers: { Authorization: `Bearer ${accessToken}`, "x-soundspin-room": roomSlug }
        });
        if (signal.aborted || !current()) return;
        if (!response.ok) throw new Error(i18n.t("music:nowPlaying.spotifyDisconnectFailed"));
        void resetProviderSession("spotify");
      } catch (error) {
        throw error instanceof Error ? error : new Error(i18n.t("music:nowPlaying.spotifyDisconnectFailed"));
      }
    }
  }
};
