import { z } from "zod";
import { approvedRemoteImageUrl } from "./remote-images.js";

export interface ArtworkSources {
  "150x150"?: string;
  "480x480"?: string;
  "1000x1000"?: string;
  mirrors?: string[];
}

const artworkUrl = z.string().url().max(2048).refine(value => Boolean(approvedRemoteImageUrl(value)));
const mirrorOrigin = artworkUrl.refine(value => {
  const url = new URL(value);
  return url.pathname === "/" && !url.search && !url.hash;
});

/** The same bounded metadata survives queue, library, profile and chat storage. */
export const artworkSourcesSchema = z.object({
  "150x150": artworkUrl.optional(),
  "480x480": artworkUrl.optional(),
  "1000x1000": artworkUrl.optional(),
  mirrors: z.array(mirrorOrigin).max(8).optional()
});

export function normalizeArtworkSources(value: unknown): ArtworkSources | undefined {
  const parsed = artworkSourcesSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
