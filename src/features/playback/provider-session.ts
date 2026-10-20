import { MUSIC_PROVIDERS, PROVIDER_DEFINITIONS } from "../../../shared/provider-definitions";

type Provider = typeof MUSIC_PROVIDERS[number];
export type PersonalProvider = {
  [P in Provider]: typeof PROVIDER_DEFINITIONS[P]["personalSession"] extends true ? P : never;
}[Provider];
type Reset = () => void | Promise<unknown>;
let accountId: string | null = null;
const personalProviders = MUSIC_PROVIDERS.filter((provider): provider is PersonalProvider =>
  PROVIDER_DEFINITIONS[provider].personalSession);
const sessions = new Map(personalProviders.map(provider => [provider, { revision: 0, handlers: new Set<Reset>() }]));

function sessionFor(provider: PersonalProvider) {
  const session = sessions.get(provider);
  if (!session) throw new Error(`Provider ${provider} has no personal session.`);
  return session;
}

export const providerAccount = () => accountId;
export const providerSessionRevision = (provider: PersonalProvider) => sessionFor(provider).revision;
export function onProviderSessionReset(provider: PersonalProvider, reset: Reset): () => void {
  const { handlers } = sessionFor(provider);
  handlers.add(reset);
  return () => { handlers.delete(reset); };
}
/** Invalidate callbacks synchronously; teardown can finish asynchronously. */
export function resetProviderSession(provider: PersonalProvider): Promise<void> {
  const session = sessionFor(provider);
  session.revision++;
  const tasks: Promise<unknown>[] = [];
  for (const reset of session.handlers) {
    try { tasks.push(Promise.resolve(reset())); } catch (error) { tasks.push(Promise.reject(error)); }
  }
  return Promise.allSettled(tasks).then(() => undefined);
}
/** Token refresh and same-account navigation preserve the personal SDK session. */
export function setProviderAccount(next: string | null): void {
  if (accountId === next) return;
  accountId = next;
  for (const provider of personalProviders) void resetProviderSession(provider);
}
