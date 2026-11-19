// Signing out revokes the sign-in on the Space. The shell's own call needs the opened session; a person who presses Sign Out in the first moments of a page (the shell is drawn before the session has
// opened: the shell's code is warmed ahead) has none yet, and the old call was then skipped, leaving the token alive on the server. This sends the same call with the stored token, through the same caller the
// session uses (so it goes out as the desktop app's own calls do, from tauri://localhost too).
// A revoke is never only a promise: it is written down (sealed: revoke-queue.ts) as it is sent and struck out when the Space has answered, so a page that is left or reloaded in the middle of it, a Space that cannot be
// reached, or an origin the Space refuses leaves it queued, and the next start sends it again (retryPendingRevokes). It goes the moment it succeeds or the Space says the token is already invalid (401), and never
// stays a day.
import { CapError, createCapCaller } from "./caps.ts";
import type { CapCall } from "./caps.ts";
import { browserBacking, createRevokeQueue } from "./revoke-queue.ts";
import type { RevokeQueue } from "./revoke-queue.ts";

type Maker = (s: { baseUrl: string; token: string }) => CapCall;
const make: Maker = (s) => createCapCaller({ baseUrl: s.baseUrl, token: () => s.token });
let shared: RevokeQueue | null = null;
const queueOf = (): RevokeQueue => (shared ??= createRevokeQueue(browserBacking()));

/** Has the Space dealt with this token? A reply that says the token is no good (401) means it is already revoked. */
async function sent(call: CapCall): Promise<boolean> {
  try {
    await call("identity.sign_out", {});
    return true;
  } catch (e) {
    return e instanceof CapError && e.status === 401;
  }
}

export async function revokeToken(
  s: { baseUrl: string; token: string },
  o: { make?: Maker; queue?: RevokeQueue; now?: () => number } = {},
): Promise<void> {
  const queue = o.queue ?? queueOf();
  // written down as it is sent, not after: a reload in the middle of the call leaves it to the next start
  const written = queue.add({ ...s, at: (o.now ?? Date.now)() });
  const done = await sent((o.make ?? make)(s));
  await written.catch(() => undefined);
  if (done) await queue.remove(s).catch(() => undefined);
}

/** At start: send again every revoke that did not get its answer. */
export async function retryPendingRevokes(o: { make?: Maker; queue?: RevokeQueue } = {}): Promise<void> {
  const queue = o.queue ?? queueOf();
  for (const p of await queue.list()) if (await sent((o.make ?? make)(p))) await queue.remove(p).catch(() => undefined);
}
