import { providerSignal } from "../../integrations/provider-http.js";
import { isProviderAvailable } from "../../../shared/provider-definitions.js";
import type { SoundCloudApi } from "../../integrations/soundcloud.js";
import { createServerProviderRegistry, type ServerProviderRegistry, type TrackInput, type VerifiedDuration } from "./provider-registry.js";

export { parseIsoDuration } from "./provider-registry.js";

/** Only exact source lookups establish duration provenance, never a client hint. */
export async function verifyTrackDuration(input: TrackInput, options: { youtubeApiKey?: string; soundCloud?: SoundCloudApi; fetcher?: typeof fetch; signal?: AbortSignal; providers?: ServerProviderRegistry }): Promise<VerifiedDuration> {
  options.signal?.throwIfAborted();
  if (!isProviderAvailable(input.provider)) return { durationVerified: false };
  const signal = providerSignal(options.signal, 4_000);
  const providers = options.providers ?? createServerProviderRegistry({ youtubeApiKey: options.youtubeApiKey, soundCloud: options.soundCloud, fetchImpl: options.fetcher });
  try {
    return await providers[input.provider]?.verifyDuration?.(input, signal) ?? { durationVerified: false };
  } catch {
    options.signal?.throwIfAborted();
    // Unknown metadata stays ineligible when a length limit is enabled.
    return { durationVerified: false };
  }
}
