// email-builder-api: the server half of the one email builder used by Campaigns, Inbox templates and Automation email steps (spec 2.19, 3.6; ARCH 7.6).
// A design is a block document (text, image, button, columns, divider, merge field, HTML block), full HTML, or plain text. This file saves it with a version per
// save, compiles it to table-based HTML and a plain-text part, previews it as desktop, mobile, dark or plain text (optionally as a record), runs the checks a send
// needs (unsubscribe, links, alt text, spam words, weight), sends the author a test, lists merge fields, keeps composer snippets, and turns an Ask Vyre edit into a
// per-change diff. The block shapes follow the prototype's V.email (vyre-v1.html); the HTML it makes is the same family: 600 px card, inline styles, tables.
// @reads ../migrations/0001_email_builder.sql

import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { ErrorCode, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";
import { mintUuid } from "../../../lib/ids.ts";

export const MAX_BLOCKS = 500;
export const MAX_DEPTH = 3;
export const MAX_HTML = 1024 * 1024;
export const MAX_PLAIN = 256 * 1024;
export const MAX_SUBJECT = 998;
const NAME_MAX = 120;
const SNIPPET_BODY_MAX = 16 * 1024;
const WIDTH = 600;
const GMAIL_CLIP = 102 * 1024;

export type Mode = "blocks" | "html" | "plain";
export type Variant = "desktop" | "mobile" | "dark" | "plain";
export type BlockType = "text" | "heading" | "image" | "button" | "columns" | "divider" | "merge" | "footer" | "html" | "spacer" | "social" | "saved";
export const BLOCK_TYPES: readonly string[] = ["text", "heading", "image", "button", "columns", "divider", "merge", "footer", "html", "spacer", "social", "saved"];
export const SOCIAL_NETWORKS: readonly string[] = ["facebook", "instagram", "linkedin", "x", "youtube", "tiktok", "website"];

export interface Block { type: BlockType; props: Record<string, unknown> }

export interface EmailDoc {
  emailId: string;
  name: string;
  mode: Mode;
  blocks?: Block[];
  html?: string;
  plain?: string;
  subject?: string;
}

export interface CheckResult { id: string; name: string; level: "ok" | "warn" | "bad"; text: string }
export interface Change { path: string; before: unknown; after: unknown }

// ---- the Ask Vyre seam ------------------------------------------------------------------------------------------

/** What an agent proposes for an instruction: the design after the edit. The engine lane supplies the driver; tests script it. */
export interface AskDriver {
  propose(req: { instruction: string; agentId: string | null; doc: EmailDoc }): Promise<Partial<EmailDoc> & { blocks?: Block[] }>;
}

let askDriver: AskDriver | null = null;

/** The host calls this once at start with the driver that runs an agent turn in the Ask pane. Null clears it. */
export function configureEmailBuilder(o: { ask: AskDriver | null }): void {
  askDriver = o.ask;
}

// ---- errors and input helpers -------------------------------------------------------------------------------------

type Row = Record<string, unknown>;

const NEXT: Record<NextStep["kind"], string> = {
  retry: "Try again",
  switch_model: "Switch model",
  use_backup_key: "Use the backup key",
  ask_access: "Ask for access",
  open_settings: "Open settings",
  reconnect: "Reconnect",
  edit_input: "Fix the input",
  wait: "Wait a moment",
  contact_admin: "Contact an admin",
  report: "Report a problem",
};

export function fail(ctx: Ctx, code: ErrorCode, message?: string, details?: Record<string, unknown>): never {
  const def = ERROR_CODES.find((e) => e.code === code) ?? ERROR_CODES.find((e) => e.code === "internal.unexpected");
  if (!def) throw new Error("error catalogue is empty");
  const error: VyreError = {
    code: def.code,
    message: message ?? def.what,
    retryable: def.retryable,
    traceId: ctx.trace.traceId,
    next: def.next.map((kind) => ({ kind, label: NEXT[kind] })),
  };
  if (details) error.details = details;
  throw new VyreErr(error);
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "" && Number.isFinite(Number(v))) return Number(v);
  return 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function isNull(v: unknown): boolean {
  return v === null || v === undefined;
}

function one(ctx: Ctx, sql: string, ...args: unknown[]): Row | undefined {
  return (ctx.db.all(sql, ...args) as Row[])[0];
}

function many(ctx: Ctx, sql: string, ...args: unknown[]): Row[] {
  return ctx.db.all(sql, ...args) as Row[];
}

function rec(ctx: Ctx, input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) fail(ctx, "validation.bad_input", "The input is not valid.");
  return input as Record<string, unknown>;
}

function optStr(ctx: Ctx, o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

function reqStr(ctx: Ctx, o: Record<string, unknown>, key: string): string {
  const v = optStr(ctx, o, key);
  if (v === undefined || v.length === 0) fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

function nid(ctx: Ctx, prefix: string): string {
  return `${prefix}_${mintUuid(ctx.now()).replaceAll("-", "")}`;
}

function cleanName(ctx: Ctx, raw: string, what: string): string {
  const n = raw.trim();
  if (n.length === 0 || n.length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(n)) {
    fail(ctx, "validation.bad_input", `A ${what} name is 1 to ${NAME_MAX} characters without control characters.`, { field: "name" });
  }
  return n;
}

// ---- escaping and cleaning --------------------------------------------------------------------------------------------

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c] ?? c);

const ENTITY = /^&(?:amp|lt|gt|quot|apos|nbsp|#\d{1,6}|#x[0-9a-f]{1,6});/i;
const TOKEN = /\{\{\s*([a-z][a-z0-9_]*)\s*(?:\|([^}]*))?\}\}/gi;
const SAFE_URL = /^(?:https?:\/\/|mailto:|tel:|\{\{\s*[a-z][a-z0-9_]*\s*(?:\|[^}]*)?\}\})/i;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A URL for an href or src: http, https, mailto, tel or a merge token; anything else (javascript:, data:text/html) becomes "#". */
export function safeUrl(u: unknown): string {
  const s = String(u ?? "").trim();
  return SAFE_URL.test(s) && !/[\u0000-\u001f\s"<>]/.test(s.replace(TOKEN, "")) ? s : "#";
}

function safeImgSrc(u: unknown): string {
  const s = String(u ?? "").trim();
  if (/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml)[;,]/i.test(s) && s.length < 300_000) return s;
  return /^https?:\/\//i.test(s) ? s : "";
}

const color = (v: unknown, fallback: string): string => (typeof v === "string" && HEX.test(v.trim()) ? v.trim() : fallback);
const clamp = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
};
const align = (v: unknown): "left" | "center" | "right" => (v === "center" || v === "right" ? v : "left");

/** Inline HTML a text block may hold: b, strong, i, em, u, br, and links. Every other tag is shown as text; entities stay. */
export function cleanInline(html: string): string {
  let out = "";
  let i = 0;
  while (i < html.length) {
    const c = html[i];
    if (c === "<") {
      const m = /^<(\/?)([a-z][a-z0-9]*)\b([^<>]*)>/i.exec(html.slice(i));
      if (m) {
        const closing = m[1] === "/", tag = (m[2] ?? "").toLowerCase(), attrs = m[3] ?? "";
        if (tag === "br") out += "<br>";
        else if (tag === "b" || tag === "strong" || tag === "i" || tag === "em" || tag === "u") out += closing ? `</${tag}>` : `<${tag}>`;
        else if (tag === "a") {
          if (closing) out += "</a>";
          else {
            const h = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
            out += `<a href="${esc(safeUrl(h ? (h[1] ?? h[2] ?? "") : ""))}">`;
          }
        } else out += esc(m[0]);
        i += m[0].length;
        continue;
      }
      out += "&lt;";
      i += 1;
      continue;
    }
    if (c === "&") {
      const e = ENTITY.exec(html.slice(i));
      if (e) { out += e[0]; i += e[0].length; continue; }
      out += "&amp;";
      i += 1;
      continue;
    }
    if (c === ">" || c === '"' || c === "'") { out += esc(c); i += 1; continue; }
    out += c;
    i += 1;
  }
  return out;
}

/** Author-written HTML (an HTML block, or the whole body in HTML mode): scripts, frames, forms, event handlers and script URLs are removed. Styles stay. */
export function cleanHtml(code: string): string {
  let s = code;
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<\s*(script|iframe|object|embed|applet|form|base|link\b[^>]*rel\s*=\s*["']?import)[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  s = s.replace(/<\s*(script|iframe|object|embed|applet|form|base|input|button\b[^>]*formaction)\b[^>]*>/gi, "");
  s = s.replace(/<\s*meta\b[^>]*http-equiv[^>]*>/gi, "");
  s = s.replace(/(<[a-z][^>]*?)\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "$1");
  s = s.replace(/(<[a-z][^>]*?)\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "$1");
  s = s.replace(/\b(href|src|action|background|poster)\s*=\s*("|')\s*(?:javascript|vbscript|data\s*:\s*text\/html)[^"']*\2/gi, '$1=$2#$2');
  s = s.replace(/url\(\s*["']?\s*(?:javascript|vbscript)[^)]*\)/gi, "none");
  s = s.replace(/expression\s*\(/gi, "blocked(");
  return s;
}

/** Plain text of an HTML fragment: line breaks kept, links shown with their address, tags and styles dropped. */
export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<(style|script|head)\b[\s\S]*?<\/\1\s*>/gi, "");
  s = s.replace(/<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, a: string | undefined, b: string | undefined, label: string) => {
    const href = (a ?? b ?? "").trim();
    const text = label.replace(/<[^>]+>/g, "").trim();
    if (!href || href === "#" || text === href) return text || href;
    return `${text} (${href})`;
  });
  s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|h[1-6]|tr|table|li)\s*>/gi, "\n").replace(/<\/(td|th)\s*>/gi, " ");
  s = s.replace(/<[^>]+>/g, "");
  s = s.replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, "&");
  s = s.replace(/&#(\d{1,6});/g, (_m, d: string) => { const n = Number(d); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; });
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

// ---- merge fields -----------------------------------------------------------------------------------------------------

export const SYSTEM_FIELDS: { key: string; title: string }[] = [
  { key: "unsubscribe_url", title: "Unsubscribe link" },
  { key: "preferences_url", title: "Preferences link" },
  { key: "owner_name", title: "Owner name" },
];

const humanize = (key: string): string => key.replace(/_/g, " ");

/** Fill merge tokens. With `values` they become the value or the fallback (escaped); without, they stay for the sender to fill. */
export function fillTokens(html: string, values: Record<string, string> | null): string {
  if (values === null) return html;
  return html.replace(TOKEN, (_m, key: string, fb: string | undefined) => {
    const k = key.toLowerCase();
    const v = values[k];
    if (v !== undefined && v !== "") return esc(v);
    return fb !== undefined ? esc(fb.trim()) : esc(humanize(k));
  });
}

/** Fill merge tokens into plain text (a subject, a text part): the value, else the fallback, else the field's name. No escaping. */
export function fillPlain(text: string, values: Record<string, string>): string {
  return text.replace(TOKEN, (_m, key: string, fb: string | undefined) => {
    const v = values[key.toLowerCase()];
    return v !== undefined && v !== "" ? v : fb !== undefined ? fb.trim() : humanize(key.toLowerCase());
  });
}

/** The values of a record for the preview: text, numbers and booleans by field key. */
export function valuesOf(fields: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof fields !== "object" || fields === null) return out;
  for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k.toLowerCase()] = String(v);
  }
  return out;
}

// ---- validation of a design ---------------------------------------------------------------------------------------------

function isBlock(v: unknown): v is Block {
  return typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as Row).type === "string" && BLOCK_TYPES.includes((v as Row).type as string)
    && typeof (v as Row).props === "object" && (v as Row).props !== null && !Array.isArray((v as Row).props);
}

function checkBlocks(ctx: Ctx, list: unknown, depth: number, count: { n: number }, path: string): Block[] {
  if (!Array.isArray(list)) fail(ctx, "validation.bad_input", "Blocks must be a list.", { field: path });
  const out: Block[] = [];
  list.forEach((b, i) => {
    count.n += 1;
    if (count.n > MAX_BLOCKS) fail(ctx, "validation.too_large", `A design holds at most ${MAX_BLOCKS} blocks.`, { field: path });
    if (!isBlock(b)) fail(ctx, "validation.bad_input", "A block needs a known type and props.", { field: `${path}/${i}` });
    if (b.type === "saved") {
      const snap = b.props.block;
      if (snap !== undefined && (!isBlock(snap) || snap.type === "saved")) fail(ctx, "validation.bad_input", "A saved block holds one block that is not itself a saved block.", { field: `${path}/${i}/props/block` });
    }
    if (b.type === "social") {
      const links = b.props.links;
      if (links !== undefined && (!Array.isArray(links) || links.length > 12 || !links.every((l) => typeof l === "object" && l !== null && SOCIAL_NETWORKS.includes(str((l as Row).network)) && typeof (l as Row).url === "string"))) {
        fail(ctx, "validation.bad_input", "Social links are up to twelve of a known network and a web address.", { field: `${path}/${i}/props/links` });
      }
    }
    if (b.type === "columns") {
      if (depth >= MAX_DEPTH) fail(ctx, "validation.bad_input", `Columns nest at most ${MAX_DEPTH} deep.`, { field: `${path}/${i}` });
      const cols = b.props.cols;
      if (!Array.isArray(cols) || cols.length < 1 || cols.length > 4) fail(ctx, "validation.bad_input", "Columns hold one to four columns.", { field: `${path}/${i}/props/cols` });
      cols.forEach((c, j) => { checkBlocks(ctx, c, depth + 1, count, `${path}/${i}/props/cols/${j}`); });
    }
    out.push(b);
  });
  return out;
}

/** The design as the host may store it. Throws validation errors in plain words. */
export function validateDoc(ctx: Ctx, input: unknown): EmailDoc {
  const o = rec(ctx, input);
  const mode = reqStr(ctx, o, "mode");
  const folderId = typeof o.folderId === "string" && o.folderId.length > 0 ? o.folderId : null;
  if (mode !== "blocks" && mode !== "html" && mode !== "plain") fail(ctx, "validation.bad_input", "The mode is blocks, html or plain.", { field: "mode" });
  const doc: EmailDoc = { emailId: reqStr(ctx, o, "emailId"), name: cleanName(ctx, reqStr(ctx, o, "name"), "design"), mode };
  const subject = optStr(ctx, o, "subject");
  if (subject !== undefined) {
    if (subject.length > MAX_SUBJECT || /[\r\n]/.test(subject)) fail(ctx, "validation.bad_input", "A subject is one line of at most 998 characters.", { field: "subject" });
    doc.subject = subject;
  }
  const html = optStr(ctx, o, "html");
  if (html !== undefined) {
    if (html.length > MAX_HTML) fail(ctx, "validation.too_large", "The HTML is over 1 MB.", { field: "html" });
    doc.html = html;
  }
  const plain = optStr(ctx, o, "plain");
  if (plain !== undefined) {
    if (plain.length > MAX_PLAIN) fail(ctx, "validation.too_large", "The plain-text part is over 256 KB.", { field: "plain" });
    doc.plain = plain;
  }
  if (o.blocks !== undefined && o.blocks !== null) doc.blocks = checkBlocks(ctx, o.blocks, 0, { n: 0 }, "blocks");
  return doc;
}

// ---- compile ----------------------------------------------------------------------------------------------------------

const FONT = "Arial,Helvetica,sans-serif";
const INK = "#18181A";
const MUTED = "#6B6B73";
const LINK = "#5B5BD6";
const CARD = "#FFFFFF";
const BG = "#F4F4F5";

function cell(inner: string, type: string, top: number, bottom: number, side: number): string {
  return `<tr><td data-b="${type}" class="px" style="padding:${top}px ${side}px ${bottom}px">${inner}</td></tr>`;
}

const socialLabel = (n: string): string => (n === "x" ? "X" : n === "linkedin" ? "LinkedIn" : n === "youtube" ? "YouTube" : n === "tiktok" ? "TikTok" : n.charAt(0).toUpperCase() + n.slice(1));

function blockHtml(b: Block, side: number): string {
  const p = b.props;
  switch (b.type) {
    case "text": {
      const body = typeof p.html === "string" ? cleanInline(p.html) : esc(str(p.text)).replace(/\r?\n/g, "<br>");
      const size = clamp(p.size, 10, 48, 16);
      return `<div class="ink" style="margin:0;font:400 ${size}px/1.6 ${FONT};color:${color(p.color, INK)};text-align:${align(p.align)}">${body}</div>`;
    }
    case "image": {
      const src = safeImgSrc(p.src);
      if (!src) return "";
      const w = clamp(p.width, 1, 100, 100);
      const img = `<img src="${esc(src)}" alt="${esc(p.alt)}" width="${Math.round(((WIDTH - side * 2) * w) / 100)}" style="display:inline-block;max-width:100%;width:${w}%;height:auto;border:0;border-radius:${clamp(p.radius, 0, 40, 0)}px;vertical-align:top">`;
      const link = typeof p.href === "string" && p.href.trim() ? `<a href="${esc(safeUrl(p.href))}">${img}</a>` : img;
      return `<div style="text-align:${align(p.align === undefined ? "center" : p.align)};font-size:0;line-height:0">${link}</div>`;
    }
    case "button": {
      const bg = color(p.bg, LINK), ink = color(p.color, "#FFFFFF"), radius = clamp(p.radius, 0, 40, 8);
      const full = p.full === true;
      return `<div style="text-align:${align(p.align)}"><table role="presentation" cellpadding="0" cellspacing="0" ${full ? 'width="100%" ' : ""}style="display:${full ? "table" : "inline-table"};border-collapse:separate"><tr><td style="background:${bg};border-radius:${radius}px;text-align:center"><a href="${esc(safeUrl(p.href))}" style="display:inline-block;padding:12px 24px;font:600 16px/1.2 ${FONT};color:${ink};text-decoration:none">${esc(p.label ?? "Open")}</a></td></tr></table></div>`;
    }
    case "heading": {
      const body = typeof p.html === "string" ? cleanInline(p.html) : esc(str(p.text));
      return `<h1 class="ink" style="margin:0;font:700 ${clamp(p.size, 12, 64, 24)}px/1.2 ${FONT};color:${color(p.color, INK)};text-align:${align(p.align)};letter-spacing:-.01em">${body}</h1>`;
    }
    case "spacer": {
      const h = clamp(p.size, 4, 200, 24);
      return `<div style="height:${h}px;line-height:${h}px;font-size:0">&nbsp;</div>`;
    }
    case "social": {
      const links = (Array.isArray(p.links) ? (p.links as Row[]) : []).filter((l) => SOCIAL_NETWORKS.includes(str(l.network)) && safeUrl(l.url) !== "");
      if (!links.length) return "";
      const a = links.map((l) => `<a href="${esc(safeUrl(l.url))}" style="color:${LINK};text-decoration:none;margin:0 6px">${esc(socialLabel(str(l.network)))}</a>`).join("");
      return `<div style="font:400 14px/1.6 ${FONT};text-align:${align(p.align === undefined ? "center" : p.align)}">${a}</div>`;
    }
    case "footer": {
      const body = typeof p.html === "string" ? cleanInline(p.html) : esc(str(p.text));
      const links = p.unsub === true ? `<div style="margin-top:8px"><a href="{{unsubscribe_url}}" style="color:${MUTED};text-decoration:underline">Unsubscribe</a> &middot; <a href="{{preferences_url}}" style="color:${MUTED};text-decoration:underline">Email preferences</a></div>` : "";
      return `<div class="mut" style="font:400 12px/1.6 ${FONT};color:${MUTED};text-align:${align(p.align === undefined ? "center" : p.align)}"><div>${body}</div>${links}</div>`;
    }
    case "saved":
      return isBlock(p.block) && p.block.type !== "saved" ? blockHtml(p.block, side) : "";
    case "divider":
      return `<div class="line" style="border-top:${clamp(p.thickness, 1, 8, 1)}px solid ${color(p.color, "#E4E4E7")};height:0;line-height:0;font-size:0">&nbsp;</div>`;
    case "merge": {
      const key = str(p.key).toLowerCase().replace(/[^a-z0-9_]/g, "");
      if (!/^[a-z]/.test(key)) return "";
      const fb = typeof p.fallback === "string" && p.fallback ? `|${p.fallback.replace(/[{}|]/g, "")}` : "";
      const token = `{{${key}${fb}}}`;
      if (key === "unsubscribe_url" || key === "preferences_url") {
        const label = typeof p.label === "string" && p.label.trim() ? p.label : key === "unsubscribe_url" ? "Unsubscribe" : "Manage preferences";
        return `<div class="mut" style="font:400 12px/1.6 ${FONT};color:${MUTED};text-align:${align(p.align === undefined ? "center" : p.align)}"><a href="{{${key}}}" style="color:${MUTED};text-decoration:underline">${esc(label)}</a></div>`;
      }
      return `<div class="ink" style="margin:0;font:400 ${clamp(p.size, 10, 48, 16)}px/1.6 ${FONT};color:${color(p.color, INK)};text-align:${align(p.align)}">${token}</div>`;
    }
    case "html":
      return typeof p.code === "string" ? cleanHtml(p.code) : "";
    case "columns": {
      const cols = Array.isArray(p.cols) ? (p.cols as unknown[]) : [];
      const ratio = typeof p.ratio === "string" && /^\d(?::\d){0,3}$/.test(p.ratio) ? p.ratio.split(":").map(Number) : cols.map(() => 1);
      const shares = cols.map((_c, i) => ratio[i] ?? 1);
      const total = shares.reduce((n, x) => n + x, 0) || 1;
      const gap = clamp(p.gap, 0, 48, 16);
      const tds = cols.map((c, i) => {
        const w = Math.round((100 * (shares[i] ?? 1)) / total);
        const inner = (Array.isArray(c) ? c : []).filter(isBlock).map((nb) => `<div data-b="${nb.type}" style="padding:4px 0">${blockHtml(nb, 0)}</div>`).join("");
        return `<td valign="top" width="${w}%" class="col" style="width:${w}%;padding:0 ${i === 0 ? 0 : Math.round(gap / 2)}px 0 ${i === cols.length - 1 ? 0 : Math.round(gap / 2)}px">${inner}</td>`;
      });
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="stack" style="width:100%;border-collapse:collapse"><tr>${tds.join("")}</tr></table>`;
    }
  }
}

const PAD: Record<BlockType, [number, number]> = {
  text: [8, 8], heading: [16, 8], image: [0, 8], button: [16, 16], columns: [8, 8], divider: [16, 16], merge: [8, 8], footer: [16, 16], html: [8, 8], spacer: [0, 0], social: [8, 8], saved: [0, 0],
};

const CSS_BASE = `body{margin:0;padding:0;-webkit-text-size-adjust:100%}a{color:${LINK}}img{border:0;-ms-interpolation-mode:bicubic}table{border-collapse:collapse}`;
const CSS_MOBILE = `.card{width:100%!important}.px{padding-left:16px!important;padding-right:16px!important}.col{display:block!important;width:100%!important;padding:0!important}`;
const CSS_DARK = `body,.bg{background:#0F0F11!important}.card{background:#1A1A1D!important}.ink{color:#F4F4F5!important}.mut{color:#A1A1AA!important}.line{border-color:#34343A!important}`;

/** The design as a complete email: a 600 px card of table rows with inline styles, the head every client reads, a dark and a mobile sheet. */
export function compileHtml(doc: EmailDoc, o: { variant?: "desktop" | "mobile" | "dark"; values?: Record<string, string> | null } = {}): string {
  const variant = o.variant ?? "desktop";
  const subject = esc((doc.subject ?? "").replace(/<[^>]+>/g, ""));   // tokens in it are filled with the rest of the page
  let rows = "";
  let full: string | null = null;
  if (doc.mode === "html") {
    const code = cleanHtml(doc.html ?? "");
    if (/<html[\s>]/i.test(code)) full = code;
    else rows = `<tr><td data-b="html" style="padding:0">${code}</td></tr>`;
  } else if (doc.mode === "plain") {
    const paras = (doc.plain ?? "").split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
    rows = paras.map((x) => cell(`<div class="ink" style="margin:0;font:400 16px/1.6 ${FONT};color:${INK}">${esc(x).replace(/\n/g, "<br>")}</div>`, "text", 8, 8, 32)).join("");
  } else {
    rows = (doc.blocks ?? []).map((b) => {
      const [top, bottom] = PAD[b.type];
      const side = b.type === "image" && b.props.bleed === true ? 0 : 32;
      const inner = blockHtml(b, side);
      return inner ? cell(inner, b.type, clamp(b.props.pt, 0, 96, top), clamp(b.props.pb, 0, 96, bottom), side) : "";
    }).join("\n");
  }
  if (full !== null) return fillTokens(full, o.values ?? null);
  const dark = variant === "dark", mobile = variant === "mobile";
  const css = `${CSS_BASE}@media (max-width:620px){${CSS_MOBILE}}@media (prefers-color-scheme:dark){${CSS_DARK}}${mobile ? CSS_MOBILE : ""}${dark ? CSS_DARK : ""}`;
  const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="color-scheme" content="light dark">\n<meta name="supported-color-schemes" content="light dark">\n<title>${subject}</title>\n<style>${css}</style>\n</head>\n<body class="bg" style="margin:0;padding:0;background:${BG}">\n<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" style="background:${BG}"><tr><td align="center" style="padding:24px 12px">\n<table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" class="card" style="width:${WIDTH}px;max-width:100%;background:${CARD};border-radius:12px">\n${rows}\n</table>\n</td></tr></table>\n</body>\n</html>\n`;
  return fillTokens(html, o.values ?? null);
}

/** The plain-text part: made from the blocks, from the HTML, or as written. Merge tokens stay. */
export function compileText(doc: EmailDoc, o: { values?: Record<string, string> | null } = {}): string {
  let text = "";
  if (doc.mode === "plain") text = doc.plain ?? "";
  else if (doc.mode === "html") text = doc.plain !== undefined && doc.plain.trim() ? doc.plain : htmlToText(cleanHtml(doc.html ?? ""));
  else if (doc.plain !== undefined && doc.plain.trim()) text = doc.plain;
  else {
    const out: string[] = [];
    const walk = (b: Block): void => {
      const p = b.props;
      if (b.type === "text" || b.type === "heading") out.push(typeof p.html === "string" ? htmlToText(cleanInline(p.html)) : str(p.text));
      else if (b.type === "footer") {
        out.push(typeof p.html === "string" ? htmlToText(cleanInline(p.html)) : str(p.text));
        if (p.unsub === true) out.push("Unsubscribe: {{unsubscribe_url}}\nManage preferences: {{preferences_url}}");
      } else if (b.type === "social") out.push((Array.isArray(p.links) ? (p.links as Row[]) : []).filter((l) => SOCIAL_NETWORKS.includes(str(l.network))).map((l) => `${socialLabel(str(l.network))}: ${safeUrl(l.url)}`).join("\n"));
      else if (b.type === "saved") { if (isBlock(p.block) && p.block.type !== "saved") walk(p.block); }
      else if (b.type === "button") out.push(`${str(p.label) || "Open"}: ${safeUrl(p.href)}`);
      else if (b.type === "divider") out.push("-----");
      else if (b.type === "image") { if (str(p.alt).trim()) out.push(`[${str(p.alt).trim()}]`); }
      else if (b.type === "merge") {
        const key = str(p.key).toLowerCase().replace(/[^a-z0-9_]/g, "");
        if (key === "unsubscribe_url") out.push("Unsubscribe: {{unsubscribe_url}}");
        else if (key === "preferences_url") out.push("Manage preferences: {{preferences_url}}");
        else if (key) out.push(`{{${key}${typeof p.fallback === "string" && p.fallback ? `|${p.fallback.replace(/[{}|]/g, "")}` : ""}}}`);
      } else if (b.type === "html") out.push(htmlToText(cleanHtml(str(p.code))));
      else if (b.type === "columns") for (const c of Array.isArray(p.cols) ? (p.cols as unknown[]) : []) for (const nb of Array.isArray(c) ? c : []) if (isBlock(nb)) walk(nb);
    };
    for (const b of doc.blocks ?? []) walk(b);
    text = out.filter((x) => x.trim()).join("\n\n");
  }
  const filled = o.values ? fillPlain(text, o.values) : text;
  return `${filled.trim()}\n`;
}

// ---- checks -----------------------------------------------------------------------------------------------------------

const SPAM = ["free money", "act now", "100% free", "winner", "click here", "guarantee", "no obligation", "urgent", "risk free", "cash bonus", "limited time", "buy now"];

/** What a send needs to be true. `html` and `text` are the compiled parts (tokens still in place). */
export function runChecks(doc: EmailDoc, html: string, text: string): CheckResult[] {
  const out: CheckResult[] = [];
  const hrefs = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*"([^"]*)"/gi)].map((m) => (m[1] ?? "").trim());
  const empty = hrefs.filter((h) => h === "" || h === "#");
  const insecure = hrefs.filter((h) => /^http:\/\//i.test(h));
  out.push({
    id: "links", name: "Links", level: empty.length ? "bad" : insecure.length ? "warn" : "ok",
    text: empty.length ? `${empty.length} link${empty.length > 1 ? "s have" : " has"} no address` : insecure.length ? `${insecure.length} link${insecure.length > 1 ? "s use" : " uses"} http, not https` : hrefs.length ? `${hrefs.length} link${hrefs.length > 1 ? "s" : ""}, all secure` : "No links",
  });
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const noAlt = imgs.filter((t) => { const m = /\balt\s*=\s*"([^"]*)"/i.exec(t); return !m || !(m[1] ?? "").trim(); });
  out.push({ id: "alt", name: "Alt text", level: noAlt.length ? "warn" : "ok", text: noAlt.length ? `${noAlt.length} of ${imgs.length} image${imgs.length > 1 ? "s" : ""} has no alt text` : imgs.length ? "Every image has alt text" : "No images" });
  const words = (htmlToText(html) + " " + (doc.subject ?? "")).toLowerCase();
  const hits = SPAM.filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\%]/g, "\\$&")}`, "i").test(words));
  out.push({ id: "spam", name: "Spam words", level: hits.length ? "warn" : "ok", text: hits.length ? `Found ${hits.map((h) => `"${h}"`).join(", ")}` : "No spam trigger words" });
  const bytes = new TextEncoder().encode(html).length;
  out.push({ id: "weight", name: "Size", level: bytes > GMAIL_CLIP ? "warn" : "ok", text: bytes > GMAIL_CLIP ? `The HTML is ${Math.round(bytes / 1024)} KB; Gmail clips messages over 102 KB` : `${Math.max(1, Math.round(bytes / 1024))} KB of HTML` });
  const unsub = /<a\b[^>]*\bhref\s*=\s*"[^"]*\{\{\s*unsubscribe_url\s*\}\}[^"]*"/i.test(html);
  out.push({ id: "unsub", name: "Unsubscribe link", level: unsub ? "ok" : "bad", text: unsub ? "One-click unsubscribe is in the footer" : "Missing. Required by law and by mailbox providers." });
  const hasText = text.trim().length > 0;
  const textUnsub = /unsubscribe/i.test(text) && /\{\{\s*unsubscribe_url\s*\}\}|https?:\/\//i.test(text);
  out.push({
    id: "plain", name: "Plain-text part", level: !hasText ? "bad" : textUnsub ? "ok" : "warn",
    text: !hasText ? "No plain-text version" : textUnsub ? "The plain-text part has the unsubscribe link" : "The plain-text part has no unsubscribe link",
  });
  const subject = (doc.subject ?? "").trim();
  out.push({ id: "subject", name: "Subject", level: subject ? (subject.length > 78 ? "warn" : "ok") : "warn", text: subject ? (subject.length > 78 ? `The subject is ${subject.length} characters; most inboxes show about 60` : "The subject is set") : "The subject is empty" });
  return out;
}

// ---- diff of an Ask edit ------------------------------------------------------------------------------------------------

/** JSON with object keys in sorted order, so two designs that differ only in the order a client wrote the keys are the same design. */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

const same = (a: unknown, b: unknown): boolean => stable(a) === stable(b);

/** Per-change differences between two designs, each a JSON pointer with the value before and after, so an author can accept them one by one. */
export function diffDocs(before: EmailDoc, after: EmailDoc): Change[] {
  const changes: Change[] = [];
  for (const key of ["name", "mode", "subject", "html", "plain"] as const) {
    if (!same(before[key], after[key])) changes.push({ path: `/${key}`, before: before[key] ?? null, after: after[key] ?? null });
  }
  const a = before.blocks ?? [], b = after.blocks ?? [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    if (x === undefined && y !== undefined) changes.push({ path: `/blocks/${i}`, before: null, after: y });
    else if (y === undefined && x !== undefined) changes.push({ path: `/blocks/${i}`, before: x, after: null });
    else if (x !== undefined && y !== undefined && !same(x, y)) {
      if (x.type !== y.type) changes.push({ path: `/blocks/${i}`, before: x, after: y });
      else {
        const keys = [...new Set([...Object.keys(x.props), ...Object.keys(y.props)])].sort();
        for (const k of keys) if (!same(x.props[k], y.props[k])) changes.push({ path: `/blocks/${i}/props/${k}`, before: x.props[k] ?? null, after: y.props[k] ?? null });
      }
    }
  }
  return changes;
}

/** Apply the changes an author accepted to a design. Removed trailing blocks go last-first so indexes hold. */
export function applyChanges(doc: EmailDoc, changes: Change[]): EmailDoc {
  const out: EmailDoc = JSON.parse(JSON.stringify(doc)) as EmailDoc;
  const blocks = (out.blocks ??= []);
  const removals: number[] = [];
  for (const c of changes) {
    const m = /^\/blocks\/(\d+)(?:\/props\/(.+))?$/.exec(c.path);
    if (m) {
      const i = Number(m[1]);
      if (m[2] === undefined) {
        if (c.after === null) removals.push(i);
        else blocks[i] = c.after as Block;
      } else {
        const blk = blocks[i];
        if (blk) { if (c.after === null) delete blk.props[m[2]]; else blk.props[m[2]] = c.after; }
      }
      continue;
    }
    const f = /^\/(name|mode|subject|html|plain)$/.exec(c.path);
    if (f) {
      const key = f[1] as "name" | "mode" | "subject" | "html" | "plain";
      if (c.after === null) delete out[key];
      else (out as unknown as Record<string, unknown>)[key] = c.after;
    }
  }
  for (const i of removals.sort((x, y) => y - x)) blocks.splice(i, 1);
  return out;
}

// ---- storage -----------------------------------------------------------------------------------------------------------

function docOf(r: Row): EmailDoc {
  const doc: EmailDoc = { emailId: str(r.id), name: str(r.name), mode: str(r.mode) as Mode };
  if (!isNull(r.subject)) doc.subject = str(r.subject);
  if (!isNull(r.blocks)) {
    try {
      const v: unknown = JSON.parse(str(r.blocks));
      if (Array.isArray(v)) doc.blocks = v.filter(isBlock);
    } catch { /* a damaged row reads as no blocks */ }
  }
  if (!isNull(r.html)) doc.html = str(r.html);
  if (!isNull(r.plain)) doc.plain = str(r.plain);
  return doc;
}

function snapshot(doc: EmailDoc): string {
  return stable({ name: doc.name, mode: doc.mode, subject: doc.subject, blocks: doc.blocks, html: doc.html, plain: doc.plain });
}

function mustEmail(ctx: Ctx, emailId: string): Row {
  const row = one(ctx, "SELECT * FROM email_builder_api_email WHERE id = ?", emailId);
  if (!row) fail(ctx, "validation.not_found", "That email design does not exist.");
  return row;
}

function writeDoc(ctx: Ctx, row: Row, next: EmailDoc): number {
  const now = ctx.now();
  const version = num(row.version) + 1;
  ctx.db.run(
    "UPDATE email_builder_api_email SET name = ?, mode = ?, subject = ?, blocks = ?, html = ?, plain = ?, version = ?, updated_at = ? WHERE id = ?",
    next.name, next.mode, next.subject ?? null, next.blocks === undefined ? null : JSON.stringify(next.blocks), next.html ?? null, next.plain ?? null, version, now, row.id,
  );
  ctx.db.run("INSERT INTO email_builder_api_version (email_id, version, doc, at, author) VALUES (?, ?, ?, ?, ?)", row.id, version, snapshot(next), now, ctx.principal.id);
  return version;
}

function emitSaved(ctx: Ctx, emailId: string, version: number): void {
  ctx.emit("email_template.saved", `entity/${emailId}`, { emailId, version });
}

// ---- capabilities ------------------------------------------------------------------------------------------------------

async function create(ctx: Ctx, input: unknown): Promise<{ email: EmailDoc }> {
  const o = rec(ctx, input);
  const name = cleanName(ctx, reqStr(ctx, o, "name"), "design");
  const mode = reqStr(ctx, o, "mode");
  if (mode !== "blocks" && mode !== "html" && mode !== "plain") fail(ctx, "validation.bad_input", "The mode is blocks, html or plain.", { field: "mode" });
  const id = nid(ctx, "eml");
  const now = ctx.now();
  const doc: EmailDoc = { emailId: id, name, mode };
  if (mode === "blocks") doc.blocks = [{ type: "text", props: { html: "" } }];
  if (mode === "html") doc.html = "";
  if (mode === "plain") doc.plain = "";
  ctx.db.run(
    "INSERT INTO email_builder_api_email (id, name, mode, owner, folder_id, subject, blocks, html, plain, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, name, mode, ctx.principal.id, folderId, null, doc.blocks === undefined ? null : JSON.stringify(doc.blocks), doc.html ?? null, doc.plain ?? null, 1, now, now,
  );
  ctx.db.run("INSERT INTO email_builder_api_version (email_id, version, doc, at, author) VALUES (?, ?, ?, ?, ?)", id, 1, snapshot(doc), now, ctx.principal.id);
  return { email: doc };
}

async function get(ctx: Ctx, input: unknown): Promise<{ email: EmailDoc }> {
  const o = rec(ctx, input);
  return { email: docOf(mustEmail(ctx, reqStr(ctx, o, "emailId"))) };
}

async function list(ctx: Ctx, _input: unknown): Promise<{ emails: { emailId: string; name: string; updatedAt: number }[] }> {
  const rows = many(ctx, "SELECT * FROM email_builder_api_email").sort((a, b) => num(b.updated_at) - num(a.updated_at) || str(a.name).localeCompare(str(b.name)) || str(a.id).localeCompare(str(b.id)));
  return { emails: rows.map((r) => ({ emailId: str(r.id), name: str(r.name), updatedAt: num(r.updated_at) })) };
}

async function save(ctx: Ctx, input: unknown): Promise<{ version: number }> {
  const o = rec(ctx, input);
  const emailId = reqStr(ctx, o, "emailId");
  const row = mustEmail(ctx, emailId);
  const doc = validateDoc(ctx, o.email);
  if (doc.emailId !== emailId) fail(ctx, "validation.bad_input", "The design belongs to another email.", { field: "email.emailId" });
  if (snapshot(doc) === snapshot(docOf(row))) return { version: num(row.version) };   // an autosave with nothing new is not a version
  const version = writeDoc(ctx, row, doc);
  emitSaved(ctx, emailId, version);
  return { version };
}

async function versions(ctx: Ctx, input: unknown): Promise<{ versions: { version: number; at: number; by: string }[] }> {
  const o = rec(ctx, input);
  const emailId = reqStr(ctx, o, "emailId");
  mustEmail(ctx, emailId);
  const rows = many(ctx, "SELECT * FROM email_builder_api_version WHERE email_id = ?", emailId).sort((a, b) => num(b.version) - num(a.version));
  return { versions: rows.map((r) => ({ version: num(r.version), at: num(r.at), by: str(r.author) })) };
}

async function restoreVersion(ctx: Ctx, input: unknown): Promise<{ email: EmailDoc }> {
  const o = rec(ctx, input);
  const emailId = reqStr(ctx, o, "emailId");
  const row = mustEmail(ctx, emailId);
  const v = o.version;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) fail(ctx, "validation.bad_input", "The version is a whole number.", { field: "version" });
  const old = one(ctx, "SELECT * FROM email_builder_api_version WHERE email_id = ? AND version = ?", emailId, v);
  if (!old) fail(ctx, "validation.not_found", "That version does not exist.");
  let parsed: unknown;
  try { parsed = JSON.parse(str(old.doc)); } catch { fail(ctx, "internal.unexpected", "That version is damaged."); }
  const doc = validateDoc(ctx, { ...(parsed as Record<string, unknown>), emailId });
  const version = writeDoc(ctx, row, doc);
  emitSaved(ctx, emailId, version);
  return { email: docOf(mustEmail(ctx, emailId)) };
}

async function recordValues(ctx: Ctx, recordId: string): Promise<Record<string, string>> {
  const out = (await ctx.call("records.get", { recordId })) as { record?: { fields?: unknown } };
  return valuesOf(out.record?.fields);
}

async function render(ctx: Ctx, input: unknown): Promise<{ html: string; warnings: string[] }> {
  const o = rec(ctx, input);
  const doc = docOf(mustEmail(ctx, reqStr(ctx, o, "emailId")));
  const variant = reqStr(ctx, o, "variant");
  if (variant !== "desktop" && variant !== "mobile" && variant !== "dark" && variant !== "plain") fail(ctx, "validation.bad_input", "The variant is desktop, mobile, dark or plain.", { field: "variant" });
  const recordId = optStr(ctx, o, "asRecordId");
  const values: Record<string, string> = {
    unsubscribe_url: "https://preview.invalid/unsubscribe", preferences_url: "https://preview.invalid/preferences", owner_name: ctx.principal.id,
    ...(recordId ? await recordValues(ctx, recordId) : {}),
  };
  const sendHtml = compileHtml(doc);
  const sendText = compileText(doc);
  const warnings = runChecks(doc, sendHtml, sendText).filter((c) => c.level !== "ok").map((c) => c.text);
  if (variant === "plain") return { html: compileText(doc, { values }), warnings };
  return { html: compileHtml(doc, { variant, values }), warnings };
}

async function htmlSet(ctx: Ctx, input: unknown): Promise<{ ok: boolean }> {
  const o = rec(ctx, input);
  const emailId = reqStr(ctx, o, "emailId");
  const row = mustEmail(ctx, emailId);
  const html = o.html;
  if (typeof html !== "string") fail(ctx, "validation.bad_input", "The HTML is text.", { field: "html" });
  if (html.length > MAX_HTML) fail(ctx, "validation.too_large", "The HTML is over 1 MB.", { field: "html" });
  const next: EmailDoc = { ...docOf(row), mode: "html", html };
  delete next.blocks;
  if (snapshot(next) === snapshot(docOf(row))) return { ok: true };
  const version = writeDoc(ctx, row, next);
  emitSaved(ctx, emailId, version);
  return { ok: true };
}

async function askDiff(ctx: Ctx, input: unknown): Promise<{ changes: Change[] }> {
  const o = rec(ctx, input);
  const doc = docOf(mustEmail(ctx, reqStr(ctx, o, "emailId")));
  const instruction = reqStr(ctx, o, "instruction");
  if (instruction.length > 4000) fail(ctx, "validation.too_large", "An instruction is at most 4000 characters.", { field: "instruction" });
  if (!askDriver) fail(ctx, "validation.precondition_failed", "No agent is connected to answer. Open Settings and add a model.");
  const agentId = optStr(ctx, o, "agentId") ?? null;
  const proposal = await askDriver.propose({ instruction, agentId, doc: JSON.parse(JSON.stringify(doc)) as EmailDoc });
  // the agent proposes a design; whatever it sends back is held to the same rules as a save
  const next = validateDoc(ctx, { ...doc, ...proposal, emailId: doc.emailId });
  return { changes: diffDocs(doc, next) };
}

async function sendTest(ctx: Ctx, input: unknown): Promise<{ sent: boolean }> {
  const o = rec(ctx, input);
  const emailId = reqStr(ctx, o, "emailId");
  const doc = docOf(mustEmail(ctx, emailId));
  const to = reqStr(ctx, o, "to").trim();
  if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(to)) fail(ctx, "validation.bad_input", "That is not an email address.", { field: "to" });
  const mine = (await ctx.call("mail.mailbox.list", { scope: "mine" })) as { mailboxes?: { id?: string; address?: string }[] };
  const box = (mine.mailboxes ?? []).find((m) => typeof m.address === "string" && m.address.toLowerCase() === to.toLowerCase() && typeof m.id === "string");
  if (!box || typeof box.id !== "string") fail(ctx, "validation.precondition_failed", "A test goes only to your own address. Connect a mailbox with that address first.");
  const values: Record<string, string> = { unsubscribe_url: "https://preview.invalid/unsubscribe", preferences_url: "https://preview.invalid/preferences", owner_name: ctx.principal.id };
  const sent = (await ctx.call("mail.send", {
    mailboxId: box.id, to: [{ address: to }], subject: `[Test] ${fillPlain(doc.subject ?? "", values).replace(/<[^>]+>/g, "").trim() || doc.name}`,
    text: compileText(doc, { values }), html: compileHtml(doc, { values }), idempotencyKey: `email-test-${emailId}-${ctx.now()}`,
  })) as { status?: string };
  const ok = sent.status === "sent" || sent.status === "queued";
  if (ok) ctx.emit("email_template.test_sent", `entity/${emailId}`, { emailId });
  return { sent: ok };
}

async function mergeFields(ctx: Ctx, input: unknown): Promise<{ fields: { key: string; title: string }[] }> {
  const o = rec(ctx, input);
  const type = reqStr(ctx, o, "type");
  const got = (await ctx.call("schema.types.get", { type })) as { type?: { fields?: { key?: string; title?: string }[] } };
  const seen = new Set(SYSTEM_FIELDS.map((f) => f.key));
  const fields = [...SYSTEM_FIELDS];
  for (const f of got.type?.fields ?? []) {
    if (typeof f.key !== "string" || !/^[a-z][a-z0-9_]*$/i.test(f.key) || seen.has(f.key.toLowerCase())) continue;
    seen.add(f.key.toLowerCase());
    fields.push({ key: f.key, title: typeof f.title === "string" && f.title ? f.title : humanize(f.key) });
  }
  return { fields };
}

// ---- snippets -----------------------------------------------------------------------------------------------------------

interface SnippetOut { snippetId: string; name: string; body: string; shortcut?: string; shared: boolean; updatedAt: number }

function snippetOut(r: Row): SnippetOut {
  const out: SnippetOut = { snippetId: str(r.id), name: str(r.name), body: str(r.body), shared: r.shared === 1 || r.shared === true, updatedAt: num(r.updated_at) };
  if (!isNull(r.shortcut)) out.shortcut = str(r.shortcut);
  return out;
}

async function snippetsList(ctx: Ctx, _input: unknown): Promise<{ snippets: SnippetOut[] }> {
  const rows = many(ctx, "SELECT * FROM email_builder_api_snippet")
    .filter((r) => r.owner === ctx.principal.id || r.shared === 1)
    .sort((a, b) => str(a.name).localeCompare(str(b.name)) || str(a.id).localeCompare(str(b.id)));
  return { snippets: rows.map(snippetOut) };
}

async function snippetsSave(ctx: Ctx, input: unknown): Promise<{ snippet: SnippetOut }> {
  const o = rec(ctx, input);
  const name = cleanName(ctx, reqStr(ctx, o, "name"), "snippet");
  const body = reqStr(ctx, o, "body");
  if (body.length > SNIPPET_BODY_MAX) fail(ctx, "validation.too_large", "A snippet is at most 16 KB.", { field: "body" });
  const shortcut = optStr(ctx, o, "shortcut");
  if (shortcut !== undefined && !/^[A-Za-z0-9_-]{1,32}$/.test(shortcut)) fail(ctx, "validation.bad_input", "A shortcut is 1 to 32 letters, digits, dashes or underscores.", { field: "shortcut" });
  const sharedIn = o.shared;
  if (sharedIn !== undefined && sharedIn !== null && typeof sharedIn !== "boolean") fail(ctx, "validation.bad_input", "Shared is true or false.", { field: "shared" });
  const snippetId = optStr(ctx, o, "snippetId");
  const existing = snippetId === undefined ? undefined : one(ctx, "SELECT * FROM email_builder_api_snippet WHERE id = ?", snippetId);
  if (snippetId !== undefined && (!existing || existing.owner !== ctx.principal.id)) fail(ctx, "validation.not_found", "That snippet does not exist.");
  if (shortcut !== undefined) {
    const clash = many(ctx, "SELECT * FROM email_builder_api_snippet WHERE owner = ?", ctx.principal.id).find((r) => r.shortcut === shortcut && r.id !== snippetId);
    if (clash) fail(ctx, "validation.duplicate", "You already have a snippet with that shortcut.", { field: "shortcut" });
  }
  const shared = sharedIn === true ? 1 : sharedIn === false ? 0 : existing ? num(existing.shared) : 0;
  const now = ctx.now();
  const id = existing ? str(existing.id) : nid(ctx, "snp");
  if (existing) {
    ctx.db.run("UPDATE email_builder_api_snippet SET name = ?, body = ?, shortcut = ?, shared = ?, updated_at = ? WHERE id = ?", name, body, shortcut ?? null, shared, now, id);
  } else {
    ctx.db.run("INSERT INTO email_builder_api_snippet (id, owner, name, body, shortcut, shared, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, ctx.principal.id, name, body, shortcut ?? null, shared, now);
  }
  return { snippet: snippetOut(one(ctx, "SELECT * FROM email_builder_api_snippet WHERE id = ?", id) ?? {}) };
}

async function snippetsDelete(ctx: Ctx, input: unknown): Promise<{ deleted: boolean }> {
  const o = rec(ctx, input);
  const row = one(ctx, "SELECT * FROM email_builder_api_snippet WHERE id = ?", reqStr(ctx, o, "snippetId"));
  if (!row || row.owner !== ctx.principal.id) return { deleted: false };
  ctx.db.run("DELETE FROM email_builder_api_snippet WHERE id = ?", row.id);
  return { deleted: true };
}

// ---- saved blocks -----------------------------------------------------------------------------------------------------

interface SavedBlockOut { blockId: string; name: string; block: Block; shared: boolean; updatedAt: number }

function savedOut(r: Row): SavedBlockOut {
  let block: Block = { type: "text", props: {} };
  try { const v: unknown = JSON.parse(str(r.block)); if (isBlock(v)) block = v; } catch { /* a damaged row reads as an empty text block */ }
  return { blockId: str(r.id), name: str(r.name), block, shared: r.shared === 1 || r.shared === true, updatedAt: num(r.updated_at) };
}

async function savedBlocksList(ctx: Ctx, _input: unknown): Promise<{ blocks: SavedBlockOut[] }> {
  const rows = many(ctx, "SELECT * FROM email_builder_api_block")
    .filter((r) => r.owner === ctx.principal.id || r.shared === 1)
    .sort((a, b) => str(a.name).localeCompare(str(b.name)) || str(a.id).localeCompare(str(b.id)));
  return { blocks: rows.map(savedOut) };
}

async function savedBlocksSave(ctx: Ctx, input: unknown): Promise<{ block: SavedBlockOut }> {
  const o = rec(ctx, input);
  const name = cleanName(ctx, reqStr(ctx, o, "name"), "saved block");
  const blocks = checkBlocks(ctx, [o.block], 0, { n: 0 }, "/block");
  const block = blocks[0]!;
  if (block.type === "saved") fail(ctx, "validation.bad_input", "A saved block cannot be another saved block.", { field: "block" });
  const sharedIn = o.shared;
  if (sharedIn !== undefined && sharedIn !== null && typeof sharedIn !== "boolean") fail(ctx, "validation.bad_input", "Shared is true or false.", { field: "shared" });
  const blockId = optStr(ctx, o, "blockId");
  const existing = blockId === undefined ? undefined : one(ctx, "SELECT * FROM email_builder_api_block WHERE id = ?", blockId);
  if (blockId !== undefined && (!existing || (existing.owner !== ctx.principal.id && existing.shared !== 1))) fail(ctx, "validation.not_found", "That saved block does not exist.");
  if (existing && existing.owner !== ctx.principal.id) fail(ctx, "permission.no_grant", "Only the person who saved a block can change it.");
  const shared = sharedIn === true ? 1 : sharedIn === false ? 0 : existing ? num(existing.shared) : 0;
  const now = ctx.now();
  const id = existing ? str(existing.id) : nid(ctx, "blk");
  const json = JSON.stringify(block);
  if (json.length > MAX_HTML) fail(ctx, "validation.too_large", "A saved block is at most 1 MB.", { field: "block" });
  if (existing) ctx.db.run("UPDATE email_builder_api_block SET name = ?, block = ?, shared = ?, updated_at = ? WHERE id = ?", name, json, shared, now, id);
  else ctx.db.run("INSERT INTO email_builder_api_block (id, owner, name, block, shared, updated_at) VALUES (?, ?, ?, ?, ?, ?)", id, ctx.principal.id, name, json, shared, now);
  ctx.emit("email_block.saved", `entity/${id}`, { blockId: id, shared: shared === 1 }, { vis: "owner" });
  return { block: savedOut(one(ctx, "SELECT * FROM email_builder_api_block WHERE id = ?", id) ?? {}) };
}

export const compileHandlers = {
  "email_builder.create": (ctx: Ctx, input: unknown) => create(ctx, input),
  "email_builder.get": (ctx: Ctx, input: unknown) => get(ctx, input),
  "email_builder.list": (ctx: Ctx, input: unknown) => list(ctx, input),
  "email_builder.save": (ctx: Ctx, input: unknown) => save(ctx, input),
  "email_builder.versions": (ctx: Ctx, input: unknown) => versions(ctx, input),
  "email_builder.restore_version": (ctx: Ctx, input: unknown) => restoreVersion(ctx, input),
  "email_builder.render": (ctx: Ctx, input: unknown) => render(ctx, input),
  "email_builder.html_set": (ctx: Ctx, input: unknown) => htmlSet(ctx, input),
  "email_builder.ask_diff": (ctx: Ctx, input: unknown) => askDiff(ctx, input),
  "email_builder.send_test": (ctx: Ctx, input: unknown) => sendTest(ctx, input),
  "email_builder.merge_fields": (ctx: Ctx, input: unknown) => mergeFields(ctx, input),
  "email_builder.snippets.list": (ctx: Ctx, input: unknown) => snippetsList(ctx, input),
  "email_builder.snippets.save": (ctx: Ctx, input: unknown) => snippetsSave(ctx, input),
  "email_builder.snippets.delete": (ctx: Ctx, input: unknown) => snippetsDelete(ctx, input),
  "email_builder.saved_blocks.list": (ctx: Ctx, input: unknown) => savedBlocksList(ctx, input),
  "email_builder.saved_blocks.save": (ctx: Ctx, input: unknown) => savedBlocksSave(ctx, input),
};
