// Signing out revokes the sign-in on the Space. The shell's own call needs the opened session; a person who presses Sign Out in the first moments of a page (the shell is drawn before the session has
// opened: the shell's code is warmed ahead) has none yet, and the old call was then skipped, leaving the token alive on the server. This sends the same call with the stored token, through the same caller the
// session uses (so it goes out as the desktop app's own calls do, from tauri://localhost too).
// A revoke is never only a promise: it is written down first and struck out when the Space has answered, so a page that is left or reloaded in the middle of it, a Space that cannot be reached, or an origin the Space
// refuses leaves it queued, and the next start sends it again (retryPendingRevokes). A token the Space says is already invalid (401) is revoked as far as anyone can tell, and is struck out.
import { CapError, createCapCaller } from "./caps.ts";
import type { CapCall } from "./caps.ts";

const KEY = "vyre.signout.pending.v1";
const MAX_KEPT = 8;
const MAX_AGE_MS = 7 * 24 * 3_600_000;

interface Pending {
  baseUrl: string;
  token: string;
  at: number;
}
type Store = Pick<Storage, "getItem" | "setItem">;
type Maker = (s: { baseUrl: string; token: string }) => CapCall;

const store = (): Store | undefined => {
  try {
    return (globalThis as { localStorage?: Store }).localStorage;
  } catch {
    return undefined;
  }
};
const make: Maker = (s) => createCapCaller({ baseUrl: s.baseUrl, token: () => s.token });

function read(ls: Store | undefined, now: number): Pending[] {
  try {
    const j: unknown = JSON.parse(ls?.getItem(KEY) ?? "[]");
    return Array.isArray(j)
      ? (j as Pending[]).filter(
          (p) => typeof p?.baseUrl === "string" && typeof p.token === "string" && now - p.at < MAX_AGE_MS,
        )
      : [];
  } catch {
    return [];
  }
}
function write(ls: Store | undefined, list: Pending[]): void {
  try {
    ls?.setItem(KEY, JSON.stringify(list.slice(-MAX_KEPT)));
  } catch {
    /* blocked storage: the revoke is still sent, only not remembered */
  }
}

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
  o: { make?: Maker; ls?: Store | undefined; now?: () => number } = {},
): Promise<void> {
  const ls = "ls" in o ? o.ls : store();
  const now = (o.now ?? Date.now)();
  // written down before it is sent: a reload in the middle of the call leaves it to the next start
  write(ls, [...read(ls, now).filter((p) => !(p.baseUrl === s.baseUrl && p.token === s.token)), { ...s, at: now }]);
  if (await sent((o.make ?? make)(s)))
    write(
      ls,
      read(ls, now).filter((p) => !(p.baseUrl === s.baseUrl && p.token === s.token)),
    );
}

/** At start: send again every revoke that did not get its answer. */
export async function retryPendingRevokes(
  o: { make?: Maker; ls?: Store | undefined; now?: () => number } = {},
): Promise<void> {
  const ls = "ls" in o ? o.ls : store();
  const now = (o.now ?? Date.now)();
  for (const p of read(ls, now)) {
    if (await sent((o.make ?? make)(p)))
      write(
        ls,
        read(ls, now).filter((q) => !(q.baseUrl === p.baseUrl && q.token === p.token)),
      );
  }
}
