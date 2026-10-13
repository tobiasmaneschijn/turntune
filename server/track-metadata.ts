import { providerJson, providerSignal } from "./provider-http.js";
import type { TrackInput } from "./provider-mappings.js";
import type { Track } from "./types.js";
import type { SoundCloudApi } from "./soundcloud.js";
import { MixcloudApi } from "./mixcloud.js";

export function parseIsoDuration(value:string):number|undefined {
  const match=/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value);
  if(!match)return;
  const ms=(Number(match[1]??0)*86400+Number(match[2]??0)*3600+Number(match[3]??0)*60+Number(match[4]??0))*1000;
  return ms>0&&ms<=86_400_000?ms:undefined;
}
/** Only exact source lookups establish duration provenance, never a client hint. */
export async function verifyTrackDuration(input:TrackInput,options:{youtubeApiKey?:string;soundCloud:SoundCloudApi;fetcher?:typeof fetch;signal?:AbortSignal}):Promise<Pick<Track,"durationVerified"|"isLive">&Partial<Pick<Track,"durationMs">>> {
  const fetcher=options.fetcher??fetch;
  options.signal?.throwIfAborted();
  const signal = providerSignal(options.signal, 4_000);
  try {
    if(input.provider==="youtube"&&options.youtubeApiKey){
      if(!/^[A-Za-z0-9_-]{11}$/.test(input.providerId))return{durationVerified:false};
      const params=new URLSearchParams({part:"contentDetails,liveStreamingDetails",id:input.providerId,key:options.youtubeApiKey});
      const {response,payload:data}=await providerJson<{items?:Array<{id:string;contentDetails?:{duration?:string};liveStreamingDetails?:{actualEndTime?:string}}>}> ("youtube",fetcher,`https://www.googleapis.com/youtube/v3/videos?${params}`,{signal},{timeoutMs:4000});
      if(!response.ok)return{durationVerified:false};
      const video=data.items?.find(item=>item.id===input.providerId);if(!video)return{durationVerified:false};
      const isLive=Boolean(video.liveStreamingDetails&&!video.liveStreamingDetails.actualEndTime);
      const durationMs=parseIsoDuration(video.contentDetails?.duration??"");return{durationMs,durationVerified:Boolean(durationMs&&!isLive),isLive};
    }
    if(input.provider==="mixcloud"){
      const source=await new MixcloudApi(fetcher).resolveTrack(input.permalinkUrl??input.providerId,signal);
      if(source.id===input.providerId)return{durationMs:source.durationMs,durationVerified:true,isLive:false};
    }
    if(input.provider==="soundcloud"&&options.soundCloud.configured&&input.permalinkUrl){
      const url=new URL(input.permalinkUrl);if(url.protocol!=="https:"||url.username||url.password||!(url.hostname==="soundcloud.com"||url.hostname.endsWith(".soundcloud.com")))return{durationVerified:false};
      const source=await options.soundCloud.resolveTrack(url.href,signal);
      if(source.id===input.providerId&&source.durationMs&&source.durationMs>0)return{durationMs:source.durationMs,durationVerified:true,isLive:false};
    }
  } catch { options.signal?.throwIfAborted(); /* Unknown metadata stays ineligible when a length limit is enabled. */ }
  return{durationVerified:false};
}
