import type { RequestHandler } from "express";
import { RoomCommandError } from "./socket-handler.js";

interface ConnectionLeaseTarget {
  conn:{readyState:string;once(event:"close",listener:()=>void):unknown};
  once(event:"disconnect",listener:()=>void):unknown;
}
/** An Engine.IO close can precede namespace acceptance, when disconnect never
 * fires. Both lifecycle signals release the same idempotent account lease. */
export function claimSocketAccount(budget:SecurityBudget,socket:ConnectionLeaseTarget,userId:string):()=>void {
  if(socket.conn.readyState!=="open")throw new RoomCommandError("This connection has ended.");
  const release=budget.acquire(`socket-user:${userId}`,5);
  if(!release)throw new SecurityLimitError();
  socket.conn.once("close",release);socket.once("disconnect",release);
  if(socket.conn.readyState!=="open"){release();throw new RoomCommandError("This connection has ended.");}
  return release;
}

export class SecurityLimitError extends RoomCommandError {
  readonly retryAfterSeconds = 60;
  constructor() { super("Too many requests. Wait a minute before trying again."); }
}

interface BudgetRule { key: string; maximum: number; windowMs: number; cost?: number }
interface Window { count: number; expiresAt: number }

/** Process-local by design: production requires one active coordinator. */
export class SecurityBudget {
  private windows = new Map<string, Window>();
  private running = new Map<string, number>();
  private nextPrune = 0;
  constructor(private readonly now = Date.now, private readonly maximumKeys = 20_000) {}

  consume(rules: BudgetRule[]): boolean {
    const now = this.now();
    if (now >= this.nextPrune || this.windows.size >= this.maximumKeys) {
      for (const [key, value] of this.windows) if (value.expiresAt <= now) this.windows.delete(key);
      this.nextPrune = now + 60_000;
    }
    const changes = rules.map(rule => {
      const old = this.windows.get(rule.key);
      const value = old && old.expiresAt > now ? old : { count: 0, expiresAt: now + rule.windowMs };
      return { rule, value: { count: value.count + (rule.cost ?? 1), expiresAt: value.expiresAt } };
    });
    if (changes.some(({rule,value}) => !Number.isFinite(rule.maximum) || value.count > rule.maximum)) return false;
    const newKeys = new Set(changes.filter(({rule}) => !this.windows.has(rule.key)).map(({rule}) => rule.key));
    if (this.windows.size + newKeys.size > this.maximumKeys) return false;
    for (const {rule,value} of changes) this.windows.set(rule.key,value);
    return true;
  }

  acquire(key: string, maximum: number): (() => void) | null {
    const count = this.running.get(key) ?? 0;
    if (count >= maximum || (!count && this.running.size >= this.maximumKeys)) return null;
    this.running.set(key,count+1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.running.get(key) ?? 1)-1;
      if (remaining) this.running.set(key,remaining); else this.running.delete(key);
    };
  }

  run<T>(key: string, maximum: number, operation: () => Promise<T>): Promise<T> {
    const release = this.acquire(key,maximum);
    if (!release) return Promise.reject(new SecurityLimitError());
    return Promise.resolve().then(operation).finally(release);
  }
}

export function peerRequestBudget(budget: SecurityBudget, peer: (request: Parameters<RequestHandler>[0]) => string): RequestHandler {
  return (request,response,next) => {
    const identity = peer(request);
    const ready = request.path === "/ready";
    const rules = [{key:`http-peer:${identity}`,maximum:600,windowMs:60_000}];
    if (ready) rules.push({key:`http-ready-peer:${identity}`,maximum:60,windowMs:60_000});
    if (!budget.consume(rules)) {
      response.set("Retry-After","60").status(429).json({error:"Too many requests. Wait a minute before trying again."}); return;
    }
    const release = budget.acquire(`http-peer-flight:${identity}`,24);
    if (!release) { response.set("Retry-After","60").status(429).json({error:"Too many concurrent requests."}); return; }
    response.once("finish",release); response.once("close",release);
    next();
  };
}
