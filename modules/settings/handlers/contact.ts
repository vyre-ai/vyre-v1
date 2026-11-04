// Verifying the profile email and phone (lane l-chrome2a). Verify sends a 6-digit code to the address or number, through the Space's mail sender or its telephony, and the person types it back. The tick
// is the Gate's of this module alone: a row saying which value was confirmed, shown only while the contact still holds it. Codes are kept as a hash, last 10 minutes and allow 5 tries; at most 3 are sent
// an hour and one every 30 seconds. With no usable sender for a channel it reads "Not verified" and offers no Verify. Audit rows say who, which channel and when, never the code or the value.
import { defOf, effective, me, raise } from "../projections.ts";
import type { SettingsCtx } from "../projections.ts";

type Channel = "email" | "phone";
const CHANNELS: readonly Channel[] = ["email", "phone"];
export const CODE_MINUTES = 10;
const SENDS_PER_HOUR = 3;
const GAP_MS = 30_000;
const TRIES = 5;

const norm = (channel: Channel, v: unknown): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return channel === "email" ? s.toLowerCase() : s.replace(/[\s().-]/g, "");
};
const contactOf = (ctx: SettingsCtx, person: string): Record<Channel, string> => {
  const v = (effective(ctx, defOf(ctx, "profile.contact"), person).value ?? {}) as { email?: unknown; phone?: unknown };
  return { email: norm("email", v.email), phone: norm("phone", v.phone) };
};

async function digest(text: string): Promise<string> {
  const d = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
const newCode = (): string => {
  const n = new Uint32Array(1);
  globalThis.crypto.getRandomValues(n);
  return String(n[0]! % 1_000_000).padStart(6, "0");
};
const hashOf = (person: string, channel: Channel, value: string, code: string): Promise<string> => digest(`${person}|${channel}|${value}|${code}`);

interface Sender { id: string; usable: boolean; scope: string; provider: string }
/** The sender the code goes from: a usable one of the channel, the Space's own sending domain or number first. Null when there is none. */
async function senderFor(ctx: SettingsCtx, channel: Channel): Promise<Sender | null> {
  try {
    const r = (await ctx.call("comms.senders.list", { channel: channel === "email" ? "email" : "text" })) as { senders?: Sender[] };
    const usable = (r.senders ?? []).filter((s) => s.usable);
    return usable.find((s) => s.scope === "space") ?? usable[0] ?? null;
  } catch { return null; }
}

const verifiedValue = (ctx: SettingsCtx, person: string, channel: Channel): string | undefined =>
  (ctx.db.all("SELECT value FROM settings_contact_verified WHERE person = ? AND channel = ?", person, channel)[0] as { value: string } | undefined)?.value;

/** A value that changed takes its tick, and its waiting code, with it. Called wherever the contact can change. */
export function clearStale(ctx: SettingsCtx, person: string): void {
  const now = contactOf(ctx, person);
  for (const channel of CHANNELS) {
    const was = verifiedValue(ctx, person, channel);
    if (was !== undefined && was !== now[channel]) {
      ctx.db.run("DELETE FROM settings_contact_verified WHERE person = ? AND channel = ?", person, channel);
      ctx.emit("settings.contact_unverified", `person/${person}`, { person, channel, why: "changed" });
    }
    const waiting = ctx.db.all("SELECT value FROM settings_contact_code WHERE person = ? AND channel = ?", person, channel)[0] as { value: string } | undefined;
    if (waiting && waiting.value !== now[channel]) ctx.db.run("DELETE FROM settings_contact_code WHERE person = ? AND channel = ?", person, channel);
  }
}

export async function contactStatus(ctx: SettingsCtx, _input: Record<string, never>) {
  const person = me(ctx);
  const now = contactOf(ctx, person);
  const out: Record<string, unknown> = {};
  for (const channel of CHANNELS) {
    const value = now[channel];
    const verified = value !== "" && verifiedValue(ctx, person, channel) === value;
    const pending = ctx.db.all("SELECT expires_at FROM settings_contact_code WHERE person = ? AND channel = ? AND value = ?", person, channel, value)[0] as { expires_at: number } | undefined;
    out[channel] = { verified, canVerify: value !== "" && !verified && (await senderFor(ctx, channel)) !== null, pending: pending !== undefined && pending.expires_at > ctx.now() };
  }
  return out;
}

export async function contactVerifyStart(ctx: SettingsCtx, input: { channel: Channel }) {
  const person = me(ctx);
  const channel = input.channel;
  const value = contactOf(ctx, person)[channel];
  if (value === "") raise(ctx, "validation.precondition_failed", channel === "email" ? "Add your email first." : "Add your phone number first.");
  if (verifiedValue(ctx, person, channel) === value) return { sent: false, verified: true, expiresAt: 0 };
  const now = ctx.now();
  const recent = ctx.db.all("SELECT at FROM settings_contact_sent WHERE person = ? AND channel = ? AND at > ?", person, channel, now - 3_600_000) as { at: number }[];
  if (recent.length >= SENDS_PER_HOUR) raise(ctx, "rate_limit.exceeded", "Too many codes this hour. Try again later.");
  if (recent.some((r) => now - r.at < GAP_MS)) raise(ctx, "rate_limit.exceeded", "A code was just sent. Wait a moment before asking for another.");
  const sender = await senderFor(ctx, channel);
  if (!sender) raise(ctx, "validation.precondition_failed", channel === "email" ? "This Space has no way to send email yet." : "This Space has no phone line to text from.");
  const code = newCode();
  const expiresAt = now + CODE_MINUTES * 60_000;
  ctx.db.run("INSERT OR REPLACE INTO settings_contact_code (person, channel, value, code_hash, expires_at, attempts, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)", person, channel, value, await hashOf(person, channel, value, code), expiresAt, 0, now);
  ctx.db.run("INSERT INTO settings_contact_sent (person, channel, at) VALUES (?, ?, ?)", person, channel, now);
  const words = `Your Vyre verification code is ${code}. It expires in ${CODE_MINUTES} minutes.`;
  try {
    const sent = (await (channel === "email"
      ? ctx.call("mail.send", { mailboxId: sender!.id, senderId: sender!.id, ...(sender!.provider === "resend" || sender!.provider === "mailgun" ? { route: "space_domain" } : {}), to: [{ address: value }], subject: "Your Vyre verification code", text: words, idempotencyKey: `contact:${person}:${channel}:${now}` })
      : ctx.call("telephony.send_sms", { numberId: sender!.id, senderId: sender!.id, to: value, body: words, idempotencyKey: `contact:${person}:${channel}:${now}` }))) as { status?: string };
    if (sent.status === "suppressed" || sent.status === "held") throw new Error(`not sent: ${sent.status}`);
  } catch {
    ctx.db.run("DELETE FROM settings_contact_code WHERE person = ? AND channel = ?", person, channel);
    raise(ctx, "validation.precondition_failed", channel === "email" ? "The code could not be sent to that address." : "The code could not be texted to that number. Use the form +14155550123.");
  }
  ctx.emit("settings.contact_code_sent", `person/${person}`, { person, channel });
  return { sent: true, verified: false, expiresAt };
}

export async function contactVerifyConfirm(ctx: SettingsCtx, input: { channel: Channel; code: string }) {
  const person = me(ctx);
  const channel = input.channel;
  const row = ctx.db.all("SELECT value, code_hash, expires_at, attempts FROM settings_contact_code WHERE person = ? AND channel = ?", person, channel)[0] as { value: string; code_hash: string; expires_at: number; attempts: number } | undefined;
  const fail = (reason: string, code: Parameters<typeof raise>[1], message: string): never => {
    ctx.emit("settings.contact_code_failed", `person/${person}`, { person, channel, reason }, { afterFailure: true });
    return raise(ctx, code, message);
  };
  if (!row) return fail("none", "validation.precondition_failed", "Ask for a code first.");
  const value = contactOf(ctx, person)[channel];
  if (row.value !== value) { ctx.db.run("DELETE FROM settings_contact_code WHERE person = ? AND channel = ?", person, channel); return fail("changed", "validation.precondition_failed", "That changed since the code was sent. Ask for a new one."); }
  if (ctx.now() > row.expires_at) { ctx.db.run("DELETE FROM settings_contact_code WHERE person = ? AND channel = ?", person, channel); return fail("expired", "auth.expired", "That code has expired. Ask for a new one."); }
  if (row.attempts >= TRIES) { ctx.db.run("DELETE FROM settings_contact_code WHERE person = ? AND channel = ?", person, channel); return fail("tries", "rate_limit.exceeded", "Too many wrong codes. Ask for a new one."); }
  if (row.code_hash !== await hashOf(person, channel, value, String(input.code).trim())) {
    ctx.db.run("UPDATE settings_contact_code SET attempts = ? WHERE person = ? AND channel = ?", row.attempts + 1, person, channel);
    return fail("wrong", "auth.invalid_code", "That is not the code.");
  }
  ctx.db.run("DELETE FROM settings_contact_code WHERE person = ? AND channel = ?", person, channel);
  ctx.db.run("INSERT OR REPLACE INTO settings_contact_verified (person, channel, value, verified_at) VALUES (?, ?, ?, ?)", person, channel, value, ctx.now());
  ctx.emit("settings.contact_verified", `person/${person}`, { person, channel });
  return { verified: true };
}
