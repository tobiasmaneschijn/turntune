import { serverT } from "./lib/i18n.js";
import { mountAdminRoutes } from "./features/admin/admin-routes.js";
import { mountMusicRoutes } from "./features/music/music-routes.js";
import { mountRoomActions } from "./features/rooms/room-actions.js";
import { RoomCommandService } from "./features/rooms/room-command-service.js";
import { hashRoomPassword, passwordMatches } from "./features/rooms/room-password.js";
import { RoomEntryLimiter } from "./features/rooms/room-entry-limiter.js";
import { IdleRoomRegistry } from "./features/rooms/idle-rooms.js";
import { reconcileDjPresence } from "./features/rooms/dj-presence.js";
import { runtimeMetrics } from "./lib/runtime-metrics.js";
import { mountSpotifyOAuthRoutes } from "./integrations/spotify/spotify-oauth-routes.js";
import { createSocketCredentialLease, type SocketCredentialLease } from "./realtime/socket-credentials.js";
import { createChatWritePolicy } from "./features/chat/chat-write-policy.js";
import { joinSchema } from "../shared/room-protocol.js";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { verifyCredentials } from "@supabase/server/core";
import { createBoundedAdminClient } from "./integrations/supabase-client.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Server } from "socket.io";
import { z } from "zod";
import { Store } from "./persistence/store.js";
import { profileUpdateSchema } from "./features/accounts/profile-fields.js";
import { roomSettingsPatchSchema } from "./features/rooms/room-settings.js";
import { accessMode, chatParticipationError, effectiveRoomPolicy, isRoomStaff } from "../shared/room-policy.js";
import { canInviteRoom, isRoomBanned, roleInRoom, requireNotBanned, requireProtectedTarget, requireRoomCapability } from "./features/rooms/room-access.js";
import { ChatCommandService } from "./features/chat/chat-command-service.js";
import { verifyTrackDuration } from "./features/music/track-metadata.js";
import { RoomSessionScheduler } from "./features/rooms/room-session-scheduler.js";
import { radioState } from "./features/rooms/radio-policy.js";
import { ModerationService } from "./features/moderation/moderation-service.js";
import { mountModerationRoutes } from "./features/moderation/moderation-routes.js";
import { mountPrivateLibraryRoutes } from "./features/music/library-routes.js";
import { mountSocialRoutes } from "./features/social/social-routes.js";
import { SocialStore } from "./features/social/social-store.js";
import { loadChatReply, loadStoredChatMessage, mountChatHistoryRoutes } from "./features/chat/chat-history.js";
import { createChatRelay } from "./features/chat/chat-relay.js";
import { resolveChatMediaUrl } from "./features/chat/chat-media.js";
import { withPublicRoomPreview } from "./features/rooms/directory-preview.js";
import { createSavedSetResolver, SetImportRegistry } from "./features/music/saved-set.js";
import { validateServerConfig } from "./lib/config.js";
import { configureHttpSecurity, trustedClientIp, trustedSocketPeer } from "./security/security-http.js";
import { SecurityBudget, SecurityLimitError, peerRequestBudget, claimSocketAccount } from "./security/security-budget.js";
import { ResourceAdmission } from "./resources/resource-admission.js";
import { DEFAULT_GLOBAL_LIMITS } from "../shared/resource-policy.js";
import { roomAllowsProvider } from "../shared/providers.js";
import { spotifyRoomContext } from "./features/music/spotify-access.js";
import { validUserClaims } from "./security/security-identity.js";
import { PlatformSecurity } from "./security/platform-security.js";
import { cleanupRestrictedAccount } from "./features/accounts/account-restriction-cleanup.js";
import { AccountDeletionService } from "./features/accounts/account-deletion.js";
import { mountPlatformRoutes } from "./features/admin/platform-routes.js";
import { mountManagedUploadRoutes } from "./features/uploads/upload-routes.js";
import { mountFeedbackRoutes } from "./features/feedback/feedback-routes.js";
import { cleanupManagedUploads } from "./features/uploads/managed-uploads.js";
import { mountSignupRoutes } from "./features/auth/signup-routes.js";
import { securityEvent, securityEventSnapshot, securityRequestContext } from "./security/security-events.js";
import { RoomCommandError, safeSocketHandler, serialSocketHandler } from "./realtime/socket-handler.js";
import { PublicRequestError } from "./lib/public-request-error.js";
import { roomPresence, uniqueUsers } from "./features/rooms/presence.js";
import { activeAnnouncement, AnnouncementExpiryRegistry } from "./features/rooms/announcements.js";
import { SoundCloudApi } from "./integrations/soundcloud.js";
import { AppleMusicApi } from "./integrations/apple-music.js";
import { resolveTrackMappings } from "./features/music/provider-mappings.js";
import { SpotifyAccounts } from "./integrations/spotify/spotify-accounts.js";
import { SpotifyApi } from "./integrations/spotify/spotify.js";
import { GiphyApi } from "./integrations/giphy.js";
import {
  advanceRadio,
  GracePeriodRegistry,
  QueueUndoRegistry,
  normalizeRadioState,
  removeDj,
  roomForListener
} from "./features/rooms/radio.js";
import type { Room, RoomMemberRecord, RoomSnapshot, User } from "./types.js";

validateServerConfig(process.env);

const port = Number(process.env.PORT || 3000);
const app = express();
app.use(securityRequestContext);
app.use("/api",(_request,response,next)=>{response.set("Cache-Control","no-store");response.vary("Authorization");next();});
const httpSecurity = configureHttpSecurity(app,process.env);
const securityBudget = new SecurityBudget();
const resourceAdmission = new ResourceAdmission(securityBudget);
let globalResourceLimits = DEFAULT_GLOBAL_LIMITS;
let globalResourcePolicyAvailable = true;
app.use("/api",peerRequestBudget(securityBudget,trustedClientIp));
const httpServer = createServer(app);
httpServer.requestTimeout = 30_000;
httpServer.headersTimeout = 15_000;
httpServer.keepAliveTimeout = 5_000;
const io: Server = new Server(httpServer, {
  cors: { origin: httpSecurity.origin, credentials: false }, maxHttpBufferSize: 64 * 1024,
  allowRequest: (request,done) => httpSecurity.allowRequest(request,(error,allowed) => {
    if (!allowed) return done(error,false);
    const peer=trustedClientIp(request);
    if (!globalResourcePolicyAvailable || io.engine.clientsCount >= globalResourceLimits.socketsTotal || !securityBudget.consume([{key:`socket-open:${peer}`,maximum:120,windowMs:60_000}])) return done(serverT("too_many_connections"),false);
    done(null,true);
  })
});
io.engine.use((request:IncomingMessage,_response:ServerResponse,next:(error?:Error)=>void)=>httpSecurity.allowRequest(request,(error,allowed)=>allowed?next():next(new Error(error||serverT("request_not_allowed")))));
const store = new Store();
const resourcePolicies = store.resourcePolicies;
// Engine.IO includes unauthenticated transports. Claim capacity synchronously
// when the transport opens so simultaneous handshakes cannot over-admit.
io.engine.on("connection",connection=>{
  const release=securityBudget.acquire("socket-total",globalResourceLimits.socketsTotal);
  if(!release){connection.close(true);return;}
  connection.once("close",release);
});
const roomCommands = new RoomCommandService(store, broadcast);
const supabaseUrl = process.env.SUPABASE_URL;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const supabaseJwksUrl = process.env.SUPABASE_JWKS_URL;
const signupInvitePassword = process.env.SIGNUP_INVITE_PASSWORD?.trim() || "";
const youtubeApiKey = process.env.YOUTUBE_API_KEY;
const soundCloudApi = new SoundCloudApi(
  process.env.SOUNDCLOUD_CLIENT_ID,
  process.env.SOUNDCLOUD_CLIENT_SECRET
);
const spotifyApi = new SpotifyApi();
const giphyApi = new GiphyApi();
const appleMusicApi = new AppleMusicApi();
const spotifyAccounts = new SpotifyAccounts(store, spotifyApi);
const authEnabled = Boolean(
  supabaseUrl &&
  supabasePublishableKey &&
  supabaseSecretKey &&
  supabaseJwksUrl &&
  store.usesSupabase
);
const supabaseAdmin: SupabaseClient | null = authEnabled ? createBoundedAdminClient() : null;
const signupAdmin = supabaseAdmin && signupInvitePassword ? supabaseAdmin : null;
const platform = new PlatformSecurity(supabaseAdmin,!authEnabled && ["test","development"].includes(process.env.NODE_ENV || ""));
const requestIdentities = new WeakMap<express.Request,Promise<{userId:string;aal:unknown}|null>>();
const activeRequests = new WeakMap<express.Request,Promise<string|null>>();
const blockedRooms = new Set<string>();

// Live coordination is process-local. `roomUsers` is socket presence, while
// `roomDjUsers` also keeps a disconnected DJ's display data during the grace
// period. Durable room/radio state lives in Store/Supabase.
const roomUsers = new Map<string, Map<string, User>>();
const roomDjUsers = new Map<string, Map<string, User>>();
const socketRooms = new Map<string, string>();
const activeSocketActions = new Set<Promise<void>>();
let shuttingDown = false;
const DJ_DISCONNECT_GRACE_MS = 60_000;
const djEvictions = new GracePeriodRegistry(DJ_DISCONNECT_GRACE_MS);
const queueUndo = new QueueUndoRegistry();
const setImports = new SetImportRegistry();
const roomEntryLimiter = new RoomEntryLimiter();
const resolveSavedRecording = createSavedSetResolver({ spotify: spotifyApi, appleMusic: appleMusicApi, soundCloud: soundCloudApi,youtubeApiKey });
const resolveSpotifySavedRecording = createSavedSetResolver({ spotify: spotifyApi, appleMusic: appleMusicApi, soundCloud: soundCloudApi,youtubeApiKey,allowSpotify:true });
const sessionScheduler=new RoomSessionScheduler(roomCommands,broadcast,id=>uniqueUsers(roomUsers.get(id)?.values()??[]).length);
const announcementExpiries = new AnnouncementExpiryRegistry(async (room) => {
  await roomCommands.execute(room, draft => {
    if (draft.announcement?.expiresAt !== null && draft.announcement?.expiresAt !== undefined && draft.announcement.expiresAt <= Date.now()) draft.announcement = null;
    return { result: undefined };
  });
});
const idleRooms = new IdleRoomRegistry(roomId => {
  if (roomUsers.get(roomId)?.size) return true;
  const room = store.getRoom(roomId);
  if(room&&!blockedRooms.has(roomId)&&(room.settings.themeSchedules?.some(s=>s.endsAt>Date.now())||radioState(room).fallback.enabled))return false;
  if (room?.djQueueUserIds.some(id => hasPendingDjEviction(roomId, id))) return false;
  if (!store.releaseRoom(roomId)) return false;
  announcementExpiries.cancel(roomId);
  queueUndo.releaseRoom(roomId);
  setImports.releaseRoom(roomId);
  roomDjUsers.delete(roomId);
  sessionScheduler.release(roomId);
  blockedRooms.delete(roomId);
  return true;
});
function watchIdleRoom(roomId: string) { if (store.usesSupabase && !roomUsers.get(roomId)?.size) idleRooms.schedule(roomId); }
store.setRoomCacheHooks(watchIdleRoom,roomId=>!blockedRooms.has(roomId)&&(Boolean(roomUsers.get(roomId)?.size) ||
  Boolean(store.getRoom(roomId)?.djQueueUserIds.some(id=>hasPendingDjEviction(roomId,id))) ||
  Boolean(store.getRoom(roomId)?.settings.themeSchedules?.some(item=>item.endsAt>Date.now())) ||
  Boolean(store.getRoom(roomId)?.radioState?.fallback.enabled)));
const roomCreateSchema = z.object({
  name: z.string().trim().min(1).max(48),
  isPublic: z.boolean().default(true),
  accessMode:z.enum(["public","unlisted","members"]).optional(),
  password: z.string().max(128).optional()
});

const roomSettingsSchema = roomSettingsPatchSchema;

const favoriteSchema = z.object({ favorite: z.boolean() });

function roomSlug(name: string) {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 38) || "room";
  return `${base}-${crypto.randomBytes(3).toString("hex")}`;
}

console.log("Signup configuration:", {
  signupInvitePassword: Boolean(signupInvitePassword),
  supabaseUrl: Boolean(supabaseUrl),
  supabasePublishableKey: Boolean(supabasePublishableKey),
  supabaseSecretKey: Boolean(supabaseSecretKey),
  supabaseJwksUrl: Boolean(supabaseJwksUrl),
  usesSupabase: store.usesSupabase,
  authEnabled,
  signupAdmin: Boolean(signupAdmin)
});

function spotifyRedirectUri(request: express.Request) {
  if (process.env.SPOTIFY_REDIRECT_URI) return process.env.SPOTIFY_REDIRECT_URI;
  const host = request.get("host") || "127.0.0.1:5173";
  const spotifySafeHost = host.replace(/^localhost(?=:|$)/i, "127.0.0.1");
  return `${request.protocol}://${spotifySafeHost}/api/spotify/callback`;
}

async function getRequestIdentity(request: express.Request) {
  if (!authEnabled) return null;
  const cached=requestIdentities.get(request); if(cached)return cached;
  const pending=(async()=>{
  const authorization = request.get("authorization");
  const token = authorization?.match(/^Bearer (.+)$/i)?.[1];
  if (!token || token.length>16_384) return null;
  const { data, error } = await verifyCredentials(
    { token, apikey: null },
    { auth: "user" }
  );
  if(error || !data.userClaims || !validUserClaims(data.jwtClaims,supabaseUrl))return null;
  return {userId:data.userClaims.id,aal:data.jwtClaims?.aal};
  })();
  requestIdentities.set(request,pending);return pending;
}
async function getApiUserId(request: express.Request) {
  const cached=activeRequests.get(request);if(cached)return cached;
  const pending=(async()=>{const identity=await getRequestIdentity(request);return identity&&await platform.activeAccount(identity.userId)?identity.userId:null;})();
  activeRequests.set(request,pending);return pending;
}
async function getSelfServiceUserId(request: express.Request) {
  const identity=await getRequestIdentity(request);
  return identity && await platform.verifiedAccount(identity.userId) ? identity.userId : null;
}

async function getApiAdminUserId(request: express.Request): Promise<
  { ok: true; userId: string } |
  { ok: false; error: string; status: 401 | 403 }
> {
  const userId = await getApiUserId(request);
  if (!userId) return { ok: false, error: serverT("authentication_required"), status: 401 };
  const profile = await store.getProfile(userId);
  if (!profile?.is_app_admin) return { ok: false, error: serverT("administrator_access_required"), status: 403 };
  if ((await getRequestIdentity(request))?.aal !== "aal2") return {ok:false,error:serverT("verify_a_second_factor_before_using_administrator_tools"),status:403};
  return { ok: true, userId };
}

async function canUseSpotify(request:express.Request,userId:string,explicitRoom?:string) {
  if(!await platform.activeAccount(userId))return false;
  const callback=/^(?:\/api\/spotify)?\/callback$/i.test(request.path);
  const roomId=callback?explicitRoom:(explicitRoom??spotifyRoomContext(request));
  if(!roomId)return Boolean((await store.getProfile(userId))?.is_app_admin);
  if(!await platform.activeRoom(roomId))return false;
  const room=await store.loadRoom(roomId);
  if(!room||!roomAllowsProvider(room.settings,"spotify")||isRoomBanned(room,userId))return false;
  const access=await store.getRoomAccess(roomId,userId);
  if(!access.exists||access.banned||(!access.isPublic&&!access.role))return false;
  // OAuth navigation closes the initiating socket. The saved flow carries the
  // already-checked room; all later provider requests require live admission.
  if(callback)return true;
  return [...(roomUsers.get(roomId)?.values()??[])].some(user=>user.id===userId);
}

// Verify private requests before accepting/parsing uploads or other request bodies.
app.use("/api",async(request,response,next)=>{
  try {
    const publicPath=["/health","/ready","/config","/signup","/spotify/callback"].includes(request.path);
    if(publicPath)return next();
    const selfService=request.path==="/account/deletion-request" || request.path.startsWith("/account/export/");
    const actor=await(selfService?getSelfServiceUserId(request):getApiUserId(request));
    if(!actor)return void response.status(401).json({error:serverT("authentication_required")});
    const roomSlug=request.path.match(/^\/rooms\/([a-z0-9-]{3,48})(?:\/|$)/)?.[1];
    if(roomSlug&&!await platform.activeRoom(roomSlug))return void response.status(404).json({error:serverT("room_not_found")});
    if(roomSlug)blockedRooms.delete(roomSlug);
    if(!securityBudget.consume([{key:`http-user:${actor}`,maximum:300,windowMs:60_000}]))return void response.set("Retry-After","60").status(429).json({error:serverT("too_many_requests_wait_a_minute_before_trying_again")});
    const release=securityBudget.acquire(`http-user-flight:${actor}`,12);
    if(!release)return void response.set("Retry-After","60").status(429).json({error:serverT("too_many_concurrent_requests")});
    response.once("finish",release);response.once("close",release);
    const roomWrite=roomSlug&&!["GET","HEAD"].includes(request.method)&&!request.path.includes("/chat/")&&!request.path.endsWith("/favorite");
    if(roomWrite) {
      const policy=await resourcePolicies.get(actor);
      await resourceAdmission.roomAction("http:room-write",actor,roomSlug,policy,()=>new Promise<void>(resolve=>{
        response.once("finish",resolve);response.once("close",resolve);next();
      }));
    } else next();
  }catch(error){if(!response.headersSent)response.status(error instanceof SecurityLimitError?429:503).json({error:error instanceof SecurityLimitError?error.message:serverT("account_access_could_not_be_verified_try_again")});}
});

mountSignupRoutes(app,{admin:signupAdmin?.auth.admin??null,invitePassword:signupInvitePassword,
  appOrigin:process.env.APP_ORIGIN || "http://127.0.0.1:5173"});
mountManagedUploadRoutes(app,{client:supabaseAdmin,getUserId:getApiUserId,getResourcePolicy:actor=>resourcePolicies.get(actor)});
mountFeedbackRoutes(app,{client:supabaseAdmin,getUserId:getApiUserId});

mountPrivateLibraryRoutes(app, store, getApiUserId);
const socialStore = new SocialStore({
  supabase: supabaseAdmin,
  getRoomAccess: async (slug, userId) => {
    const access = await store.getRoomAccess(slug, userId);
    const room=await store.loadRoom(slug);
    return { ...access, canInvite:Boolean(room&&canInviteRoom(room,userId,Date.now(),access.role)), passwordProtected: Boolean(access.passwordHash) };
  },
  getProfile: userId => store.getProfile(userId),
  isProfileVisible:userId=>platform.activeAccount(userId),
  getRoom: async slug => { const room = await store.loadRoom(slug); return room ? { name: room.name } : null; },
  getActivity: userId => {
    for (const [roomSlug, users] of roomUsers) {
      if ([...users.values()].some(user => user.id === userId)) return { roomSlug };
    }
    return null;
  }
});
mountSocialRoutes(app, socialStore, getApiUserId);
async function canWriteRoomChat(userId: string, roomSlug: string) {
  if (!await platform.activeAccount(userId) || !await platform.activeRoom(roomSlug)) return false;
  const room=await store.loadRoom(roomSlug);
  if(!room||isRoomBanned(room,userId))return false;
  const access = await store.getRoomAccess(roomSlug, userId);
  return access.exists && !access.banned && (access.isPublic || Boolean(access.role)) &&
    [...(roomUsers.get(roomSlug)?.values() || [])].some(user => user.id === userId);
}
const chatWritePolicy = createChatWritePolicy();
/** HTTP poll mutations and the relay share the same fresh admitted recipient gate. */
async function emitAdmittedChat(roomId: string, event: 'chat:message' | 'chat:reaction' | 'chat:typing' | 'chat:poll' | 'chat:removed', payload: unknown,
  origin: { socketId?: string; userId: string }) {
  const recipients = [...(roomUsers.get(roomId) || [])];
  const [allowed, canWrite] = await Promise.all([
    store.allowedRoomReaders(roomId, recipients.map(([, user]) => user.id)),
    canWriteRoomChat(origin.userId, roomId)
  ]);
  const sender = origin.socketId ? getMembership(origin.socketId) : undefined;
  const senderAdmitted = origin.socketId
    ? sender?.room.id === roomId && sender.user.id === origin.userId
    : [...(roomUsers.get(roomId)?.values() || [])].some(user => user.id === origin.userId);
  if (!canWrite || !allowed.has(origin.userId) || !senderAdmitted) {
    throw new RoomCommandError(serverT("this_room_session_has_ended_join_again_before_sending_chat"));
  }
  for (const [socketId, user] of recipients) {
    const current = getMembership(socketId);
    if (allowed.has(user.id) && current?.room.id === roomId && current.user.id === user.id) io.to(socketId).emit(event, payload);
  }
}
const chatCommands=new ChatCommandService({client:supabaseAdmin,
  withRoomOperation:(roomId,run)=>store.withRoomOperation(roomId,run),
  getMentionAudience:async(roomId)=>{
    const users=uniqueUsers(roomUsers.get(roomId)?.values()??[]);
    const allowed=await store.allowedRoomReaders(roomId,users.map(user=>user.id));
    return users.filter(user=>allowed.has(user.id));
  },
  getUser:async(userId,roomId)=>[...(roomUsers.get(roomId)?.values()??[])].find(u=>u.id===userId)??null,
  authorize:async(userId,roomId,kind,targetUserId)=>{
    if(!await canWriteRoomChat(userId,roomId))throw new RoomCommandError(serverT("join_this_room_before_participating"));
    const room=await store.loadRoom(roomId);if(!room)throw new RoomCommandError(serverT("room_not_found"));requireNotBanned(room,userId);
    if(kind==="remove"){requireRoomCapability(room,userId,"chatParticipants");if(targetUserId&&room.ownerUserId!==userId)requireProtectedTarget(room,userId,targetUserId);return;}
    const error=chatParticipationError(room,userId,kind);if(error)throw new RoomCommandError(error);
    return{slowModeSeconds:effectiveRoomPolicy(room).slowModeSeconds??0,bypassSlowMode:isRoomStaff(room,userId)};
  },emit:(roomId,event,payload,userId)=>emitAdmittedChat(roomId,event,payload,{userId})});
const chatRelay = createChatRelay({
  commands:chatCommands,
  writePolicy: chatWritePolicy,
  getMembership,
  canWriteRoom: canWriteRoomChat,
  // The command service owns durable messages in Supabase and standalone mode.
  loadMessageById: id => authEnabled ? loadStoredChatMessage(supabaseAdmin, id) : Promise.resolve(null),
  loadReply: (roomId, messageId) => loadChatReply(supabaseAdmin, roomId, messageId),
  resolveMediaUrl: async (roomId, storagePath, userId) => (await resolveChatMediaUrl(supabaseAdmin, roomId, storagePath, userId)).url,
  emitToRoom: emitAdmittedChat
});
mountChatHistoryRoutes(app, {
  getResourcePolicy:actor=>resourcePolicies.get(actor),
  commands:chatCommands,
  writePolicy: chatWritePolicy,
  client: supabaseAdmin,
  getUserId: getApiUserId,
  canWriteRoom: canWriteRoomChat,
  onPollVote: (roomId, event, userId) => emitAdmittedChat(roomId, 'chat:poll', { roomId, poll: event }, { userId }),
  getUser: async (userId, roomId) => [...(roomUsers.get(roomId)?.values() || [])].find(user => user.id === userId) || null,
  canReadRoom: async (userId, roomSlug) => {
    if (!await platform.activeAccount(userId) || !await platform.activeRoom(roomSlug)) return false;
    const room=await store.loadRoom(roomSlug);if(!room||isRoomBanned(room,userId))return false;
    const access = await store.getRoomAccess(roomSlug, userId);
    if (!access.exists || access.banned || (!access.isPublic && !access.role)) return false;
    if (access.isPublic && !access.passwordHash) return true;
    // Protected/private history requires the same live admission as the room.
    return [...(roomUsers.get(roomSlug)?.values() || [])].some(user => user.id === userId);
  }
});
const moderation=new ModerationService(store,{
  authorizeActor:async(roomId,userId)=>{if(!await platform.activeAccount(userId)||!await platform.activeRoom(roomId))throw new RoomCommandError(serverT("room_access_is_unavailable"));},
  broadcast,isAdmitted:(roomId,userId)=>[...(roomUsers.get(roomId)?.values()??[])].some(u=>u.id===userId),
  onlineUsers:roomId=>uniqueUsers(roomUsers.get(roomId)?.values()??[]),cancelDjEviction,forgetDj:forgetDjUser,
  revokeAdmission:async(roomId,userId,reason)=>{
    cancelDjEviction(roomId,userId);
    for(const [socketId,user] of [...(roomUsers.get(roomId)??[])])if(user.id===userId){socketRooms.delete(socketId);roomUsers.get(roomId)?.delete(socketId);const socket=io.sockets.sockets.get(socketId);await socket?.leave(roomId);socket?.emit("room:removed",{roomId,error:reason});}
    if(!roomUsers.get(roomId)?.size)roomUsers.delete(roomId);
    const room=store.getRoom(roomId);if(room){await sessionScheduler.reconcilePresence(room);broadcastPresence(room);watchIdleRoom(roomId);}
  },
  removeMessage:(roomId,actorId,messageId,requestId,reason)=>chatCommands.removeMessage(roomId,actorId,messageId,requestId,reason),
  externalLog:roomId=>chatCommands.listRemovalLog(roomId),
  readArchive:async(roomId,tab,query,cursor)=>{
    if(!supabaseAdmin)return{items:[],cursor:null};
    const {data,error}=await supabaseAdmin.rpc("soundspin_read_moderation_archive",{p_room:roomId,p_kind:tab,p_query:query,p_cursor:cursor??null,p_limit:50});
    if(error)throw new Error(serverT("archived_room_evidence_is_unavailable"));
    return data as {items:Array<Record<string,unknown>>;cursor:string|null};
  },
  memberPage:supabaseAdmin ? async(roomId,query,cursor)=>{
    const {data,error}=await supabaseAdmin.rpc("soundspin_room_member_page",{p_room:roomId,p_query:query,p_cursor:cursor??null,p_limit:50});
    if(error)throw new Error(serverT("room_members_are_unavailable"));
    return data as {members:RoomMemberRecord[];cursor:string|null};
  }:undefined,
  validateMessage:async(roomId,messageId)=>{const message=await chatCommands.loadMessage(messageId);return message?.roomId===roomId?{userId:message.userId}:null;}
});
mountModerationRoutes(app,moderation,getApiUserId);
const accountDeletion=supabaseAdmin ? new AccountDeletionService(supabaseAdmin,{
  disconnectProviders:userId=>spotifyAccounts.disconnect(userId),
  eraseAccountData:userId=>store.eraseAccountRoomData(userId,room=>{cancelDjEviction(room.id,userId);forgetDjUser(room.id,userId);broadcast(room);}),
  onAccountRestricted:restrictAccount,onRoomRestricted:restrictRoom
}) : null;
mountPlatformRoutes(app,{client:supabaseAdmin,getAdminUserId:getApiAdminUserId,getUserId:getSelfServiceUserId,
  deletion:accountDeletion,onAccountRestricted:restrictAccount,onRoomRestricted:restrictRoom});

async function restrictRoom(roomId:string) {
  if(store.getRoom(roomId))blockedRooms.add(roomId);
  sessionScheduler.release(roomId);
  announcementExpiries.cancel(roomId);
  for(const userId of new Set([...(store.getRoom(roomId)?.djQueueUserIds??[]),...(roomDjUsers.get(roomId)?.keys()??[])])){
    cancelDjEviction(roomId,userId);forgetDjUser(roomId,userId);
  }
  for(const [socketId,user] of [...(roomUsers.get(roomId)??[])]) {
    const socket=io.sockets.sockets.get(socketId);
    cancelDjEviction(roomId,user.id); forgetDjUser(roomId,user.id);
    socketRooms.delete(socketId); roomUsers.get(roomId)?.delete(socketId);
    await socket?.leave(roomId); socket?.emit("room:removed",{roomId,error:serverT("this_room_is_unavailable")});
  }
  roomUsers.delete(roomId);watchIdleRoom(roomId);
}
async function restrictAccount(userId:string) {
  await cleanupRestrictedAccount(userId,{
    cachedRooms:()=>store.getCachedRooms(),
    blockAccount:actorId=>{
      platform.invalidate(actorId);
      for(const socket of io.sockets.sockets.values())if(socket.data.authUserId===actorId)socket.data.platformAllowed=false;
    },
    restrictOwnedRoom:restrictRoom,
    removeDjFromRoom:async(room,actorId)=>{
      cancelDjEviction(room.id,actorId);
      const current=store.getRoom(room.id);
      if(!current){forgetDjUser(room.id,actorId);return;}
      await roomCommands.execute(current,async draft=>{
        if(blockedRooms.has(draft.id))return{result:undefined};
        if(!await platform.activeRoom(draft.id)){await restrictRoom(draft.id);return{result:undefined};}
        const wasCurrentDj=draft.djUserId===actorId;
        removeDj(draft,actorId);
        if(wasCurrentDj)advanceRadio(draft);
        return{result:undefined};
      });
      // Keep remembered offline actors on failure so the bounded maintenance
      // pass can retry durable cleanup even after their final socket is gone.
      forgetDjUser(room.id,actorId);
      watchIdleRoom(room.id);
    },
    disconnectAccount:actorId=>{
      for(const socket of io.sockets.sockets.values())if(socket.data.authUserId===actorId)socket.disconnect(true);
    }
  });
}


function createRoom(id: string, ownerUserId: string, name?: string): Room {
  return {
    id,
    name: name || id.replaceAll("-", " "),
    ownerUserId,
    moderatorUserIds: [],
    djRoleUserIds: [],
    isPublic: true,
    passwordProtected: false,
    settings: { djAccess: "everyone" },
    djUserId: null,
    djQueueUserIds: [],
    djQueues: {},
    history: [],
    playback: { track: null, playing: false, position: 0, updatedAt: Date.now() },
    vibe: null,
    createdAt: Date.now()
  };
}

/** Build the personalized state sent to one listener. */
function snapshot(room: Room, userId: string): RoomSnapshot {
  announcementExpiries.watch(room);
  sessionScheduler.watch(room);
  return {
    room: { ...roomForListener(room, userId,uniqueUsers(roomUsers.get(room.id)?.values()??[]).map(u=>u.id)), announcement: activeAnnouncement(room.announcement) },
    // Presence is socket-based internally, but listeners are unique accounts.
    users: uniqueUsers(roomUsers.get(room.id)?.values() || []),
    djUsers: [...(roomDjUsers.get(room.id)?.values() || [])]
      .filter((user) => room.djQueueUserIds.includes(user.id)),
    serverTime: Date.now()
  };
}

function broadcastPresence(room: Room) {
  // Presence is identical for every recipient and does not carry private queues.
  // Keep it separate from room snapshots so a join/leave cannot seek every player.
  const presence=roomPresence(
    room,
    roomUsers.get(room.id)?.values() || [],
    roomDjUsers.get(room.id)?.values() || []
  );
  const onlineIds=uniqueUsers(roomUsers.get(room.id)?.values()??[]).map(u=>u.id);
  for(const [socketId,user] of roomUsers.get(room.id)??[])if(getMembership(socketId)){
    io.to(socketId).emit("room:presence",presence);
    io.to(socketId).emit("room:radio",{roomId:room.id,radio:roomForListener(room,user.id,onlineIds).radio});
  }
}

function broadcast(room: Room) {
  // Do not replace this with io.to(room.id).emit(...). Queue privacy requires a
  // separate snapshot for every recipient.
  for (const [socketId, user] of roomUsers.get(room.id) || []) {
    if(getMembership(socketId))io.to(socketId).emit("room:snapshot", snapshot(room, user.id));
  }
}

function djEvictionKey(roomId: string, userId: string) {
  return `${roomId}:${userId}`;
}

function rememberDjUser(roomId: string, user: User) {
  if (!roomDjUsers.has(roomId)) roomDjUsers.set(roomId, new Map());
  roomDjUsers.get(roomId)!.set(user.id, user);
}

function reconcileDjUser(roomId: string, user: User) {
  const room = store.getRoom(roomId);
  if (room) reconcileDjPresence(room, user, { onlineUsers: roomUsers.get(roomId)?.values() || [],
    remember: rememberDjUser, scheduleEviction: scheduleDjEviction, cancelEviction: cancelDjEviction });
}

function forgetDjUser(roomId: string, userId: string) {
  const users = roomDjUsers.get(roomId);
  users?.delete(userId);
  if (users?.size === 0) roomDjUsers.delete(roomId);
}

function cancelDjEviction(roomId: string, userId: string) {
  djEvictions.cancel(djEvictionKey(roomId, userId));
}

function hasPendingDjEviction(roomId: string, userId: string) {
  return djEvictions.has(djEvictionKey(roomId, userId));
}

function scheduleDjEviction(room: Room, user: User) {
  if (shuttingDown) return;
  if (!room.djQueueUserIds.includes(user.id)) return;
  const key = djEvictionKey(room.id, user.id);
  if (djEvictions.has(key)) return;
  rememberDjUser(room.id, user);

  djEvictions.schedule(key, () => {
    void (async () => {
      const currentRoom = store.getRoom(room.id);
      // Re-check presence at expiry. A reconnect cancels the usual timer, but
      // this guard also protects against races between socket events.
      const reconnected = [...(roomUsers.get(room.id)?.values() || [])]
        .some((roomUser) => roomUser.id === user.id);
      if (!currentRoom || reconnected || blockedRooms.has(room.id)) return;

      await roomCommands.execute(currentRoom, draft => {
        if(blockedRooms.has(room.id))return{result:undefined};
        if ([...(roomUsers.get(room.id)?.values() || [])].some(roomUser => roomUser.id === user.id)) return { result: undefined };
        const wasCurrentDj = draft.djUserId === user.id;
        removeDj(draft, user.id);
        if (wasCurrentDj) advanceRadio(draft);
        return { result: undefined, committed: () => forgetDjUser(currentRoom.id, user.id) };
      });
    })().catch(error => {
      console.error("Could not persist offline DJ removal", error);
      if (!shuttingDown && ![...(roomUsers.get(room.id)?.values() || [])].some(roomUser => roomUser.id === user.id)) scheduleDjEviction(room, user);
    });
  });
}

function getMembership(socketId: string) {
  const socket=io.sockets.sockets.get(socketId);
  if(socket?.data.platformAllowed===false)return null;
  const lease = socket?.data.credentialLease as SocketCredentialLease | undefined;
  if (lease && Date.now() >= lease.expiresAt) return null;
  const roomId = socketRooms.get(socketId);
  if (!roomId) return null;
  const room = store.getRoom(roomId);
  const user = roomUsers.get(roomId)?.get(socketId);
  return room && user && !blockedRooms.has(roomId) && !isRoomBanned(room,user.id) &&
    (accessMode(room)!=="members" || Boolean(roleInRoom(room,user.id))) ? { room, user } : null;
}

async function leaveCurrentRoom(socketId: string) {
  const roomId = socketRooms.get(socketId);
  if (!roomId) return;
  socketRooms.delete(socketId);
  const users = roomUsers.get(roomId);
  const leavingUser = users?.get(socketId);
  users?.delete(socketId);
  const room = store.getRoom(roomId);
  if (!room) return;
  // Multiple tabs count as one listener. Start the one-minute DJ grace only
  // after this account's final socket leaves; explicit `dj:leave` is immediate.
  const stillConnected = leavingUser && [...(users?.values() || [])].some((user) => user.id === leavingUser.id);
  if (leavingUser && !stillConnected) {
    scheduleDjEviction(room, leavingUser);
  }
  if (users?.size === 0) roomUsers.delete(roomId);
  const socket=io.sockets.sockets.get(socketId);await socket?.leave(roomId);
  await sessionScheduler.reconcilePresence(room);
  broadcastPresence(room);
  watchIdleRoom(roomId);
}

io.use(async (socket, next) => {
  try {
  if (!authEnabled) return next();
  const accessToken = z.string().min(1).max(16_384).safeParse(socket.handshake.auth?.accessToken);
  if (!accessToken.success) return next(new Error(serverT("authentication_required")));

  const { data, error } = await verifyCredentials(
    { token: accessToken.data, apikey: null },
    { auth: "user" }
  );
  if (error || !data.userClaims || !validUserClaims(data.jwtClaims,supabaseUrl)) return next(new Error(serverT("your_session_has_expired")));
  if(!await platform.activeAccount(data.userClaims.id))return next(new Error(serverT("account_access_is_unavailable")));
  const policy=await resourcePolicies.get(data.userClaims.id);
  const release=claimSocketAccount(securityBudget,socket,data.userClaims.id,policy.limits.socketsPerAccount);
  try {
    socket.data.credentialLease = createSocketCredentialLease(data.userClaims.id, data.jwtClaims?.exp);
  } catch { release();return next(new Error(serverT("your_session_has_expired"))); }
  socket.data.authUserId = data.userClaims.id;
  socket.data.platformAllowed=true;
  next();
  }catch(error){next(new Error(error instanceof SecurityLimitError?error.message:serverT("account_access_could_not_be_verified_try_again")));}
});

io.on("connection", (socket) => {
  const lease = socket.data.credentialLease as SocketCredentialLease | undefined;
  const assertAuthorized = () => {
    if(socket.data.platformAllowed===false)throw new RoomCommandError(serverT("account_access_is_unavailable"));
    try { lease?.assertActive(); }
    catch (error) { throw new RoomCommandError((error as Error).message); }
  };
  const cancelCredentialExpiry = lease?.scheduleExpiry(() => socket.disconnect(true));
  socket.once("disconnect", () => cancelCredentialExpiry?.());
  const onAction = (event: string, handler: Parameters<typeof safeSocketHandler>[0]) => {
    const safe = safeSocketHandler(async (payload, reply) => {
      assertAuthorized();
      if(authEnabled&&!await platform.activeAccount(socket.data.authUserId)){await restrictAccount(socket.data.authUserId);throw new RoomCommandError(serverT("account_access_is_unavailable"));}
      const member=getMembership(socket.id);
      if(member&&!await platform.activeRoom(member.room.id)){await restrictRoom(member.room.id);throw new RoomCommandError(serverT("this_room_is_unavailable"));}
      await handler(payload, reply);
    },()=>securityEvent("request_failed","failed"));
    const run = event === "room:join" ? serialSocketHandler(safe) : safe;
    socket.on(event, (payload: unknown, reply?: unknown) => {
      if (shuttingDown) return;
      const userId=socket.data.authUserId||getMembership(socket.id)?.user.id||socket.id;
      const peer=trustedSocketPeer(socket);
      const rules=[{key:`socket-actions-user:${userId}`,maximum:240,windowMs:60_000},{key:`socket-actions-peer:${peer}`,maximum:1500,windowMs:60_000}];
      if(["queue:add","queue:set-add","fallback:set"].includes(event))rules.push({key:`socket-provider:${userId}`,maximum:120,windowMs:60_000});
      const userRelease=securityBudget.acquire(`socket-action-flight:${userId}`,event==="room:join"?2:8);
      const globalRelease=securityBudget.acquire("socket-action-global",256);
      if(!userRelease||!globalRelease||!securityBudget.consume(rules)){
        userRelease?.();globalRelease?.();
        if(typeof reply==="function")reply({ok:false,error:serverT("too_many_requests_wait_a_minute_before_trying_again"),retryAfter:60});
        securityEvent("rate_limited","denied");return;
      }
      const operation = (async()=>{
        try {
          const policy=await resourcePolicies.get(userId);
          await resourceAdmission.roomAction(event,userId,socketRooms.get(socket.id),policy,()=>run(payload,reply));
        } catch(error) {
          if(typeof reply==="function")reply({ok:false,error:error instanceof SecurityLimitError?error.message:serverT("resource_limits_are_unavailable_try_again_shortly"),retryAfter:60});
        }
      })().finally(()=>{userRelease();globalRelease();});
      activeSocketActions.add(operation);
      void operation.finally(() => activeSocketActions.delete(operation));
    });
  };
  onAction("room:join", async (payload, reply) => {
    const parsed = joinSchema.safeParse(payload);
    if (!parsed.success) return reply?.({ ok: false, error: serverT("invalid_room_or_profile") });

    const { roomId, roomName, password } = parsed.data;
    let user: User = {
      ...parsed.data.user,
      id: authEnabled ? socket.data.authUserId : parsed.data.user.id
    };
    const previousRoomId = socketRooms.get(socket.id);
    if (!roomEntryLimiter.join(user.id, trustedSocketPeer(socket))) return reply?.({ ok: false, error: serverT("too_many_room_entries_wait_a_minute_before_trying_again") });
    let registration:string|undefined;

    // Auth refreshes and profile updates can cause the browser to re-emit join
    // on an already connected socket. Do not turn that harmless refresh into a
    // disconnect grace period. Keeping the existing presence until validation
    // succeeds also prevents a transient Supabase error from evicting an active
    // DJ one minute later.
    if (previousRoomId === roomId) cancelDjEviction(roomId, user.id);

    try {
      const admissionLimits=await resourcePolicies.getGlobal();
      if(!await platform.activeRoom(roomId))return reply?.({ok:false,error:serverT("room_not_found")});
      blockedRooms.delete(roomId);
      if (authEnabled) {
        const soundspinProfile = await store.loadOrCreateProfile(user.id, user.name);
        if (soundspinProfile) {
          user = {
            ...user,
            name: soundspinProfile.display_name,
            avatarKey: soundspinProfile.avatar_key,
            avatarUrl: soundspinProfile.avatar_url || undefined,
            isAppAdmin: soundspinProfile.is_app_admin
          };
        }
      }
      const access = await store.getRoomAccess(roomId, user.id);
      const admissionRoom=await store.loadRoom(roomId);
      if(admissionRoom&&isRoomBanned(admissionRoom,user.id))return reply?.({ok:false,error:serverT("you_are_banned_from_this_room")});
      if (authEnabled && !access.exists) {
        return reply?.({ ok: false, error: serverT("that_room_does_not_exist") });
      }
      if (authEnabled && !access.isPublic && !access.role) {
        return reply?.({ ok: false, error: serverT("you_no_longer_have_access_to_this_private_room") });
      }
      if (access.passwordHash && !roomEntryLimiter.password(user.id, roomId)) return reply?.({ ok: false, error: serverT("too_many_room_password_attempts_wait_five_minutes_before_trying_again"), requiresPassword: true });
      if (access.passwordHash && !await securityBudget.run("room-crypto",4,()=>passwordMatches(password, access.passwordHash!))) {
        return reply?.({
          ok: false,
          error: password ? serverT("that_room_password_is_incorrect") : serverT("this_room_needs_a_password"),
          requiresPassword: true
        });
      }

      const room = await store.loadRoom(roomId) ||
        store.getOrCreateLocalRoom(roomId, () => createRoom(roomId, user.id, roomName));
      let departure:Promise<void>|undefined;
      await store.admitRoom(room,user,access.passwordHash,()=>{
        assertAuthorized();if(!socket.connected)throw new RoomCommandError(serverT("this_room_session_has_ended"));
        const present=roomUsers.get(roomId);
        if(!present?.has(socket.id)&&(present?.size??0)>=admissionLimits.socketsPerRoom)throw new RoomCommandError(serverT("this_room_is_full_try_again_later"));
      },()=>{
        // Departure starts synchronously but is awaited outside the destination queue,
        // avoiding a cross-room deadlock when two listeners switch in opposite directions.
        if(previousRoomId&&previousRoomId!==roomId)departure=leaveCurrentRoom(socket.id);
        idleRooms.cancel(roomId);
        if(!roomUsers.has(roomId))roomUsers.set(roomId,new Map());
        roomUsers.get(roomId)!.set(socket.id,user);
        cancelDjEviction(roomId,user.id);socketRooms.set(socket.id,roomId);
        registration=crypto.randomUUID();socket.data.admissionToken=registration;
      });
      if(departure)await departure;
      for (const joinedRoom of socket.rooms) {
        if (joinedRoom !== socket.id && joinedRoom !== roomId) await socket.leave(joinedRoom);
      }

      if (!socket.connected) return;
      await socket.join(roomId);
      if(!getMembership(socket.id)||socket.data.admissionToken!==registration)throw new RoomCommandError(serverT("room_access_changed_join_again"));
      const changed = await store.changeRoom(room, draft => {
        assertAuthorized();
        if (!socket.connected || socketRooms.get(socket.id) !== roomId) throw new RoomCommandError(serverT("this_room_session_has_ended"));
        requireNotBanned(draft,user.id);
        if (!draft.ownerUserId) draft.ownerUserId = user.id;
        normalizeRadioState(draft);
        if (draft.vibe && draft.playback.track) delete draft.vibe.votes[draft.playback.track.addedBy.id];
        // Restarted lineups have no grace timers; only admitted or grace-period DJs remain.
        const online = new Set([...(roomUsers.get(roomId)?.values() || [])].map(roomUser => roomUser.id));
        draft.djQueueUserIds = draft.djQueueUserIds.filter(id => online.has(id) || hasPendingDjEviction(roomId, id));
        if (draft.djUserId && !draft.djQueueUserIds.includes(draft.djUserId)) advanceRadio(draft);
        return { result: JSON.stringify(draft) !== JSON.stringify(room), committed: () => {
          if (room.djQueueUserIds.includes(user.id)) reconcileDjUser(roomId, user);
        } };
      });
      if (!socket.connected) return;
      await sessionScheduler.reconcilePresence(room);
      const allowed=await store.allowedRoomReaders(roomId,[user.id]);
      if(!allowed.has(user.id)||!getMembership(socket.id)||socket.data.admissionToken!==registration||!await platform.activeRoom(roomId))throw new RoomCommandError(serverT("room_access_changed_join_again"));
      if (changed) {
        // Legacy normalization or stale-lineup cleanup changed shared radio state.
        broadcast(room);
      } else {
        // Only the joining socket needs the room document. Existing listeners
        // receive presence without replaying the unchanged playback checkpoint.
        io.to(socket.id).emit("room:snapshot", snapshot(room, user.id));
        broadcastPresence(room);
      }
      reply?.({ ok: true });
    } catch (error) {
      if(!(error instanceof RoomCommandError))securityEvent("request_failed","failed");
      if (registration&&socket.data.admissionToken===registration&&socketRooms.get(socket.id) === roomId) {
          await leaveCurrentRoom(socket.id);
          await socket.leave(roomId);
      }
      watchIdleRoom(roomId);
      reply?.({
        ok: false,
        error: error instanceof RoomCommandError?error.message:serverT("could_not_load_this_room")
      });
    }
  });

  mountRoomActions({
    socket, onAction, store, commands: roomCommands, getMembership, assertAuthorized,
    authorizeCurrent:async(roomId,userId)=>{
      assertAuthorized();
      if(!await platform.activeAccount(userId)||!await platform.activeRoom(roomId)||(authEnabled&&!(await store.allowedRoomReaders(roomId,[userId])).has(userId)))throw new RoomCommandError(serverT("room_access_changed_join_again"));
      assertAuthorized();
      const current=getMembership(socket.id);
      if(current?.room.id!==roomId||current.user.id!==userId)throw new RoomCommandError(serverT("this_room_session_has_ended"));
    },
    broadcast, rememberDj: reconcileDjUser, forgetDj: forgetDjUser, cancelEviction: cancelDjEviction,
    watchAnnouncement: room => announcementExpiries.watch(room), queueUndo, setImports,
    resolveTrack: async (track,room) => {const resolved=await resolveTrackMappings(track,spotifyApi,appleMusicApi,undefined,{allowSpotify:roomAllowsProvider(room.settings,"spotify")});return track.provider==="spotify"||track.provider==="apple"?resolved:{...resolved,...await verifyTrackDuration(track,{youtubeApiKey,soundCloud:soundCloudApi})};},
    resolveSavedRecording:(track,signal,room)=>(roomAllowsProvider(room.settings,"spotify")?resolveSpotifySavedRecording:resolveSavedRecording)(track,signal),
    getResourcePolicy:actor=>resourcePolicies.get(actor),
    runImport:async(actor,operation)=>resourceAdmission.importSet(actor,await resourcePolicies.get(actor),operation),
    onlineUserIds:id=>uniqueUsers(roomUsers.get(id)?.values()??[]).map(u=>u.id)
  });
  for (const kind of ["message", "reaction", "typing"] as const) {
    onAction(`chat:${kind}`, async (payload, reply) => { reply?.(await chatRelay.handle(socket.id, kind, payload)); });
  }
  socket.on("disconnect", () => { void leaveCurrentRoom(socket.id).catch(()=>securityEvent("request_failed","failed")); });
});

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});
app.get("/api/ready", async (_request, response) => {
  response.set("Cache-Control", "no-store");
  try {
    const ready = !shuttingDown && await store.isReady();
    response.status(ready ? 200 : 503).json({ ok: ready });
  } catch { response.status(503).json({ ok: false }); }
});
app.get("/api/admin/runtime", async (request, response) => {
  response.set("Cache-Control", "no-store");
  const access = await getApiAdminUserId(request);
  if (!access.ok) return response.status(access.status).json({ error: access.error });
  response.json({ coordination: "single-instance", cachedRooms: store.cachedRoomCount, cachedRoomBytes:store.cachedRoomBytes, activeRooms: roomUsers.size,
    connectedSockets: io.engine.clientsCount, storageCleanup:storageCleanupStatus, security:securityEventSnapshot(), ...runtimeMetrics.snapshot() });
});

mountAdminRoutes(app, { client: supabaseAdmin, getAdminUserId: getApiAdminUserId,
  listenerCount: slug => uniqueUsers(roomUsers.get(slug)?.values() || []).length });
app.get("/api/profiles/:userId", async (request, response) => {
  if (!(await getApiUserId(request))) {
    return response.status(401).json({ error: serverT("authentication_required") });
  }
  const userId = z.string().uuid().safeParse(request.params.userId);
  if (!userId.success) return response.status(400).json({ error: serverT("invalid_profile") });
  try {
    if(!await platform.activeAccount(userId.data))return response.status(404).json({error:serverT("profile_not_found")});
    const [profile, options] = await Promise.all([
      store.getProfile(userId.data),
      store.getProfileOptions()
    ]);
    if (!profile) return response.status(404).json({ error: serverT("profile_not_found") });
    response.json({ profile, options });
  } catch (error) {
    response.status(500).json({
      error: serverT("could_not_load_profile")
    });
  }
});

app.get("/api/rooms", async (request, response) => {
  const userId = await getApiUserId(request);
  if (!userId) return response.status(401).json({ error: serverT("authentication_required") });
  try {
    const listenerCounts = Object.fromEntries(
      [...roomUsers.entries()].map(([slug, users]) => [slug, uniqueUsers(users.values()).length])
    );
    const rooms = await store.listRooms(userId, listenerCounts);
    const q=typeof request.query.q==="string"?request.query.q.trim().toLowerCase().slice(0,100):"",tag=typeof request.query.tag==="string"?request.query.tag.trim().toLowerCase():"",language=typeof request.query.language==="string"?request.query.language.trim().toLowerCase():"";
    response.json({ rooms: rooms.filter(room=>(!q||`${room.name} ${room.description??""} ${(room.tags??[]).join(" ")}`.toLowerCase().includes(q))&&(!tag||room.tags?.some(t=>t.toLowerCase()===tag))&&(!language||room.language?.toLowerCase()===language)).map(room => withPublicRoomPreview(room, store.getRoom(room.slug))) });
  } catch (error) {
    response.status(500).json({ error: serverT("could_not_load_rooms") });
  }
});

app.post("/api/rooms", express.json(), async (request, response) => {
  const userId = await getApiUserId(request);
  if (!userId) return response.status(401).json({ error: serverT("authentication_required") });
  const parsed = roomCreateSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: parsed.error.issues[0]?.message || serverT("invalid_room") });
  }
  try {
    const {limits}=await resourcePolicies.get(userId);
    if(!securityBudget.consume([{key:`room-create:${userId}`,maximum:limits.roomCreatesPerHour,windowMs:3600_000},{key:`room-create-peer:${trustedClientIp(request)}`,maximum:Math.max(20,limits.roomCreatesPerHour*2),windowMs:3600_000}]))return response.set("Retry-After","3600").status(429).json({error:serverT("too_many_room_creation_attempts_try_again_later")});
    const room = createRoom(roomSlug(parsed.data.name), userId, parsed.data.name);
    room.settings.accessMode=parsed.data.accessMode??(parsed.data.isPublic?"public":"members");
    room.isPublic = room.settings.accessMode!=="members";
    room.passwordProtected = Boolean(parsed.data.password?.trim());
    await store.createRoom(room, await securityBudget.run("room-crypto",4,()=>hashRoomPassword(parsed.data.password)));
    watchIdleRoom(room.id);
    // A full favorites list must not turn a completed creation into a failed
    // request that the user might retry and duplicate.
    try { await store.setFavorite(room.id, userId, true); } catch { /* Room is created. */ }
    response.status(201).json({ room: { slug: room.id, name: room.name } });
  } catch (error) {
    response.status(error instanceof PublicRequestError?error.status:error instanceof SecurityLimitError?429:error instanceof RoomCommandError?400:503).json({ error: error instanceof RoomCommandError ? error.message : serverT("could_not_create_room_your_room_limit_may_have_been_reached") });
  }
});

app.put("/api/rooms/:slug/favorite", express.json(), async (request, response) => {
  const userId = await getApiUserId(request);
  if (!userId) return response.status(401).json({ error: serverT("authentication_required") });
  const slug = z.string().regex(/^[a-z0-9-]{3,48}$/).safeParse(request.params.slug);
  const parsed = favoriteSchema.safeParse(request.body);
  if (!slug.success || !parsed.success) return response.status(400).json({ error: serverT("invalid_favorite") });
  try {
    const access = await store.getRoomAccess(slug.data, userId);
    if (!access.exists || access.banned || (!access.isPublic && !access.role)) {
      return response.status(404).json({ error: serverT("room_not_found") });
    }
    await store.setFavorite(slug.data, userId, parsed.data.favorite);
    response.json({ favorite: parsed.data.favorite });
  } catch (error) {
    response.status(error instanceof PublicRequestError?error.status:400).json({ error: error instanceof RoomCommandError?error.message:serverT("could_not_update_favorite") });
  }
});

app.patch("/api/rooms/:slug", express.json(), async (request, response) => {
  const userId = await getApiUserId(request);
  if (!userId) return response.status(401).json({ error: serverT("authentication_required") });
  const slug = z.string().regex(/^[a-z0-9-]{3,48}$/).safeParse(request.params.slug);
  const parsed = roomSettingsSchema.safeParse(request.body);
  if (!slug.success || !parsed.success) {
    return response.status(400).json({ error: parsed.success ? serverT("invalid_room") : parsed.error.issues[0]?.message });
  }
  try {
    const previousDjs = [...(store.getRoom(slug.data)?.djQueueUserIds || [])];
    const access=await store.getRoomAccess(slug.data,userId);
    if(access.banned||(access.role!=="owner"&&access.role!=="moderator"))throw new RoomCommandError(serverT("only_the_owner_or_a_moderator_can_change_room_settings"));
    const {password,...settings}=parsed.data;
    const room = await store.updateRoomSettings(slug.data, userId, {
      ...settings,
      passwordHash: parsed.data.password === undefined ? undefined : await securityBudget.run("room-crypto",4,()=>hashRoomPassword(parsed.data.password)),
    },async()=>{if(!await platform.activeAccount(userId)||!await platform.activeRoom(slug.data))throw new RoomCommandError(serverT("room_access_is_unavailable"));});
    if (room) {
      for (const id of previousDjs.filter(id => !room.djQueueUserIds.includes(id))) {
        cancelDjEviction(room.id, id); forgetDjUser(room.id, id);
      }
      broadcast(room);
    }
    response.json({ room: room ? { id: room.id, name: room.name } : null });
  } catch (error) {
    response.status(error instanceof SecurityLimitError?429:error instanceof RoomCommandError?403:503).json({ error: error instanceof RoomCommandError ? error.message : serverT("could_not_update_room") });
  } finally {
    watchIdleRoom(slug.data);
  }
});

app.patch("/api/profile", express.json(), async (request, response) => {
  const userId = await getApiUserId(request);
  if (!userId) return response.status(401).json({ error: serverT("authentication_required") });
  const parsed = profileUpdateSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: parsed.error.issues[0]?.message || serverT("invalid_profile") });
  }
  try {
    const profile = await store.updateProfile(userId, parsed.data);
    response.json({ profile });
  } catch (error) {
    response.status(400).json({
      error: error instanceof RoomCommandError ? error.message : serverT("could_not_update_profile")
    });
  }
});

mountMusicRoutes(app, { authEnabled, getUserId: getApiUserId, youtubeApiKey,canUseSpotify,
  soundCloudApi, spotifyApi, spotifyAccounts, appleMusicApi, giphyApi });
mountSpotifyOAuthRoutes(app, { getUserId: getApiUserId, accounts: spotifyAccounts,canUseSpotify,
  isAccountActive:userId=>platform.activeAccount(userId),
  authorizationUrl: (redirectUri, state) => spotifyApi.authorizationUrl(redirectUri, state), redirectUri: spotifyRedirectUri });
app.get("/api/resource-policy",async(request,response)=>{
  try {
    const actor=await getApiUserId(request);
    if(!actor)return response.status(401).json({error:serverT("authentication_required")});
    response.json(await resourcePolicies.get(actor));
  }catch{response.status(503).json({error:serverT("resource_limits_are_unavailable_try_again_shortly")});}
});
app.put("/api/admin/rooms/:slug/spotify",express.json({limit:"1kb"}),async(request,response)=>{
  try {
    const admin=await getApiAdminUserId(request);
    if(!admin.ok)return response.status(admin.status).json({error:admin.error});
    const slug=z.string().regex(/^[a-z0-9-]{3,48}$/).safeParse(request.params.slug);
    const body=z.object({enabled:z.boolean()}).strict().safeParse(request.body);
    if(!slug.success||!body.success)return response.status(400).json({error:serverT("invalid_spotify_setting")});
    const room=await store.setRoomSpotifyEnabled(slug.data,admin.userId,body.data.enabled,async()=>{
      const current=await getApiAdminUserId(request);
      if(!current.ok||!await platform.activeRoom(slug.data))throw new RoomCommandError(serverT("administrator_access_required"));
    });
    broadcast(room);
    securityEvent("admin_change","success",{actorId:admin.userId,requestId:response.locals.requestId});
    response.json({enabled:room.settings.spotifyEnabled===true});
  }catch{response.status(503).json({error:serverT("could_not_change_spotify_access_try_again")});}
});
app.get("/api/config", async(request, response) => {
  let spotifyConfigured=false;
  try {const actor=await getApiUserId(request);spotifyConfigured=Boolean(actor&&spotifyAccounts.configured&&await canUseSpotify(request,actor));}catch{/* Public configuration does not expose disabled capabilities. */}
  response.json({
    giphyConfigured: giphyApi.configured,
    music: {
      spotifyConfigured,
      appleMusicConfigured: appleMusicApi.configured
    },
    supabase: authEnabled
      ? { url: supabaseUrl, anonKey: supabasePublishableKey }
      : null
  });
});

app.use("/api", (_request, response) => {
  response.status(404).json({ error: serverT("that_api_endpoint_does_not_exist") });
});

app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
  if (response.headersSent) return next(error);
  const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 500;
  if (status === 400 || status === 413) {
    return response.status(status).json({ error: status === 413 ? serverT("the_request_is_too_large") : serverT("the_request_body_is_invalid") });
  }
  securityEvent("request_failed","failed");
  response.status(500).json({ error: serverT("the_server_could_not_complete_this_request_please_try_again") });
});

if (process.env.NODE_ENV === "production") {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.resolve(dirname, "../../dist");
  app.use(express.static(publicDir));
  app.get("/{*splat}", (_request, response) => response.sendFile(path.join(publicDir, "index.html")));
}

await store.init();
globalResourceLimits=await resourcePolicies.getGlobal();
if(supabaseAdmin){
  const {data,error}=await supabaseAdmin.rpc("soundspin_release_ready");
  if(error||data!==true)throw new Error(serverT("release_security_migrations_and_grants_must_be_applied_before_starting_the_server"));
}
for(const room of await store.listSessionRooms()){
  if(await platform.activeRoom(room.id))await sessionScheduler.recover(room);
  else {blockedRooms.add(room.id);watchIdleRoom(room.id);}
}
let mediaCleanup: Promise<void> | null = null;
let storageCleanupStatus={removed:0,remaining:0,oldestAt:null as string|null,failed:0,lastRunAt:null as string|null};
let deletionWork:Promise<void>|null=null,retentionWork:Promise<void>|null=null,connectionChecks:Promise<void>|null=null;
function cleanManagedMedia() {
  if (!supabaseAdmin || mediaCleanup || shuttingDown) return;
  mediaCleanup = cleanupManagedUploads(supabaseAdmin,{maxBatches:20,batchSize:100,maxMs:20_000})
    .then(status=>{storageCleanupStatus={...status,lastRunAt:new Date().toISOString()};if(status.failed)securityEvent("storage_cleanup","failed",{count:status.failed});else if(status.removed)securityEvent("storage_cleanup","success",{count:status.removed});})
    .catch(()=>{storageCleanupStatus.failed++;securityEvent("storage_cleanup","failed");})
    .finally(() => { mediaCleanup = null; });
}
function processDeletion(){
  if(!accountDeletion||deletionWork||shuttingDown)return;
  deletionWork=accountDeletion.runNext().then(()=>undefined).catch(()=>securityEvent("account_deletion","failed")).finally(()=>{deletionWork=null;});
}
function pruneRetention(){
  if(!supabaseAdmin||retentionWork||shuttingDown)return;
  retentionWork=(async()=>{
    const deadline=Date.now()+20_000;
    for(let batch=0;batch<20&&Date.now()<deadline;batch++){
      const [records,archives,chat]=await Promise.all([supabaseAdmin.rpc("soundspin_prune_security_retention"),supabaseAdmin.rpc("soundspin_purge_security_archives",{p_limit:1000}),supabaseAdmin.rpc("soundspin_prune_chat_history",{p_limit:500})]);
      if(records.error||archives.error||chat.error)throw new Error(serverT("retention_maintenance_failed"));
      const counts=[...Object.values(records.data||{}),...Object.values(archives.data||{}),Number(chat.data?.removed??0),Number(chat.data?.updatedReplies??0),chat.data?.hasMoreRooms?1:0];
      if(counts.every(value=>Number(value)===0))break;
    }
  })().catch(()=>securityEvent("storage_cleanup","failed")).finally(()=>{retentionWork=null;});
}
function recheckConnections(){
  if(!authEnabled||connectionChecks||shuttingDown)return;
  connectionChecks=(async()=>{
    const accounts=[...new Set([
      ...[...io.sockets.sockets.values()].map(socket=>socket.data.authUserId as string).filter(Boolean),
      ...[...roomDjUsers.values()].flatMap(users=>[...users.keys()])
    ])];
    const rooms=store.getCachedRooms().map(room=>room.id);
    const tasks=[...accounts.map(userId=>async()=>{if(!await platform.activeAccount(userId))await restrictAccount(userId);}),
      ...rooms.map(roomId=>async()=>{if(!await platform.activeRoom(roomId))await restrictRoom(roomId);})];
    let index=0;
    await Promise.all(Array.from({length:Math.min(8,tasks.length)},async()=>{while(index<tasks.length&&!shuttingDown){const task=tasks[index++];try{await task();}catch{securityEvent("upstream_failure","failed");}}}));
  })().finally(()=>{connectionChecks=null;});
}
cleanManagedMedia();processDeletion();pruneRetention();
const mediaCleanupTimer = setInterval(cleanManagedMedia,60_000);
const deletionTimer=setInterval(processDeletion,60_000),retentionTimer=setInterval(pruneRetention,3600_000),connectionTimer=setInterval(recheckConnections,20_000);
const resourcePolicyTimer=setInterval(()=>{void resourcePolicies.getGlobal().then(limits=>{globalResourceLimits=limits;globalResourcePolicyAvailable=true;}).catch(()=>{globalResourcePolicyAvailable=false;securityEvent("configuration_failure","failed");});},15_000);
resourcePolicyTimer.unref();
mediaCleanupTimer.unref();
deletionTimer.unref();retentionTimer.unref();connectionTimer.unref();
httpServer.listen(port, process.env.HOST || "0.0.0.0", () => {
  const address = httpServer.address();
  console.log(`turntune listening on http://${process.env.HOST || "0.0.0.0"}:${typeof address === "object" && address ? address.port : port}`);
});

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  djEvictions.clear();
  announcementExpiries.clear();
  sessionScheduler.clear();
  clearInterval(mediaCleanupTimer);
  clearInterval(deletionTimer);clearInterval(retentionTimer);clearInterval(connectionTimer);clearInterval(resourcePolicyTimer);
  idleRooms.clear();
  const deadline = setTimeout(() => process.exit(1), 25_000);
  deadline.unref();
  try {
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await Promise.allSettled([...activeSocketActions]);
    await Promise.allSettled([mediaCleanup,deletionWork,retentionWork,connectionChecks].filter((work):work is Promise<void>=>Boolean(work)));
    await store.flush();
    clearTimeout(deadline);
  } catch (error) {
    securityEvent("request_failed","failed");
    process.exitCode = 1;
  }
}

process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });
