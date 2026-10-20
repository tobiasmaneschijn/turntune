import type { ProfileTrack, SoundSpinProfile, SoundSpinProfileOption } from "../../types";

export interface ProfileResponse { profile: SoundSpinProfile; options?: SoundSpinProfileOption[] }
const nullableString = (value: unknown) => value === null || typeof value === "string";
function profileTrack(value: unknown): value is ProfileTrack {
  if (!value || typeof value !== "object") return false;
  const track = value as Record<string, unknown>;
  return ["youtube", "spotify", "apple", "soundcloud", "mixcloud"].includes(String(track.provider)) &&
    typeof track.providerId === "string" && typeof track.title === "string" && track.title.length > 0 &&
    (track.artist === undefined || typeof track.artist === "string") &&
    ["artworkUrl", "permalinkUrl"].every(key => track[key] === undefined || (typeof track[key] === "string" && /^https:\/\//.test(track[key]))) &&
    (track.durationMs === undefined || typeof track.durationMs === "number" && Number.isFinite(track.durationMs) && track.durationMs > 0);
}
const profileOption = (value: unknown) => {
  if (!value || typeof value !== "object") return false;
  const option = value as Record<string, unknown>;
  if (typeof option.key !== "string" || typeof option.name !== "string" || !["avatar", "theme"].includes(String(option.kind)) ||
    !option.metadata || typeof option.metadata !== "object" || Array.isArray(option.metadata)) return false;
  const metadata = option.metadata as Record<string, unknown>;
  return ["gradient", "imageUrl", "description"].every((key) => metadata[key] === undefined || typeof metadata[key] === "string");
};
export function isProfileResponse(payload: unknown): payload is ProfileResponse {
  if (!payload || typeof payload !== "object" || !("profile" in payload)) return false;
  const profile = payload.profile;
  return Boolean(profile && typeof profile === "object" && "user_id" in profile && typeof profile.user_id === "string" &&
    "display_name" in profile && typeof profile.display_name === "string" && "bio" in profile && typeof profile.bio === "string" &&
    "avatar_key" in profile && typeof profile.avatar_key === "string" && "theme_key" in profile && typeof profile.theme_key === "string" &&
    "is_app_admin" in profile && typeof profile.is_app_admin === "boolean" &&
    "avatar_url" in profile && nullableString(profile.avatar_url) && "avatar_path" in profile && nullableString(profile.avatar_path) &&
    "created_at" in profile && typeof profile.created_at === "string" && Number.isFinite(Date.parse(profile.created_at)) &&
    "updated_at" in profile && typeof profile.updated_at === "string" && Number.isFinite(Date.parse(profile.updated_at)) &&
    (!("handle" in profile) || profile.handle === null || typeof profile.handle === "string" && /^[a-z0-9_]{3,24}$/.test(profile.handle)) &&
    (!("status_text" in profile) || typeof profile.status_text === "string" && profile.status_text.length <= 80) &&
    (!("favorite_tracks" in profile) || Array.isArray(profile.favorite_tracks) && profile.favorite_tracks.length <= 3 && profile.favorite_tracks.every(profileTrack)) &&
    (!('options' in payload) || payload.options === undefined || Array.isArray(payload.options) && payload.options.every(profileOption)));
}
