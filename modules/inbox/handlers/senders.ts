// comms.senders.list and comms.senders.set_default: every address the caller can send from, in one list (the composer's From picker).
// The list is gathered through the other modules' own capabilities (mail.mailbox.list, mail.domain.list, telephony.number.list, settings.get); inbox reads none of their tables.
//   email   a mailbox is a sender. A Gmail or Outlook mailbox sends through the member's own account; every other mailbox (IMAP, shared, agent, service, receive only) sends through the
//           Space sending domain at Resend or Mailgun (mail.send's route rules), so it is usable only while a verified domain exists at the provider the Space chose.
//   text    a number that texts is a sender (Twilio, through telephony.send_sms).
// A sender the caller may not use is left out. One that exists but cannot send right now is listed with usable false and the reason in plain words.
// The sender id is the mailbox id or the number id, so mail.send / mail.send_as (mailboxId) and telephony.send_sms (numberId) take it as senderId.
// DECISION: the default sender of a channel is a person setting (comms.default_sender_email / comms.default_sender_text). With none stored, or a stored one that is gone or unusable,
// the first usable sender of the channel that is the caller's own is the default, else the first usable one.
import { bad, codeOf, ensure, list, obj, refuse, text } from "../projections.ts";
import type { InboxCtx, Json } from "../projections.ts";

export type SenderChannel = "email" | "text";
export interface Sender {
  id: string;
  channel: SenderChannel;
  name: string;
  address: string;
  via: string;
  provider: string;
  scope: "mine" | "space";
  default: boolean;
  usable: boolean;
  why?: string;
}

export const DEFAULT_KEY: Readonly<Record<SenderChannel, string>> = { email: "comms.default_sender_email", text: "comms.default_sender_text" };
const PAGES = 20;
const SPACE_DOMAIN_VIA: Readonly<Record<string, string>> = { resend: "Resend", mailgun: "Mailgun" };
const MEMBER_VIA: Readonly<Record<string, { via: string; provider: string }>> = { google: { via: "Gmail", provider: "google" }, microsoft: { via: "Outlook", provider: "microsoft" } };
const me = (ctx: InboxCtx): string => ctx.actingFor ?? ctx.principal.id;

/** Every page of a list capability that pages with `next`. */
async function allPages(ctx: InboxCtx, cap: string, input: Json, key: string): Promise<Json[]> {
  const out: Json[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < PAGES; i++) {
    const page = obj(await ctx.call(cap, cursor === undefined ? input : { ...input, cursor }));
    out.push(...list(page[key]).map(obj));
    cursor = typeof page.next === "string" && page.next !== "" ? page.next : undefined;
    if (cursor === undefined) break;
  }
  return out;
}

/** A source that is down or not wired must not hide the others: its senders are simply missing from the list. */
async function guarded<T>(ctx: InboxCtx, what: string, fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    ctx.log.warn("senders: a source could not be read", { source: what, code: codeOf(e) });
    return fallback;
  }
}

async function readSetting(ctx: InboxCtx, key: string): Promise<unknown> {
  try {
    return obj(obj(await ctx.call("settings.get", { key })).row).value;
  } catch {
    return undefined;
  }
}

// ---- email

async function emailSenders(ctx: InboxCtx): Promise<Sender[]> {
  const boxes = await guarded(ctx, "mail.mailbox.list", [] as Json[], () => allPages(ctx, "mail.mailbox.list", { scope: "all" }, "mailboxes"));
  if (boxes.length === 0) return [];
  const domains = await guarded(ctx, "mail.domain.list", [] as Json[], () => allPages(ctx, "mail.domain.list", {}, "domains"));
  const chosen = await readSetting(ctx, "mail.provider");
  const spaceProvider = chosen === "mailgun" ? "mailgun" : "resend";
  const spaceVia = SPACE_DOMAIN_VIA[spaceProvider] ?? "Resend";
  const hasDomain = domains.some((d) => d.verified === true && text(d.provider) === spaceProvider);
  const person = ctx.principal.kind === "person";
  const out: Sender[] = [];
  for (const m of boxes) {
    const id = text(m.id);
    const address = text(m.address);
    if (!id || !address) continue;
    const kind = text(m.kind);
    // the same permission mail.send asks: comms.agent_send for an agent, comms.shared_send on a shared inbox, otherwise use of the mailbox
    const perm = ctx.principal.kind === "agent" ? "comms.agent_send" : kind === "shared" ? "comms.shared_send" : null;
    if (ctx.authorize({ perm, level: "use" }, { type: "mailbox", id }).effect !== "allow") continue;

    const provider = text(m.provider);
    const state = text(m.state);
    const member = MEMBER_VIA[provider];
    const own = text(m.ownerId) === me(ctx) || text(m.agentId) === me(ctx);
    // a member's own Gmail or Outlook sends as the member when a person sends; everything else goes out through the Space sending domain
    const viaMailbox = member !== undefined && person;
    const route = viaMailbox ? member : { via: spaceVia, provider: spaceProvider };
    let why: string | undefined;
    if (state === "disconnected") why = "Disconnected. Connect it again in Console, Comms.";
    else if (state === "paused") why = "Paused. Resume it in Console, Comms.";
    else if (state === "error") why = "It needs to be reconnected. Sign in again in Console, Comms.";
    else if (!viaMailbox && !hasDomain) {
      why = member === undefined
        ? `Receive only. Add and verify a ${spaceVia} sending domain in Console, Comms to send from it.`
        : `No verified ${spaceVia} sending domain. Add one in Console, Comms.`;
    }
    out.push({
      id, channel: "email", name: text(m.title) || address, address, via: route.via, provider: route.provider,
      scope: kind === "personal" && own ? "mine" : "space", default: false, usable: why === undefined, ...(why ? { why } : {}),
    });
  }
  return out;
}

// ---- text

async function textSenders(ctx: InboxCtx): Promise<Sender[]> {
  const numbers = await guarded(ctx, "telephony.number.list", [] as Json[], () => allPages(ctx, "telephony.number.list", {}, "numbers"));
  const out: Sender[] = [];
  for (const n of numbers) {
    const id = text(n.id);
    const address = text(n.e164);
    if (!id || !address) continue;
    if (ctx.authorize({ perm: null, level: "use" }, { type: "number", id }).effect !== "allow") continue;
    const state = text(n.state);
    if (state === "released") continue;
    const canText = list(n.capabilities).includes("sms");
    let why: string | undefined;
    if (!canText) why = "This number cannot send texts.";
    else if (state !== "active") why = "Still being set up.";
    out.push({
      id, channel: "text", name: text(n.displayName) || text(n.title) || address, address, via: "Twilio", provider: "twilio",
      scope: text(n.assigneeKind) === "person" && text(n.assigneeId) === me(ctx) ? "mine" : "space", default: false, usable: why === undefined, ...(why ? { why } : {}),
    });
  }
  return out;
}

// ---- the list

function markDefault(rows: Sender[], stored: unknown): void {
  const usable = rows.filter((s) => s.usable);
  const pick = usable.find((s) => s.id === stored) ?? usable.find((s) => s.scope === "mine") ?? usable[0];
  if (pick) pick.default = true;
}

export async function sendersList(ctx: InboxCtx, input: { channel?: SenderChannel }): Promise<{ senders: Sender[] }> {
  ensure(ctx);
  if (input.channel !== undefined && input.channel !== "email" && input.channel !== "text") bad(ctx, "The channel is email or text.");
  const channels: SenderChannel[] = input.channel ? [input.channel] : ["email", "text"];
  const senders: Sender[] = [];
  for (const channel of channels) {
    const rows = channel === "email" ? await emailSenders(ctx) : await textSenders(ctx);
    // usable first, then the caller's own, then by name, so the picker reads in the order a person would choose
    rows.sort((a, b) => Number(b.usable) - Number(a.usable) || Number(b.scope === "mine") - Number(a.scope === "mine") || a.name.localeCompare(b.name) || a.address.localeCompare(b.address));
    markDefault(rows, await readSetting(ctx, DEFAULT_KEY[channel]));
    senders.push(...rows);
  }
  return { senders };
}

export async function sendersSetDefault(ctx: InboxCtx, input: { channel: SenderChannel; senderId: string }): Promise<{ channel: SenderChannel; senderId: string }> {
  ensure(ctx);
  if (input.channel !== "email" && input.channel !== "text") bad(ctx, "The channel is email or text.");
  if (typeof input.senderId !== "string" || input.senderId === "") bad(ctx, "Pick a sender.");
  const { senders } = await sendersList(ctx, { channel: input.channel });
  const found = senders.find((s) => s.id === input.senderId);
  if (!found) refuse(ctx, "That sender is not one you can send from.");
  if (!found.usable) refuse(ctx, `${found.address} cannot send right now. ${found.why ?? ""}`.trim());
  await ctx.call("settings.set", { key: DEFAULT_KEY[input.channel], value: input.senderId });
  return { channel: input.channel, senderId: input.senderId };
}

