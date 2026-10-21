import type express from "express";
import { serverT } from "../lib/i18n.js";
import { SecurityLimitError, type SecurityBudget } from "./security-budget.js";
import type { ResourceAdmission } from "../resources/resource-admission.js";
import type { ResourcePolicyStore } from "../resources/resource-policy.js";
import type { PlatformSecurity } from "./platform-security.js";
import { localRateLimitsDisabled } from "./local-development.js";

export interface ApiAccessOptions {
  getApiUserId: (request: express.Request) => Promise<string | null>;
  getSelfServiceUserId: (request: express.Request) => Promise<string | null>;
  platform: Pick<PlatformSecurity, "activeRoom">;
  blockedRooms: Set<string>;
  securityBudget: SecurityBudget;
  resourceAdmission: ResourceAdmission;
  resourcePolicies: Pick<ResourcePolicyStore, "get">;
}

export function mountApiAccess(app: express.Express, options: ApiAccessOptions) {
  const { getApiUserId, getSelfServiceUserId, platform, blockedRooms, securityBudget, resourceAdmission, resourcePolicies } = options;
  // Verify private requests before accepting/parsing uploads or other request bodies.
  app.use("/api",async(request,response,next)=>{
    // Navigation can close the response while an access check is pending. Never
    // claim capacity or start a handler after its release event has already fired.
    const responseClosed=()=>response.destroyed||response.writableEnded;
    try {
      const publicPath=["/health","/ready","/config","/signup","/spotify/callback"].includes(request.path);
      if(publicPath)return next();
      const selfService=request.path==="/account/deletion-request" || request.path.startsWith("/account/export/");
      const actor=await(selfService?getSelfServiceUserId(request):getApiUserId(request));
      if(responseClosed())return;
      if(!actor)return void response.status(401).json({error:serverT("authentication_required")});
      const roomSlug=request.path.match(/^\/rooms\/([a-z0-9-]{3,48})(?:\/|$)/)?.[1];
      if(roomSlug) {
        const active=await platform.activeRoom(roomSlug);
        if(responseClosed())return;
        if(!active)return void response.status(404).json({error:serverT("room_not_found")});
      }
      if(roomSlug)blockedRooms.delete(roomSlug);
      if(!localRateLimitsDisabled()) {
        if(!securityBudget.consume([{key:`http-user:${actor}`,maximum:300,windowMs:60_000}]))return void response.set("Retry-After","60").status(429).json({error:serverT("too_many_requests_wait_a_minute_before_trying_again")});
        const release=securityBudget.acquire(`http-user-flight:${actor}`,12);
        if(!release)return void response.set("Retry-After","60").status(429).json({error:serverT("too_many_concurrent_requests")});
        response.once("finish",release);response.once("close",release);
      }
      const roomWrite=roomSlug&&!["GET","HEAD"].includes(request.method)&&!request.path.includes("/chat/")&&!request.path.endsWith("/favorite");
      if(roomWrite) {
        const policy=await resourcePolicies.get(actor);
        if(responseClosed())return;
        await resourceAdmission.roomAction("http:room-write",actor,roomSlug,policy,()=>new Promise<void>(resolve=>{
          if(responseClosed())return resolve();
          response.once("finish",resolve);response.once("close",resolve);next();
        }));
      } else next();
    }catch(error){if(!responseClosed()&&!response.headersSent)response.status(error instanceof SecurityLimitError?429:503).json({error:error instanceof SecurityLimitError?error.message:serverT("account_access_could_not_be_verified_try_again")});}
  });
}
