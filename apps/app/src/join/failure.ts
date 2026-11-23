// What a failed way in means to the person, in one short line. Every entry screen reads its failures from here, so wrong password, offline, too many tries and a Space with a problem each say the same
// thing everywhere, and no raw error text or trace reaches a sheet. The server answers a locked account the same as a wrong password on purpose (it never says which accounts exist), so the client counts
// its own misses and says "too many tries" itself after MANY_TRIES.
import { CapError } from "../shell/session/caps.ts";

export const WRONG_SIGN_IN = "That username or password is not right.";
export const WRONG_CODE = "That code is not right.";
export const TOO_MANY = "Too many tries. Wait a minute, then try again.";
export const OFFLINE_SPACE = "Vyre cannot reach this Space.";
export const SPACE_TROUBLE = "This Space had a problem. Try again in a moment.";
export const NOT_A_SPACE = "That is not a Space address.";
export const NOT_AN_INVITE = "That is not a Space name, address or link.";

// Getting in (rc.41). A Space that does not answer is named, and the screen that says so carries its fix as a button (join/GettingIn.tsx NotAnswering); before any of these lines shows,
// the ask is tried again quietly while the screen says Reconnecting.
export const RECONNECTING = "Reconnecting";
/** The heading when a Space did not answer after the quiet retries. */
export const notAnswering = (name: string): string => `${name} is not answering`;
export const NOT_ANSWERING_SUB = "Its server may be off, or you are offline";
/** A relay Space whose computer is off. */
export const asleep = (name: string): string => `${name} is asleep`;
export const ASLEEP_SUB = "Its computer is off or offline";
/** Under the address box: the name or address has no Space. The fix is the field itself. */
export const noSpaceAt = (host: string): string => `No Space at ${host}. Check the name.`;
/** Under the address box: something answers at the address, but not as a Space (another website, or a server that is not Vyre). */
export const notASpaceAt = (host: string): string => `${host} did not answer as a Space. Check the address.`;
/** Under the address box: nothing answered after the quiet retries. Continue tries again. */
export const boxNotAnswering = (host: string): string =>
  `${host} is not answering. Check the name and your connection.`;
/** How long ago a relay Space's computer was last seen, for the asleep screen: "Seen 2 hours ago". Empty when it never was. */
export function seenAgo(seenAt: number | null, now: number = Date.now()): string {
  if (seenAt === null || !Number.isFinite(seenAt) || seenAt <= 0 || seenAt > now) return "";
  const min = Math.floor((now - seenAt) / 60_000);
  if (min < 1) return "Seen just now";
  if (min < 60) return `Seen ${min} ${min === 1 ? "minute" : "minutes"} ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `Seen ${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.floor(h / 24);
  return `Seen ${d} days ago`;
}

/** After this many misses in a row the screen says so, whatever the server answered. */
export const MANY_TRIES = 5;

const unreachable = (e: unknown): boolean =>
  e instanceof TypeError ||
  (typeof DOMException !== "undefined" && e instanceof DOMException) ||
  // an answer that was not a Space's (a page of HTML from a proxy or a relay): nothing answered as the Space
  (e instanceof CapError && e.code === "gateway.bad_answer");
/** The call never got an answer (no network, no server, a blocked request): the kind of failure that is asked again quietly before anyone is told. A refusal from the Space is not one. */
export const isUnreachable = (e: unknown): boolean => unreachable(e);

/** The line for a failed sign-in. A wrong password or a locked account read the same, as the server means them to. */
export function signInLine(e: unknown): string {
  if (e instanceof CapError) {
    if (e.status === 429 || e.code.startsWith("rate_limit.")) return TOO_MANY;
    if (e.code === "auth.bad_credentials") return WRONG_SIGN_IN;
    if (e.code === "auth.invalid_code") return WRONG_CODE;
    if (e.status >= 500) return SPACE_TROUBLE;
    return e.message || SPACE_TROUBLE;
  }
  if (unreachable(e)) return OFFLINE_SPACE;
  return e instanceof Error && e.message ? e.message : SPACE_TROUBLE;
}

/** True when the failure was a wrong password, wrong code or a refused account: the kind that counts towards too many tries. */
export const isMiss = (e: unknown): boolean =>
  e instanceof CapError && (e.code === "auth.bad_credentials" || e.code === "auth.invalid_code");
