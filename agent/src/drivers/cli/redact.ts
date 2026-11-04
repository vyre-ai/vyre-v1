// Secrets a CLI engine's process holds for a while that must never come back out of it (lane l-ci-runners): the GitHub token the broker hands a session. A process can print its environment, a tool can echo a header, a
// failing git can name a URL; whatever the process writes to stdout or stderr passes through here before it is decoded into a text, a tool detail, an error, a step line or a log. The values are held in memory only,
// until the token's own expiry, and only values of 16 characters or more are kept (a short string would blot out ordinary words).
const held = new Map<string, number>();
const MIN = 16;

/** Hold a secret until `untilMs`. Safe to call again with the same value. */
export function holdSecret(value: string, untilMs: number): void {
  if (value.length < MIN) return;
  held.set(value, untilMs);
}

function live(now: number): string[] {
  for (const [k, until] of held) if (until <= now) held.delete(k);
  return [...held.keys()].sort((a, b) => b.length - a.length);
}

/** The text with every held secret replaced by [token], whole. Not truncated. */
export function redact(text: string, now: number = Date.now()): string {
  let out = text;
  for (const s of live(now)) if (out.includes(s)) out = out.split(s).join("[token]");
  return out;
}

/** The secrets held right now. */
export function heldSecrets(now: number = Date.now()): string[] { return live(now); }

/** For tests: forget everything. */
export function forgetSecrets(): void { held.clear(); }
