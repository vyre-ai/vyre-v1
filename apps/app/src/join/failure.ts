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
export const NOT_AN_INVITE = "That is not an invite link or a Space address.";

/** After this many misses in a row the screen says so, whatever the server answered. */
export const MANY_TRIES = 5;

const unreachable = (e: unknown): boolean => e instanceof TypeError || (typeof DOMException !== "undefined" && e instanceof DOMException);

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
export const isMiss = (e: unknown): boolean => e instanceof CapError && (e.code === "auth.bad_credentials" || e.code === "auth.invalid_code");
