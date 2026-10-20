import { serverT } from "../../lib/i18n.js";
import type { Room, Track } from "../../types.js";
import { effectiveRoomPolicy } from "../../../shared/room-policy.js";
import { roomAllowsProvider } from "../../../shared/providers.js";

export interface RadioState {
  stopped: boolean;
  stopAfterTrackId: string | null;
  turn?: { userId: string; limit: number; used: number };
  fallback: { enabled: boolean; tracks: Track[]; cursor: number; autoPaused: boolean };
  repeatLedger: Record<string, number>;
  ledgerSince: number;
  exceptions: Record<string, number>;
  skipVotes: { trackId: string | null; userIds: string[] };
}
type PolicyRoom = Room & { radioState?: RadioState };
const DAY = 86_400_000;
export function recordingKeys(track: Pick<Track,"provider"|"providerId"|"canonicalId"|"isrc">) {
  return [...new Set([`${track.provider}:${track.providerId}`, ...(track.canonicalId ? [track.canonicalId] : []), ...(track.isrc ? [`isrc:${track.isrc}`] : [])])];
}
export function radioState(room: PolicyRoom, now=Date.now()):RadioState {
  if (!room.radioState) {
    const repeatLedger:Record<string,number> = Object.create(null);
    for (const track of [...room.history, ...(room.playback.track ? [room.playback.track] : [])]) if (track.playedAt && track.playedAt > now-DAY) {
      for (const key of recordingKeys(track)) repeatLedger[key]=Math.max(repeatLedger[key]??0,track.playedAt);
    }
    room.radioState={stopped:false,stopAfterTrackId:null,fallback:{enabled:false,tracks:[],cursor:0,autoPaused:false},repeatLedger,ledgerSince:now,exceptions:{},skipVotes:{trackId:null,userIds:[]}};
  }
  return room.radioState;
}
export function activeDjRestriction(room: Room, userId:string, now=Date.now()) {
  return room.moderation?.restrictions?.find(r=>r.userId===userId && (r.kind==="room-ban"||r.kind==="dj-suspension") && r.revokedAt===null && (r.expiresAt===null||r.expiresAt>now));
}
export function trackEligibility(room:PolicyRoom, track:Track, now=Date.now(), fallback=false):string|null {
  const policy=effectiveRoomPolicy(room,now),state=radioState(room,now);
  if (!roomAllowsProvider(policy,track.provider)) return serverT("this_music_service_is_disabled");
  if (fallback && (!track.durationVerified || !track.durationMs || track.isLive)) return serverT("fallback_needs_a_verified_finite_track");
  if (policy.maxTrackMinutes && state.exceptions[track.id] !== (room.policyRevision??0)) {
    if (!track.durationVerified || !track.durationMs || track.isLive) return serverT("duration_is_unknown_or_live_a_moderator_exception_is_required");
    if (track.durationMs>policy.maxTrackMinutes*60_000) return serverT("longer_than_the_value1_minute_limit", { value1: policy.maxTrackMinutes });
  }
  if (policy.repeatWindowMinutes) {
    const boundary=now-policy.repeatWindowMinutes*60_000;
    if (recordingKeys(track).some(key=>(state.repeatLedger[key]??0)>boundary)) return serverT("this_recording_is_inside_the_repeat_window");
  }
  return null;
}
export function recordTrackStart(room:PolicyRoom,track:Track,now:number) {
  const state=radioState(room,now);
  for (const [key,time] of Object.entries(state.repeatLedger)) if (time<=now-DAY) delete state.repeatLedger[key];
  for (const key of recordingKeys(track)) state.repeatLedger[key]=now;
  state.skipVotes={trackId:track.id,userIds:[]};
}
export function skipVoteSummary(room:PolicyRoom,userId:string,onlineIds:string[]) {
  const policy=effectiveRoomPolicy(room),state=radioState(room);
  const eligible=new Set(onlineIds.filter(id=>id!==room.playback.track?.addedBy.id));
  return {trackId:room.playback.track?.id??null,count:state.skipVotes.trackId===room.playback.track?.id?state.skipVotes.userIds.filter(id=>eligible.has(id)).length:0,required:Math.max(policy.skipVote?.minimum??3,Math.ceil(eligible.size*(policy.skipVote?.percent??60)/100)),voted:state.skipVotes.trackId===room.playback.track?.id&&state.skipVotes.userIds.includes(userId)};
}
/** Theme overlays never overwrite a later manual edit or the lasting room note. */
export function roomSession(room:Room,now=Date.now()) {
  const active=(room.settings.themeSchedules??[]).find(s=>s.startsAt<=now&&s.endsAt>now);
  return {theme:active?.theme??room.settings.themePrompt,sessionNote:active?.note?{id:active.id,text:active.note,expiresAt:active.endsAt}:null};
}
