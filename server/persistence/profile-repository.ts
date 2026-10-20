import type { SupabaseClient } from "@supabase/supabase-js";
import { profileUpdateSchema, type ProfileUpdate } from "../features/accounts/profile-fields.js";
import { serverT } from "../lib/i18n.js";
import type { SoundSpinProfile, SoundSpinProfileOption } from "../types.js";

const PROFILE_COLUMNS = "user_id, display_name, is_app_admin, bio, avatar_key, avatar_url, avatar_path, theme_key, created_at, updated_at, handle, status_text, favorite_tracks";

/** Profile queries and ownership checks; local guest storage has no profiles. */
export class ProfileRepository {
  constructor(private readonly supabase: SupabaseClient | null) {}

  async loadOrCreateProfile(userId: string, displayName: string) {
    if (!this.supabase) return null;
    const current = await this.getProfile(userId);
    if (current) return current;
    // A reconnect carries potentially stale browser profile data. Only seed a
    // missing profile; never reset a saved display name while joining a room.
    const { error } = await this.supabase
      .from("soundspin_profiles")
      .upsert(
        { user_id: userId, display_name: displayName, updated_at: new Date().toISOString() },
        { onConflict: "user_id", ignoreDuplicates: true }
      );
    if (error) throw new Error(serverT("could_not_load_profile_value1", { value1: error.message }));
    const profile = await this.getProfile(userId);
    if (!profile) throw new Error(serverT("could_not_load_profile_after_creating_it"));
    return profile;
  }

  async getProfile(userId: string) {
    if (!this.supabase) return null;
    const { data, error } = await this.supabase
      .from("soundspin_profiles")
      .select(PROFILE_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(serverT("could_not_load_profile_value1", { value1: error.message }));
    return data as SoundSpinProfile | null;
  }

  async getProfileOptions() {
    if (!this.supabase) return [];
    const { data, error } = await this.supabase
      .from("soundspin_profile_options")
      .select("key, kind, name, metadata")
      .order("kind", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(serverT("could_not_load_profile_options_value1", { value1: error.message }));
    return (data || []) as SoundSpinProfileOption[];
  }

  async updateProfile(
    userId: string,
    input: ProfileUpdate
  ) {
    if (!this.supabase) return null;
    const update = profileUpdateSchema.parse(input);
    const supabase = this.supabase;
    const current = await this.getProfile(userId);
    if (!current) throw new Error(serverT("profile_not_found"));

    const validateOption = async (
      key: string,
      kind: SoundSpinProfileOption["kind"],
      missingMessage: string
    ) => {
      const { data: option, error } = await supabase
        .from("soundspin_profile_options")
        .select("key")
        .eq("key", key)
        .eq("kind", kind)
        .maybeSingle();
      if (error) throw new Error(serverT("could_not_validate_kind_value2", { kind: kind, value2: error.message }));
      if (!option) throw new Error(missingMessage);
    };

    if (update.avatarKey && update.avatarKey !== current.avatar_key) {
      await validateOption(update.avatarKey, "avatar", "That avatar does not exist.");
    }
    if (update.themeKey && update.themeKey !== current.theme_key) {
      await validateOption(update.themeKey, "theme", "That theme does not exist.");
    }

    let customAvatarUrl: string | undefined;
    if (update.customAvatarPath !== undefined) {
      const [folder, fileName, extra] = update.customAvatarPath.split("/");
      if (folder !== userId || !fileName || extra) throw new Error(serverT("that_avatar_upload_is_not_yours"));
      const { data: objects, error } = await supabase.storage
        .from("profile-avatars")
        .list(userId, { search: fileName, limit: 10 });
      if (error) throw new Error(serverT("could_not_validate_avatar_upload_value1", { value1: error.message }));
      if (!objects?.some((object) => object.name === fileName)) throw new Error(serverT("that_avatar_upload_was_not_found"));
      customAvatarUrl = supabase.storage.from("profile-avatars").getPublicUrl(update.customAvatarPath).data.publicUrl;
    }

    const values: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (update.displayName !== undefined) values.display_name = update.displayName;
    if (update.bio !== undefined) values.bio = update.bio;
    if (update.handle !== undefined) values.handle = update.handle;
    if (update.statusText !== undefined) values.status_text = update.statusText;
    if (update.favoriteTracks !== undefined) values.favorite_tracks = update.favoriteTracks;
    if (update.avatarKey !== undefined) {
      values.avatar_key = update.avatarKey;
      values.avatar_url = null;
      values.avatar_path = null;
    }
    if (update.customAvatarPath !== undefined) {
      values.avatar_url = customAvatarUrl;
      values.avatar_path = update.customAvatarPath;
    }
    if (update.themeKey !== undefined) values.theme_key = update.themeKey;

    const { data, error } = await supabase
      .from("soundspin_profiles")
      .update(values)
      .eq("user_id", userId)
      .select(PROFILE_COLUMNS)
      .single();
    if (error?.code === "23505" && update.handle !== undefined) throw new Error(serverT("that_handle_is_taken"));
    if (error) throw new Error(serverT("could_not_update_profile_value1", { value1: error.message }));
    return data as SoundSpinProfile;
  }
}
