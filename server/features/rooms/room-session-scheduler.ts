import type { Room } from "../../types.js";
import { advanceRadio } from "./radio.js";
import { radioState, roomSession } from "./radio-policy.js";
import type { RoomCommandService } from "./room-command-service.js";

/** Reconciles durable clock checkpoints. Every callback rechecks the queued draft. */
export class RoomSessionScheduler {
  private rooms=new Map<string,Room>();
  private signatures=new Map<string,string>();
  private timer?:NodeJS.Timeout;
  private busy=new Set<string>();
  constructor(private readonly commands:RoomCommandService,private readonly broadcast:(room:Room)=>void,private readonly onlineCount:(roomId:string)=>number,private readonly now=Date.now){}
  private signature(room:Room,now:number){return JSON.stringify([roomSession(room,now),(room.settings.sessionOverrides??[]).filter(s=>s.expiresAt>now).map(s=>s.id),room.moderation?.restrictions.filter(r=>r.revokedAt===null&&(r.expiresAt===null||r.expiresAt>now)).map(r=>r.id)]);}
  watch(room:Room){this.rooms.set(room.id,room);this.signatures.set(room.id,this.signature(room,this.now()));if(!this.timer){this.timer=setInterval(()=>this.tick(),1000);this.timer.unref();}}
  release(roomId:string){this.rooms.delete(roomId);this.signatures.delete(roomId);}
  clear(){if(this.timer)clearInterval(this.timer);this.timer=undefined;this.rooms.clear();}
  async recover(room:Room){
    this.watch(room);
    const playback=room.playback,track=playback.track;
    if(track&&playback.origin==="fallback"&&playback.playing&&track.durationVerified&&track.durationMs&&playback.position+(this.now()-playback.updatedAt)/1000>=track.durationMs/1000){
      await this.commands.execute(room,draft=>{if(draft.playback.track?.id===track.id&&draft.playback.revision===playback.revision)advanceRadio(draft,this.now());return{result:undefined};});
    }
    await this.reconcilePresence(room);
  }
  async reconcilePresence(room:Room){
    const state=radioState(room);if(room.playback.origin!=="fallback"||!room.playback.track)return;
    const shouldPause=this.onlineCount(room.id)===0;
    if(shouldPause&&!room.playback.playing||!shouldPause&&!state.fallback.autoPaused)return;
    await this.commands.execute(room,draft=>{
      const state=radioState(draft),pause=this.onlineCount(draft.id)===0;
      if(draft.playback.origin!=="fallback"||!draft.playback.track||state.stopped)return{result:undefined};
      if(pause&&draft.playback.playing){draft.playback.position+=(this.now()-draft.playback.updatedAt)/1000;draft.playback.playing=false;draft.playback.updatedAt=this.now();state.fallback.autoPaused=true;}
      else if(!pause&&state.fallback.autoPaused){draft.playback.playing=true;draft.playback.updatedAt=this.now();state.fallback.autoPaused=false;}
      return{result:undefined};
    });
  }
  private tick(){for(const room of this.rooms.values()){
    const now=this.now(),signature=this.signature(room,now);
    if(this.signatures.get(room.id)!==signature){this.signatures.set(room.id,signature);this.broadcast(room);}
    const playback=room.playback,track=playback.track;
    if(this.busy.has(room.id)||!track||playback.origin!=="fallback"||!playback.playing||!track.durationVerified||!track.durationMs)continue;
    if(playback.position+(now-playback.updatedAt)/1000<track.durationMs/1000)continue;
    this.busy.add(room.id);
    void this.commands.execute(room,draft=>{
      if(draft.playback.track?.id===track.id&&draft.playback.revision===playback.revision&&draft.playback.playing){const current=draft.playback.track;if(current.durationVerified&&current.durationMs&&draft.playback.position+(this.now()-draft.playback.updatedAt)/1000>=current.durationMs/1000)advanceRadio(draft,this.now());}
      return{result:undefined};
    }).then(()=>this.reconcilePresence(room)).catch(error=>console.error("Could not advance room fallback",error)).finally(()=>this.busy.delete(room.id));
  }}
}
