// Email and text step drafts. The send still uses subject, body, recipients, and file ids.
// The message object keeps the builder draft: preview text, blocks, reply-to, and the pinned version.
import { EMAIL_BLOCK_KINDS, EMAIL_SOCIAL_NETWORKS } from "../../../../../../ui/src/EmailBuilder/props.ts";
import type { EmailBlock, EmailBlockKind, EmailSocialNetwork } from "../../../../../../ui/src/EmailBuilder/props.ts";

export const SMS_LINK_POLICY = "Links stay as written. This step does not shorten them.";
export const SMS_QUIET_HOURS = "The number's send window still applies when the text goes out.";
export const SMS_CONSENT = "The send checks SMS consent before it leaves.";
export const EMAIL_REPLY = "Reply-to stays on the step. The mailbox address is the sender.";
export const EMAIL_CONSENT = "The builder keeps an unsubscribe line unless the body already has one.";

const TOKEN = /\{\{\s*([\w.]+)\s*(?:\|([^}]*))?\}\}/g;
const GSM = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà".split(""),
);

export type EmailMode = "visual" | "html" | "plain";

export interface MessageDraft {
  version: number;
  previewText: string;
  mode: EmailMode;
  blocks: EmailBlock[];
  html: string;
  plain: string;
  replyTo: string;
  fromName: string;
  consent: "unsubscribe" | "none";
}

export interface SmsDraft {
  version: number;
  mediaFileIds: string[];
}

export interface SmsCount {
  encoding: "GSM-7" | "Unicode";
  characters: number;
  segments: number;
  limit: number;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function isKind(v: string): v is EmailBlockKind {
  return (EMAIL_BLOCK_KINDS as readonly string[]).includes(v);
}

function isNetwork(v: string): v is EmailSocialNetwork {
  return (EMAIL_SOCIAL_NETWORKS as readonly string[]).includes(v);
}

function looksHtml(body: string): boolean {
  return /^\s*</.test(body);
}

/** Fills `{{field|fallback}}` from fixture values. A missing field uses the fallback, then nothing. */
export function fillTokens(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(TOKEN, (_m, field: string, fallback?: string) => values[field] ?? fallback ?? "");
}

/** GSM-7 when every character is in the basic set. Otherwise Unicode. */
export function smsCount(body: string): SmsCount {
  const chars = [...body];
  const gsm = chars.every((ch) => GSM.has(ch));
  const characters = chars.length;
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  const segments = characters === 0 ? 0 : characters <= single ? 1 : Math.ceil(characters / multi);
  return { encoding: gsm ? "GSM-7" : "Unicode", characters, segments, limit: segments <= 1 ? single : multi };
}

function messageRecord(input: Readonly<Record<string, unknown>>): Record<string, unknown> | undefined {
  const message = input.message;
  return message && typeof message === "object" && !Array.isArray(message) ? message as Record<string, unknown> : undefined;
}

export function toEmailBlock(raw: unknown, id: string): EmailBlock | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const rec = raw as Record<string, unknown>;
  const kindRaw = typeof rec.kind === "string" ? rec.kind : typeof rec.type === "string" ? rec.type : "";
  if (!isKind(kindRaw)) return undefined;
  const props = rec.props && typeof rec.props === "object" && !Array.isArray(rec.props) ? rec.props as Record<string, unknown> : rec;
  const block: EmailBlock = { id, kind: kindRaw };
  if (typeof props.text === "string") block.text = props.text;
  if (typeof props.field === "string") block.field = props.field;
  if (typeof props.size === "number") block.size = props.size;
  if (props.align === "left" || props.align === "center" || props.align === "right") block.align = props.align;
  if (props.unsub === true) block.unsub = true;
  if (typeof props.savedId === "string") block.savedId = props.savedId;
  if (Array.isArray(props.links)) {
    const links = props.links.flatMap((link) => {
      if (!link || typeof link !== "object") return [];
      const row = link as Record<string, unknown>;
      if (typeof row.network !== "string" || !isNetwork(row.network) || typeof row.url !== "string") return [];
      return [{ network: row.network, url: row.url }];
    });
    if (links.length > 0) block.links = links;
  }
  const nested = Array.isArray(props.children) ? props.children : Array.isArray(props.cols) ? props.cols.flat() : [];
  if (nested.length > 0) {
    const children = nested.flatMap((child, index) => {
      const next = toEmailBlock(child, `${id}-${index}`);
      return next ? [next] : [];
    });
    if (children.length > 0) block.children = children;
  }
  if (props.block && kindRaw === "saved") {
    const inner = toEmailBlock(props.block, `${id}-0`);
    if (inner) block.children = [inner];
  }
  return block;
}

export function toApiBlock(block: EmailBlock): { type: string; props: Record<string, unknown> } {
  const props: Record<string, unknown> = {};
  if (block.text !== undefined) props.text = block.text;
  if (block.field !== undefined) props.field = block.field;
  if (block.size !== undefined) props.size = block.size;
  if (block.align !== undefined) props.align = block.align;
  if (block.unsub !== undefined) props.unsub = block.unsub;
  if (block.links !== undefined) props.links = block.links;
  if (block.savedId !== undefined) props.savedId = block.savedId;
  if (block.children !== undefined) props.children = block.children.map((child) => toApiBlock(child));
  return { type: block.kind, props };
}

export function savedFromList(rows: unknown): { id: string; name: string; block: EmailBlock; shared?: boolean }[] {
  if (!Array.isArray(rows)) return [];
  const out: { id: string; name: string; block: EmailBlock; shared?: boolean }[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const id = typeof rec.blockId === "string" ? rec.blockId : typeof rec.id === "string" ? rec.id : "";
    const name = typeof rec.name === "string" ? rec.name : "";
    const block = id ? toEmailBlock(rec.block, id) : undefined;
    if (!id || !name || !block) continue;
    out.push({ id, name, block, ...(rec.shared === true ? { shared: true } : {}) });
  }
  return out;
}

export function readMessage(input: Readonly<Record<string, unknown>>): MessageDraft {
  const rec = messageRecord(input);
  const body = str(input.body);
  const blocks = Array.isArray(rec?.blocks) ? rec.blocks.flatMap((item, index) => {
    const block = toEmailBlock(item, typeof (item as { id?: unknown } | null)?.id === "string" ? (item as { id: string }).id : `b${index}`);
    return block ? [block] : [];
  }) : [];
  const mode: EmailMode = rec?.mode === "html" || rec?.mode === "plain" || rec?.mode === "visual"
    ? rec.mode
    : looksHtml(body) ? "html" : "plain";
  const html = typeof rec?.html === "string" ? rec.html : mode === "html" ? body : "";
  const plain = typeof rec?.plain === "string" ? rec.plain : mode === "plain" ? body : "";
  const consent = rec?.consent === "unsubscribe" || /unsubscribe/i.test(body) ? "unsubscribe" : "none";
  return {
    version: typeof rec?.version === "number" && rec.version >= 1 ? rec.version : 0,
    previewText: typeof rec?.previewText === "string" ? rec.previewText : "",
    mode,
    blocks,
    html,
    plain,
    replyTo: typeof rec?.replyTo === "string" ? rec.replyTo : "",
    fromName: typeof rec?.fromName === "string" ? rec.fromName : "",
    consent,
  };
}

export interface EmailWrite {
  subject: string;
  previewText: string;
  body: string;
  mode: EmailMode;
  blocks: readonly EmailBlock[];
  html: string;
  plain: string;
  replyTo: string;
  fromName: string;
}

export function writeEmail(input: Readonly<Record<string, unknown>>, patch: EmailWrite): Record<string, unknown> {
  const prev = readMessage(input);
  const consent = /unsubscribe/i.test(patch.body) || /unsubscribe/i.test(patch.plain) ? "unsubscribe" : "none";
  const same = str(input.subject) === patch.subject
    && prev.previewText === patch.previewText
    && str(input.body) === patch.body
    && prev.mode === patch.mode
    && prev.replyTo === patch.replyTo
    && prev.fromName === patch.fromName
    && prev.html === patch.html
    && prev.plain === patch.plain
    && JSON.stringify(prev.blocks) === JSON.stringify(patch.blocks)
    && prev.consent === consent;
  const version = same ? Math.max(prev.version, 1) : prev.version + 1;
  return {
    ...input,
    subject: patch.subject,
    body: patch.body,
    message: {
      version,
      previewText: patch.previewText,
      mode: patch.mode,
      blocks: patch.blocks,
      html: patch.html,
      plain: patch.plain,
      replyTo: patch.replyTo,
      fromName: patch.fromName,
      consent,
    },
  };
}

export function readSms(input: Readonly<Record<string, unknown>>): SmsDraft {
  const rec = messageRecord(input);
  const fromInput = Array.isArray(input.mediaFileIds) ? input.mediaFileIds.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  const fromMessage = Array.isArray(rec?.mediaFileIds) ? rec.mediaFileIds.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  return {
    version: typeof rec?.version === "number" && rec.version >= 1 ? rec.version : 0,
    mediaFileIds: fromInput.length > 0 ? fromInput : fromMessage,
  };
}

export function writeSms(input: Readonly<Record<string, unknown>>, patch: { body: string; mediaFileIds: readonly string[] }): Record<string, unknown> {
  const prev = readSms(input);
  const media = patch.mediaFileIds.map((id) => id.trim()).filter((id) => id.length > 0);
  const same = str(input.body) === patch.body && JSON.stringify(prev.mediaFileIds) === JSON.stringify(media);
  const next: Record<string, unknown> = {
    ...input,
    body: patch.body,
    message: { version: same ? Math.max(prev.version, 1) : prev.version + 1, linkPolicy: "as-written" as const },
  };
  if (media.length > 0) next.mediaFileIds = media;
  else delete next.mediaFileIds;
  return next;
}

export function recipientText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.length > 0).join(", ");
  return "";
}

export function writeList(input: Readonly<Record<string, unknown>>, key: string, text: string): Record<string, unknown> {
  const parts = text.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  const next: Record<string, unknown> = { ...input };
  if (parts.length === 0) delete next[key];
  else next[key] = parts;
  return next;
}

function people(value: unknown): string {
  return recipientText(value);
}

function savedCount(blocks: readonly EmailBlock[]): number {
  return blocks.filter((block) => block.kind === "saved").length;
}

/** One line for the canvas card. */
export function messageSummary(key: string, input: Readonly<Record<string, unknown>>): string | undefined {
  if (key === "send_email") {
    const draft = readMessage(input);
    const subject = str(input.subject);
    const to = people(input.to);
    if (!subject && !to && !str(input.body)) return undefined;
    const saved = savedCount(draft.blocks);
    const pin = draft.version >= 1 ? `, template v${draft.version}` : "";
    const extra = saved > 0 ? `, ${saved} saved` : "";
    return `Email ${to || "a recipient"}${subject ? `: ${subject}` : ""}${extra}${pin}`;
  }
  if (key === "send_sms") {
    const body = str(input.body);
    const to = str(input.to);
    if (!body && !to) return undefined;
    const count = smsCount(body);
    const seg = body ? `, ${count.segments} ${count.segments === 1 ? "segment" : "segments"}` : "";
    const media = readSms(input).mediaFileIds.length;
    const files = media > 0 ? `, ${media} ${media === 1 ? "file" : "files"}` : "";
    return `Text ${to || "a number"}${seg}${files}`;
  }
  return undefined;
}

/** The message a test shows after fixture values fill the tokens. */
export function renderMessage(key: string, input: Readonly<Record<string, unknown>>, values: Readonly<Record<string, string>>): string | undefined {
  if (key === "send_email") {
    const draft = readMessage(input);
    const subject = fillTokens(str(input.subject), values);
    const preview = fillTokens(draft.previewText, values);
    const body = fillTokens(str(input.body), values);
    if (!subject && !body && !preview) return undefined;
    return [`Subject: ${subject || "(none)"}`, preview ? `Preview: ${preview}` : "", body].filter((line) => line.length > 0).join("\n");
  }
  if (key === "send_sms") {
    const body = fillTokens(str(input.body), values);
    if (!body) return undefined;
    const count = smsCount(body);
    return `${body}\n${count.segments} ${count.encoding} ${count.segments === 1 ? "segment" : "segments"}, ${count.characters} characters. ${SMS_LINK_POLICY}`;
  }
  return undefined;
}

/** String leaves from fixture samples, by path and by the last name. */
export function fixtureValues(samples: Readonly<Record<string, unknown>>): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (value: unknown, prefix: string): void => {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      if (!prefix) return;
      out[prefix] = String(value);
      const leaf = prefix.split(".").pop() ?? prefix;
      if (out[leaf] === undefined) out[leaf] = String(value);
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const rec = value as Record<string, unknown>;
    if ("output" in rec && "definitionVersion" in rec) {
      walk(rec.output, prefix);
      return;
    }
    for (const [name, child] of Object.entries(rec)) walk(child, prefix ? `${prefix}.${name}` : name);
  };
  for (const [id, sample] of Object.entries(samples)) walk(sample, id === "trigger" ? "" : id);
  return out;
}
