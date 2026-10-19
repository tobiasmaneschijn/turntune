import { serverT } from "./i18n.js";
import { z } from "zod";
import { MUSIC_PROVIDERS } from "../shared/providers.js";
import type { Room, RoomCapability } from "./types.js";
import { requireRoomCapability, requireNotBanned } from "./room-access.js";
import { RoomCommandError } from "./socket-handler.js";

export const allowedProvidersSchema = z.array(z.enum(MUSIC_PROVIDERS))
  .min(1, serverT("allow_at_least_one_music_service"))
  .max(MUSIC_PROVIDERS.length)
  .refine(providers => new Set(providers).size === providers.length, serverT("music_services_must_be_unique"));

const feature = z.enum(["everyone", "staff", "nobody"]);
const minutes = z.number().int().min(1).max(1440).nullable();
const timeZone = z.string().min(1).max(80).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, serverT("choose_a_valid_time_zone"));
export const roomSettingsPatchSchema = z.object({
  name: z.string().trim().min(1).max(48).optional(), description: z.string().trim().max(240).optional(),
  isPublic: z.boolean().optional(), password: z.string().max(128).nullable().optional(), passwordHash: z.string().nullable().optional(),
  djAccess: z.enum(["everyone", "roles"]).optional(), allowedProviders: allowedProvidersSchema.optional(),
  themePrompt: z.string().trim().max(160).nullable().optional(), accessMode: z.enum(["public", "unlisted", "members"]).optional(),
  moderatorPermissions: z.object({ chatParticipants: z.boolean(), djsPlayback: z.boolean(), roomDetailsMusic: z.boolean(), accessInvites: z.boolean() }).strict().optional(),
  invitePermission: z.enum(["default", "owner", "staff", "members"]).optional(), rulesText: z.string().trim().max(5000).optional(),
  requireRulesAcceptance: z.boolean().optional(), rulesVersion: z.number().int().min(1).optional(),
  chatMode: z.enum(["everyone", "staff"]).optional(), slowModeSeconds: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(30), z.literal(60)]).optional(),
  mediaPermission: feature.optional(), linksPermission: feature.optional(), pollsPermission: feature.optional(),
  djJoinLocked: z.boolean().optional(), djCapacity: z.number().int().min(1).max(100).nullable().optional(),
  maxTrackMinutes: minutes.optional(), repeatWindowMinutes: minutes.optional(), manualPlayback: z.enum(["current-dj", "staff"]).optional(),
  songsPerTurn: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  skipVote: z.object({ enabled: z.boolean(), percent: z.number().int().min(1).max(100), minimum: z.number().int().min(1).max(100) }).strict().optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(6).refine(tags => new Set(tags.map(tag => tag.toLowerCase())).size === tags.length, serverT("use_unique_tags")).optional(),
  language: z.string().trim().max(35).refine(value => { try { return !value || Intl.getCanonicalLocales(value).length === 1; } catch { return false; } }, serverT("choose_a_valid_language")).optional(),
  themeSchedules: z.array(z.object({ id: z.string().uuid(), theme: z.string().trim().min(1).max(160), startsAt: z.number().int().nonnegative(), endsAt: z.number().int().nonnegative(), timeZone, note: z.string().trim().max(500).optional() }).strict().refine(schedule => schedule.endsAt > schedule.startsAt, serverT("end_time_must_follow_start_time"))).max(10).refine(schedules => {
    const sorted = [...schedules].sort((a, b) => a.startsAt - b.startsAt);
    return new Set(sorted.map(item => item.id)).size === sorted.length && sorted.every((item, index) => !index || sorted[index - 1].endsAt <= item.startsAt);
  }, serverT("theme_schedules_cannot_overlap")).optional(),
  policyRevision: z.number().int().nonnegative().optional()
}).strict().refine(input => Object.keys(input).some(key => key !== "policyRevision"), serverT("no_room_changes_supplied"));
export type RoomSettingsPatch = z.infer<typeof roomSettingsPatchSchema>;
const ACCESS_FIELDS = new Set(["isPublic", "password", "passwordHash", "accessMode", "invitePermission", "rulesText", "rulesVersion", "requireRulesAcceptance"]);
const CHAT_FIELDS = new Set(["chatMode", "slowModeSeconds", "mediaPermission", "linksPermission", "pollsPermission"]);
const DJ_FIELDS = new Set(["djJoinLocked", "djCapacity", "manualPlayback", "songsPerTurn", "skipVote"]);
export function authorizeRoomSettingsPatch(room: Room, actor: string, input: RoomSettingsPatch) {
  requireNotBanned(room, actor);
  if (input.allowedProviders?.includes("spotify") && room.settings.spotifyEnabled !== true) throw new RoomCommandError(serverT("only_an_app_admin_can_enable_spotify_for_this_room"));
  if (input.moderatorPermissions !== undefined && room.ownerUserId !== actor) throw new RoomCommandError(serverT("only_the_owner_can_change_moderator_permissions"));
  for (const key of Object.keys(input)) {
    if (key === "policyRevision" || key === "moderatorPermissions") continue;
    const group: RoomCapability = ACCESS_FIELDS.has(key) ? "accessInvites" : CHAT_FIELDS.has(key) ? "chatParticipants" : DJ_FIELDS.has(key) ? "djsPlayback" : "roomDetailsMusic";
    requireRoomCapability(room, actor, group);
  }
  if (input.policyRevision !== undefined && input.policyRevision !== (room.policyRevision ?? 0)) throw new RoomCommandError(serverT("room_settings_changed_reopen_settings_before_saving"));
  if ((input.requireRulesAcceptance ?? room.settings.requireRulesAcceptance) && !(input.rulesText ?? room.settings.rulesText)?.trim()) throw new RoomCommandError(serverT("add_room_rules_before_requiring_acceptance"));
}
