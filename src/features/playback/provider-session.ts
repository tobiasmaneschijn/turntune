export type PersonalProvider = "spotify" | "apple";
type Reset = () => void | Promise<unknown>;
let accountId: string | null = null;
const handlers: Record<PersonalProvider, Set<Reset>> = { spotify: new Set(), apple: new Set() };
const revisions: Record<PersonalProvider, number> = { spotify: 0, apple: 0 };

export const providerAccount = () => accountId;
export const providerSessionRevision = (provider: PersonalProvider) => revisions[provider];
export function onProviderSessionReset(provider: PersonalProvider, reset: Reset): () => void {
  handlers[provider].add(reset);
  return () => { handlers[provider].delete(reset); };
}
/** Invalidate callbacks synchronously; teardown can finish asynchronously. */
export function resetProviderSession(provider: PersonalProvider): Promise<void> {
  revisions[provider]++;
  const tasks: Promise<unknown>[] = [];
  for (const reset of handlers[provider]) {
    try { tasks.push(Promise.resolve(reset())); } catch (error) { tasks.push(Promise.reject(error)); }
  }
  return Promise.allSettled(tasks).then(() => undefined);
}
/** Token refresh and same-account navigation preserve the personal SDK session. */
export function setProviderAccount(next: string | null): void {
  if (accountId === next) return;
  accountId = next;
  void resetProviderSession("spotify");
  void resetProviderSession("apple");
}
