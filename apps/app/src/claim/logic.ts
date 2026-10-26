// The owner-claim screen's rules with no rendering (ruling 71): what the details need before Continue, the claim link in the address, and how a refused claim reads to the person.
import { cleanUsername, meter, strength, usernameOk } from "../join/logic.ts";

export { cleanUsername, meter, strength, usernameOk };

export interface Details { name: string; username: string; password: string; confirm: string }

export const PASSWORD_MIN = 8;

export type Problem = "name" | "username" | "password" | "mismatch";

/** The first thing wrong with the details, or null when Continue may be pressed. */
export function problemOf(d: Details): Problem | null {
  if (!d.name.trim()) return "name";
  if (!usernameOk(d.username)) return "username";
  if (d.password.length < PASSWORD_MIN) return "password";
  if (d.confirm !== d.password) return "mismatch";
  return null;
}

/** The claim token in an address like /claim/<token>, or null for any other path. */
export function claimToken(pathname: string): string | null {
  const m = /^\/claim\/([A-Za-z0-9_-]{8,200})\/?$/.exec(pathname);
  return m?.[1] ?? null;
}

export type ClaimFailure = "used" | "expired" | "invalid" | "taken" | "weak" | "unreachable" | "other";

/** What a refused or failed claim means. A spent or expired link has no form, so the code decides which screen shows. */
export function failureOf(code: string | null, network: boolean): ClaimFailure {
  if (network) return "unreachable";
  const c = (code ?? "").toLowerCase();
  if (c.includes("expired")) return "expired";
  if (c.includes("invalid_code") || c.includes("used") || c.includes("spent") || c.includes("claimed") || c.includes("consumed")) return "used";
  if (c.includes("taken") || c.includes("duplicate") || c.includes("exists") || c.includes("conflict")) return "taken";
  if (c.includes("weak") || c.includes("password")) return "weak";
  return "other";
}

export const FAILURE_LINE: Readonly<Record<ClaimFailure, string>> = {
  used: "This link was already used.",
  invalid: "This link is not valid.",
  expired: "This link has expired.",
  taken: "That username is taken. Choose another.",
  weak: "Choose a stronger password.",
  unreachable: "Couldn't reach the Space. Check the connection and try again.",
  other: "Couldn't set up the Space. Try again.",
};

/** Failures that end the flow: the link cannot be used again, so no form is shown. */
export const isDeadLink = (f: ClaimFailure): boolean => f === "used" || f === "expired" || f === "invalid";

/** The Space fingerprint in the claim link (`#fp=<hex>`), grouped in fours for comparing against what the owner was shown, or null. */
export function fingerprintOf(hash: string): string | null {
  const m = /(?:^|[#&])fp=([0-9a-fA-F]{8,128})(?:&|$)/.exec(hash);
  return m?.[1] ? (m[1].toLowerCase().match(/.{1,4}/g) ?? []).join(" ") : null;
}

/** The Space id in the claim link (`#fp=<hex>&s=<spaceId>`), which the client needs to make the Space key, or null. */
export function spaceIdOf(hash: string): string | null {
  const m = /(?:^|[#&])s=([A-Za-z0-9_-]{3,64})(?:&|$)/.exec(hash);
  return m?.[1] ?? null;
}
