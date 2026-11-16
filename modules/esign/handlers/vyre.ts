// esign: built-in signing (provider `vyre`), the server side of SIGN-CONTRACT-R33. In process, no container, no outside service, no account, no mailbox needed.
// esign.send makes an envelope, one link per signer (a 256-bit token, only its SHA-256 stored) and returns the links; it emails them when the Space has a sending mailbox.
// The public calls (esign.signer_view, signer_doc, signer_act) are run by the host for /p/sign/<token>/ as itself: the token is the only credential, it reaches one signer of one envelope, and every
// bad, used, expired or revoked token gets the same refusal. The last signature stamps the file, appends the audit page and saves "<title> (signed).pdf" beside the original, never over it.
// @reads ../migrations/0002_esign_vyre.sql

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import {
  PROVIDER_KEYS,
  assigneeOf,
  defaultProvider,
  fail,
  finishTask,
  fromBase64,
  isNull,
  many,
  mustEnvelope,
  nid,
  num,
  one,
  optStr,
  providerKey,
  providerOf,
  rec,
  reqStr,
  soft,
  str,
  subject,
  tellThread,
  toBase64,
} from "./send.ts";
import type { EnvelopeRow, EnvelopeStatus, ProviderKey } from "./send.ts";
import { MAX_PAGES, PdfError, drawable, finalize, pngSize, prepare } from "./pdf.ts";
import type { Audit, Place, SignatureMark, Stamp } from "./pdf.ts";

export const MAX_VYRE_BYTES = 20 * 1024 * 1024;
export const DEFAULT_DAYS = 30;
export const MAX_DAYS = 90;
const MAX_SIGNERS = 20;
const COPY_WINDOW_MS = 24 * 3600_000;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const EMAIL = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]{2,}$/;
export const CONSENT =
  "I agree to sign this document electronically. The sender will keep my signature, name, email if given, the time and the internet address I sign from with the document.";
export const REFUSAL = "This link is not valid. Ask the person who sent it for a new one.";

export interface Visitor {
  ip?: string | undefined;
  ua?: string | undefined;
}
export interface SigningConfig {
  /** The Space's public address (no trailing slash), or null when it has none. */
  publicBase?: (() => string | null) | undefined;
}
let configured: SigningConfig = {};
/** Tests pass their own. */
export function configureSigning(c: SigningConfig | null): void {
  configured = c ?? {};
}

/** What the daemon hands this module at boot (through hostSeams): the address people outside reach the Space at, read each time it is needed. Null at shutdown. */
export interface EsignHost {
  publicBase?: string | undefined;
}
export function setEsignHost(h: EsignHost | null): void {
  configured = h === null ? {} : { publicBase: () => h.publicBase ?? null };
}

type Row = Record<string, unknown>;

// ---- small helpers ------------------------------------------------------------------------------------------

async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const d = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

function newToken(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(32));
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

const bytesOf = (v: unknown): Uint8Array => (v instanceof Uint8Array ? v : new Uint8Array(0));
const clip = (v: string | undefined, n: number): string | null => (v === undefined || v === "" ? null : v.slice(0, n));

function event(ctx: Ctx, envelopeId: string, idx: number | null, kind: string, v?: Visitor, detail?: string): void {
  ctx.db.run(
    "INSERT INTO esign_event (envelope_id, signer_idx, at, kind, ip, ua, detail) VALUES (?, ?, ?, ?, ?, ?, ?)",
    envelopeId,
    idx,
    ctx.now(),
    kind,
    clip(v?.ip, 64),
    clip(v?.ua, 300),
    detail ?? null,
  );
}

interface SpaceInfo {
  name: string;
  zone: string;
}
async function spaceInfo(ctx: Ctx): Promise<SpaceInfo> {
  try {
    const r = (await ctx.call("spaces.get", {})) as { space?: { name?: unknown; timezone?: unknown } };
    return {
      name: typeof r.space?.name === "string" && r.space.name !== "" ? r.space.name : "Your Space",
      zone: typeof r.space?.timezone === "string" && r.space.timezone !== "" ? r.space.timezone : "UTC",
    };
  } catch {
    return { name: "Your Space", zone: "UTC" };
  }
}

async function senderName(ctx: Ctx): Promise<string> {
  try {
    const who = ctx.actingFor ? { kind: "person", id: ctx.actingFor } : { kind: ctx.principal.kind, id: ctx.principal.id };
    const r = (await ctx.call("access.principals.get", { principal: who })) as { principal?: { name?: unknown } };
    if (typeof r.principal?.name === "string" && r.principal.name.trim() !== "") return r.principal.name.trim();
  } catch {
    /* the sender's name is for the page; a missing one must not stop a send */
  }
  return "Someone";
}

function pathOf(token: string): string {
  return `/p/sign/${token}/`;
}
function urlOf(path: string): string | undefined {
  const base = (configured.publicBase?.() ?? "").replace(/\/+$/, "");
  return base === "" ? undefined : `${base}${path}`;
}

export interface Link {
  index: number;
  name: string;
  email?: string;
  url?: string;
  path: string;
}
const linkOf = (idx: number, name: string, email: string | null, token: string): Link => {
  const path = pathOf(token);
  const url = urlOf(path);
  return { index: idx, name, ...(email ? { email } : {}), ...(url ? { url } : {}), path };
};

// ---- mail (through the product's one send pipeline; never a failure for lack of mail) ----------------------------

const NO_MAILBOX = "This Space has no sending mailbox, so nothing was emailed. Copy each link and send it yourself.";
const NO_ADDRESS =
  "This Space has no public address yet, so the links cannot be emailed. Copy each link and send it yourself once the Space has an address.";

interface MailPlan {
  mailboxId: string;
  provider?: string;
}
async function mailPlan(ctx: Ctx): Promise<MailPlan | null> {
  try {
    const r = (await ctx.call("comms.senders.list", { channel: "email" })) as {
      senders?: { id: string; scope?: string; usable?: boolean; provider?: string }[];
    };
    const usable = (r.senders ?? []).filter((s) => s.usable);
    const s = usable.find((x) => x.scope === "space") ?? usable[0];
    return s ? { mailboxId: s.id, ...(s.provider ? { provider: s.provider } : {}) } : null;
  } catch {
    return null;
  }
}

async function invite(
  ctx: Ctx,
  plan: MailPlan,
  env: { id: string; title: string; message: string | null; expiresAt: number; senderName: string },
  space: SpaceInfo,
  who: { name: string; email: string },
  link: Link,
  key: string,
): Promise<boolean> {
  if (!link.url) return false;
  const until = new Intl.DateTimeFormat("en-GB", { timeZone: space.zone, day: "numeric", month: "long", year: "numeric" }).format(
    new Date(env.expiresAt),
  );
  const text = [
    `${env.senderName} at ${space.name} asked you to sign "${env.title}".`,
    ...(env.message ? ["", env.message] : []),
    "",
    `Review and sign: ${link.url}`,
    "",
    `This link is yours; please do not forward it. It stops working on ${until}.`,
  ].join("\n");
  try {
    const sent = (await ctx.call("mail.send", {
      mailboxId: plan.mailboxId,
      senderId: plan.mailboxId,
      ...(plan.provider === "resend" || plan.provider === "mailgun" ? { route: "space_domain" } : {}),
      to: [{ address: who.email }],
      subject: `${env.senderName} asked you to sign ${env.title}`,
      text,
      idempotencyKey: key,
    })) as { status?: string };
    return sent.status === "queued" || sent.status === "sent";
  } catch (e) {
    ctx.log.warn("esign: the invitation could not be sent", { error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

// ---- reading what the sender gave ---------------------------------------------------------------------------

interface VSigner {
  name: string;
  email: string | null;
  order: number;
}
function readSigners(ctx: Ctx, raw: unknown): VSigner[] {
  if (!Array.isArray(raw) || raw.length === 0)
    fail(ctx, "validation.bad_input", "Add at least one signer.", { field: "signers" });
  if (raw.length > MAX_SIGNERS)
    fail(ctx, "validation.too_large", `A document can have at most ${MAX_SIGNERS} signers.`, { field: "signers" });
  const seen = new Set<string>();
  return raw.map((s, i): VSigner => {
    if (typeof s !== "object" || s === null)
      fail(ctx, "validation.bad_input", "Each signer needs a name.", { field: "signers" });
    const o = s as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (name.length === 0 || name.length > 200)
      fail(ctx, "validation.bad_input", `Signer ${i + 1} needs a name.`, { field: "signers" });
    let email: string | null = null;
    if (o.email !== undefined && o.email !== null && o.email !== "") {
      email = typeof o.email === "string" ? o.email.trim().toLowerCase() : "";
      if (email.length > 254 || !EMAIL.test(email))
        fail(ctx, "validation.bad_input", `Signer ${i + 1} has an email that is not valid.`, { field: "signers" });
      if (seen.has(email)) fail(ctx, "validation.duplicate", `${email} is listed twice.`, { field: "signers" });
      seen.add(email);
    }
    const order = o.order === undefined || o.order === null ? 1 : o.order;
    if (typeof order !== "number" || !Number.isInteger(order) || order < 1 || order > MAX_SIGNERS)
      fail(ctx, "validation.bad_input", `Signer ${i + 1} has an order that cannot be used.`, { field: "signers" });
    return { name, email, order };
  });
}

function readPlaces(ctx: Ctx, raw: unknown): Place[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) fail(ctx, "validation.bad_input", "The signing places are not valid.", { field: "places" });
  if (raw.length > 400) fail(ctx, "validation.too_large", "Too many signing places.", { field: "places" });
  return raw.map((p): Place => {
    const o = p as Record<string, unknown>;
    const kind = o.kind;
    const ok =
      typeof o === "object" &&
      (kind === "signature" || kind === "date") &&
      [o.signer, o.page].every((n) => typeof n === "number" && Number.isInteger(n)) &&
      [o.x, o.y, o.w, o.h].every((n) => typeof n === "number" && Number.isFinite(n));
    if (!ok) fail(ctx, "validation.bad_input", "The signing places are not valid.", { field: "places" });
    return o as unknown as Place;
  });
}

// ---- esign.send ---------------------------------------------------------------------------------------------

export async function sendVyre(ctx: Ctx, input: unknown): Promise<Row> {
  const o = rec(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  const recordId = optStr(ctx, o, "recordId");
  const signers = readSigners(ctx, o.signers);
  const places = readPlaces(ctx, o.places);
  const message = optStr(ctx, o, "message")?.trim() || null;
  if (message && message.length > 1000)
    fail(ctx, "validation.too_large", "The message can be at most 1000 characters.", { field: "message" });
  const days = o.expiresInDays === undefined || o.expiresInDays === null ? DEFAULT_DAYS : o.expiresInDays;
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > MAX_DAYS)
    fail(ctx, "validation.bad_input", `A signing link can last from 1 to ${MAX_DAYS} days.`, { field: "expiresInDays" });

  const meta = (await ctx.call("files.get", { fileId })) as {
    file?: { name?: string; mime?: string; folderId?: string; size?: number };
  };
  const file = meta.file;
  if (!file || typeof file.name !== "string") fail(ctx, "validation.not_found", "That file does not exist.");
  const lower = file.name.toLowerCase();
  if (/\.(docx?|dotx?|odt|rtf)$/.test(lower) || /word|opendocument\.text/.test(file.mime ?? ""))
    fail(ctx, "validation.bad_input", "Word documents cannot be signed yet. Export it as a PDF first.", { field: "fileId" });
  if (file.mime !== "application/pdf" && !lower.endsWith(".pdf"))
    fail(ctx, "validation.bad_input", "Only PDF files can be sent for signature. Export the document as a PDF first.", {
      field: "fileId",
    });
  if (typeof file.size === "number" && file.size > MAX_VYRE_BYTES)
    fail(ctx, "validation.too_large", "Built-in signing takes a PDF up to 20 MB. Make it smaller, or send it with Dropbox Sign or DocuSign.", {
      field: "fileId",
    });
  const body = (await ctx.call("files.read", { fileId, as: "base64" })) as { base64?: string; truncated?: boolean };
  if (typeof body.base64 !== "string" || body.truncated === true)
    fail(ctx, "validation.too_large", "The whole file could not be read for sending.", { field: "fileId" });
  const original = fromBase64(body.base64);
  if (original.length === 0 || original.length > MAX_VYRE_BYTES)
    fail(ctx, "validation.too_large", "Built-in signing takes a PDF up to 20 MB.", { field: "fileId" });

  const title = file.name.replace(/\.pdf$/i, "");
  let prepared;
  try {
    prepared = await prepare(original, signers, places, title);
  } catch (e) {
    if (e instanceof PdfError) fail(ctx, "validation.bad_input", e.message, { field: "fileId" });
    throw e;
  }
  if (prepared.pages.length > MAX_PAGES)
    fail(ctx, "validation.too_large", `Built-in signing takes a PDF up to ${MAX_PAGES} pages.`, { field: "fileId" });
  const space = await spaceInfo(ctx);
  const sender = await senderName(ctx);
  const originalSha = await sha256Hex(original);
  const sentSha = await sha256Hex(prepared.pdf);

  const now = ctx.now();
  const envelopeId = nid(ctx, "env");
  const expiresAt = now + days * 86_400_000;
  ctx.db.run(
    "INSERT INTO esign_envelope (id, provider, provider_ref, title, file_id, folder_id, record_id, status, task_id, thread_id, signed_file_id, certificate_file_id, created_by, created_at, updated_at, expires_at, message, original_sha256, sent_sha256, sender_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    envelopeId,
    "vyre",
    envelopeId,
    title,
    fileId,
    file.folderId ?? null,
    recordId ?? null,
    "sent",
    null,
    ctx.thread ?? null,
    null,
    null,
    ctx.principal.id,
    now,
    now,
    expiresAt,
    message,
    originalSha,
    sentSha,
    sender,
  );
  ctx.db.run(
    "INSERT INTO esign_doc (envelope_id, sent, final, places, pages) VALUES (?, ?, ?, ?, ?)",
    envelopeId,
    prepared.pdf,
    null,
    JSON.stringify(prepared.places),
    JSON.stringify(prepared.pages),
  );
  const tokens: string[] = [];
  for (let i = 0; i < signers.length; i++) {
    const token = newToken();
    tokens.push(token);
    ctx.db.run(
      "INSERT INTO esign_vsigner (envelope_id, idx, name, email, order_no, status, token_hash, token_made_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      envelopeId,
      i,
      signers[i]!.name,
      signers[i]!.email,
      signers[i]!.order,
      "sent",
      await sha256Hex(token),
      now,
    );
  }
  event(ctx, envelopeId, null, "sent");

  const links = signers.map((s, i) => linkOf(i, s.name, s.email, tokens[i]!));
  // invitations: to the signers whose turn it is and who have an email, when the Space can send mail
  const lowest = Math.min(...signers.map((s) => s.order));
  const wanting = signers.map((s, i) => ({ s, i })).filter(({ s }) => s.email !== null && s.order === lowest);
  const emailed: string[] = [];
  let notice: string | undefined;
  const plan = await mailPlan(ctx);
  if (plan === null) notice = NO_MAILBOX;
  else if (!links[0]?.url) notice = NO_ADDRESS;
  else {
    for (const { s, i } of wanting) {
      const ok = await invite(
        ctx,
        plan,
        { id: envelopeId, title, message, expiresAt, senderName: sender },
        space,
        { name: s.name, email: s.email as string },
        links[i]!,
        `esign-invite-${envelopeId}-${i}-0`,
      );
      if (ok) {
        emailed.push(s.email as string);
        event(ctx, envelopeId, i, "mailed");
      }
    }
    if (emailed.length === 0 && wanting.length > 0) notice = "The invitation emails could not be sent. Copy each link and send it yourself.";
    else if (wanting.length === 0) notice = "No signer has an email, so nothing was emailed. Copy each link and send it yourself.";
  }

  const who = assigneeOf(ctx);
  if (who) {
    await soft(ctx, "opening the signature task", async () => {
      const made = (await ctx.call("tasks.create", {
        idempotencyKey: `esign-task-${envelopeId}`,
        kind: "signature",
        title: `Waiting for ${signers.map((s) => s.name).join(", ")} to sign ${title}`,
        assigned: who,
        fileIds: [fileId],
        ...(recordId ? { recordId } : {}),
        ...(ctx.run ? { source: { kind: "run", id: ctx.run } } : {}),
      })) as { task?: { id?: string; taskId?: string } };
      const taskId = made.task?.id ?? made.task?.taskId;
      if (typeof taskId === "string") ctx.db.run("UPDATE esign_envelope SET task_id = ? WHERE id = ?", taskId, envelopeId);
    });
  }
  const env = mustEnvelope(ctx, envelopeId);
  await tellThread(
    ctx,
    env,
    `Sent ${title} for signature to ${signers.map((s) => (s.email ? `${s.name} (${s.email})` : s.name)).join(", ")} with built-in signing.`,
    "sig-sent",
  );
  ctx.emit("signature.sent", subject(envelopeId), { envelopeId, ...(recordId ? { recordId } : {}), provider: "vyre" });
  return { envelopeId, links, emailed, ...(notice ? { notice } : {}) };
}

// ---- esign.remind -------------------------------------------------------------------------------------------

export async function remind(ctx: Ctx, input: unknown): Promise<Row> {
  const o = rec(ctx, input);
  const env = vyreEnvelope(ctx, reqStr(ctx, o, "envelopeId"));
  expire(ctx, env);
  const open = one(ctx, "SELECT status FROM esign_envelope WHERE id = ?", env.id);
  if (str(open?.status) !== "sent" && str(open?.status) !== "viewed")
    fail(ctx, "validation.precondition_failed", `This envelope is ${str(open?.status)}. It cannot be reminded.`);
  const idx = o.signer;
  if (typeof idx !== "number" || !Number.isInteger(idx)) fail(ctx, "validation.bad_input", "Choose a signer.", { field: "signer" });
  const s = one(ctx, "SELECT * FROM esign_vsigner WHERE envelope_id = ? AND idx = ?", env.id, idx);
  if (!s) fail(ctx, "validation.not_found", "That signer is not on this envelope.", { field: "signer" });
  if (str(s.status) !== "sent" && str(s.status) !== "viewed")
    fail(ctx, "validation.precondition_failed", `${str(s.name)} has already ${str(s.status) === "signed" ? "signed" : "answered"}.`);
  const token = newToken();
  ctx.db.run(
    "UPDATE esign_vsigner SET token_hash = ?, token_made_at = ? WHERE envelope_id = ? AND idx = ?",
    await sha256Hex(token),
    ctx.now(),
    env.id,
    idx,
  );
  event(ctx, env.id, idx, "reminded");
  const email = isNull(s.email) ? null : str(s.email);
  const link = linkOf(idx, str(s.name), email, token);
  const full = one(ctx, "SELECT * FROM esign_envelope WHERE id = ?", env.id) as Row;
  const waiting = isWaiting(ctx, env.id, num(s.order_no));
  let emailed = false;
  let notice: string | undefined;
  const plan = await mailPlan(ctx);
  if (email === null) notice = "This signer has no email. Copy the link and send it yourself.";
  else if (plan === null) notice = NO_MAILBOX;
  else if (!link.url) notice = NO_ADDRESS;
  else if (waiting) notice = "This signer waits for an earlier signer. Copy the link and send it when it is their turn.";
  else {
    const space = await spaceInfo(ctx);
    emailed = await invite(
      ctx,
      plan,
      {
        id: env.id,
        title: env.title,
        message: isNull(full.message) ? null : str(full.message),
        expiresAt: num(full.expires_at),
        senderName: str(full.sender_name) || "Someone",
      },
      space,
      { name: str(s.name), email },
      link,
      `esign-invite-${env.id}-${idx}-${ctx.now()}`,
    );
    if (emailed) event(ctx, env.id, idx, "mailed");
    else notice = "The email could not be sent. Copy the link and send it yourself.";
  }
  return { link, emailed, ...(notice ? { notice } : {}) };
}

// ---- envelope lookups, expiry, order ------------------------------------------------------------------------

function vyreEnvelope(ctx: Ctx, envelopeId: string): EnvelopeRow {
  const env = mustEnvelope(ctx, envelopeId);
  if (env.provider !== "vyre") fail(ctx, "validation.not_found", "That envelope does not exist.");
  return env;
}

/** An open envelope past its time ends here, the first time anyone reads it or tries its link. */
function expire(ctx: Ctx, env: { id: string }): void {
  const r = one(ctx, "SELECT status, expires_at FROM esign_envelope WHERE id = ?", env.id);
  if (!r || (str(r.status) !== "sent" && str(r.status) !== "viewed")) return;
  const at = r.expires_at;
  if (typeof at !== "number" || ctx.now() <= at) return;
  const now = ctx.now();
  ctx.db.run("UPDATE esign_envelope SET status = ?, updated_at = ? WHERE id = ?", "expired", now, env.id);
  ctx.db.run(
    "UPDATE esign_vsigner SET status = ? WHERE envelope_id = ? AND status IN (?, ?)",
    "expired",
    env.id,
    "sent",
    "viewed",
  );
  event(ctx, env.id, null, "expired");
}

function isWaiting(ctx: Ctx, envelopeId: string, order: number): boolean {
  return many(ctx, "SELECT status FROM esign_vsigner WHERE envelope_id = ? AND order_no < ?", envelopeId, order).some(
    (r) => str(r.status) !== "signed",
  );
}

// ---- the public side ----------------------------------------------------------------------------------------

const refuse = (ctx: Ctx): never => fail(ctx, "auth.bad_credentials", REFUSAL);

/** The signer a token opens, or null: every reason a token fails is the same null. */
async function byToken(
  ctx: Ctx,
  token: unknown,
  spent = false,
): Promise<{ env: Row; signer: Row } | null> {
  if (typeof token !== "string" || !TOKEN_SHAPE.test(token)) return null;
  const signer = one(ctx, "SELECT * FROM esign_vsigner WHERE token_hash = ?", await sha256Hex(token));
  if (!signer) return null;
  const env = one(ctx, "SELECT * FROM esign_envelope WHERE id = ?", signer.envelope_id);
  if (!env) return null;
  expire(ctx, { id: str(env.id) });
  const fresh = one(ctx, "SELECT * FROM esign_envelope WHERE id = ?", env.id) as Row;
  const mine = one(ctx, "SELECT * FROM esign_vsigner WHERE envelope_id = ? AND idx = ?", env.id, signer.idx) as Row;
  if (spent) return { env: fresh, signer: mine };
  if (str(fresh.status) !== "sent" && str(fresh.status) !== "viewed") return null;
  if (str(mine.status) !== "sent" && str(mine.status) !== "viewed") return null;
  return { env: fresh, signer: mine };
}

export async function signerView(ctx: Ctx, input: unknown): Promise<{ session: Row }> {
  const o = rec(ctx, input);
  const hit = await byToken(ctx, o.token);
  if (!hit) return refuse(ctx);
  const v = (o.visitor ?? {}) as Visitor;
  const { env, signer } = hit;
  const envId = str(env.id);
  const idx = num(signer.idx);
  const first = isNull(signer.viewed_at);
  event(ctx, envId, idx, "opened", v);
  if (first) {
    ctx.db.run("UPDATE esign_vsigner SET viewed_at = ?, status = ? WHERE envelope_id = ? AND idx = ?", ctx.now(), "viewed", envId, idx);
    if (str(env.status) === "sent") ctx.db.run("UPDATE esign_envelope SET status = ?, updated_at = ? WHERE id = ?", "viewed", ctx.now(), envId);
    ctx.emit("signature.viewed", subject(envId), { envelopeId: envId, signer: str(signer.name) });
  }
  const space = await spaceInfo(ctx);
  const base = {
    spaceName: space.name,
    sender: { name: str(env.sender_name) || "Someone" },
    title: str(env.title),
    message: isNull(env.message) ? null : str(env.message),
    signer: { name: str(signer.name), email: isNull(signer.email) ? null : str(signer.email) },
    expiresAt: num(env.expires_at),
    zone: space.zone,
  };
  if (isWaiting(ctx, envId, num(signer.order_no))) return { session: { state: "waiting", ...base } };
  const doc = one(ctx, "SELECT places, pages FROM esign_doc WHERE envelope_id = ?", envId) as Row;
  const places = (JSON.parse(str(doc.places)) as Place[])
    .map((p, n) => ({ id: `p${n}`, ...p }))
    .filter((p) => p.signer === idx)
    .map(({ signer: _s, ...rest }) => rest);
  return {
    session: { state: "ready", ...base, pages: JSON.parse(str(doc.pages)), places, consent: CONSENT },
  };
}

export async function signerDoc(ctx: Ctx, input: unknown): Promise<{ base64: string }> {
  const o = rec(ctx, input);
  const hit = await byToken(ctx, o.token);
  if (!hit || isWaiting(ctx, str(hit.env.id), num(hit.signer.order_no))) return refuse(ctx);
  const doc = one(ctx, "SELECT sent FROM esign_doc WHERE envelope_id = ?", hit.env.id) as Row;
  event(ctx, str(hit.env.id), num(hit.signer.idx), "doc_fetched", (o.visitor ?? {}) as Visitor);
  return { base64: toBase64(bytesOf(doc.sent)) };
}

function markOf(ctx: Ctx, raw: unknown): { mark: SignatureMark; kind: string; text: string | null; png: Uint8Array | null } {
  const s = (raw ?? {}) as Record<string, unknown>;
  if (s.kind === "typed") {
    const text = typeof s.text === "string" ? s.text.trim() : "";
    if (text.length === 0 || text.length > 200) fail(ctx, "validation.bad_input", "Type your signature.", { field: "signature" });
    if (!drawable(text))
      fail(ctx, "validation.bad_input", "That name has a letter a typed signature cannot show. Use Draw instead.", { field: "signature" });
    return { mark: { kind: "typed", text }, kind: "typed", text, png: null };
  }
  if (s.kind === "drawn") {
    const b64 = typeof s.png === "string" ? s.png : "";
    if (b64.length === 0 || b64.length > 420 * 1024 || !/^[A-Za-z0-9+/=]+$/.test(b64))
      fail(ctx, "validation.bad_input", "Draw your signature again.", { field: "signature" });
    const png = fromBase64(b64);
    if (!pngSize(png)) fail(ctx, "validation.bad_input", "That drawing is not a picture this page can use. Draw it again.", { field: "signature" });
    return { mark: { kind: "drawn", png }, kind: "drawn", text: null, png };
  }
  return fail(ctx, "validation.bad_input", "Type or draw your signature.", { field: "signature" });
}

export async function signerAct(ctx: Ctx, input: unknown): Promise<{ result: Row }> {
  const o = rec(ctx, input);
  const v = (o.visitor ?? {}) as Visitor;
  const body = (o.body ?? {}) as Record<string, unknown>;
  if (o.op === "copy") return { result: await copyOf(ctx, o.token, v) };
  const hit = await byToken(ctx, o.token);
  if (!hit || isWaiting(ctx, str(hit.env.id), num(hit.signer.order_no))) return refuse(ctx);
  const envId = str(hit.env.id);
  const idx = num(hit.signer.idx);
  const now = ctx.now();
  if (o.op === "decline") {
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    ctx.db.run("UPDATE esign_vsigner SET status = ? WHERE envelope_id = ? AND idx = ?", "declined", envId, idx);
    ctx.db.run(
      "UPDATE esign_vsigner SET status = ?, token_hash = NULL WHERE envelope_id = ? AND status IN (?, ?)",
      "cancelled",
      envId,
      "sent",
      "viewed",
    );
    ctx.db.run(
      "UPDATE esign_envelope SET status = ?, declined_reason = ?, updated_at = ? WHERE id = ?",
      "declined",
      reason || null,
      now,
      envId,
    );
    event(ctx, envId, idx, "declined", v, reason || undefined);
    const env = mustEnvelope(ctx, envId);
    ctx.emit("signature.declined", subject(envId), { envelopeId: envId, signer: str(hit.signer.name), ...(reason ? { reason } : {}) });
    await finishTask(ctx, env, "canceled", `${str(hit.signer.name)} declined to sign.`);
    await tellThread(ctx, env, `${str(hit.signer.name)} declined to sign ${env.title}${reason ? `: ${reason}` : "."}`, "sig-declined");
    return { result: { state: "declined" } };
  }
  if (o.op !== "sign") fail(ctx, "validation.bad_input", "That is not something a signing link does.");
  if (body.consent !== true) fail(ctx, "validation.bad_input", "Tick the box to agree to sign electronically.", { field: "consent" });
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length === 0 || name.length > 200) fail(ctx, "validation.bad_input", "Type your name.", { field: "name" });
  const sig = markOf(ctx, body.signature);
  ctx.db.run(
    "UPDATE esign_vsigner SET status = ?, signed_at = ?, signed_name = ?, sig_kind = ?, sig_text = ?, sig_png = ? WHERE envelope_id = ? AND idx = ? AND status IN (?, ?)",
    "signed",
    now,
    name,
    sig.kind,
    sig.text,
    sig.png,
    envId,
    idx,
    "sent",
    "viewed",
  );
  event(ctx, envId, idx, "signed", v);
  const left = many(ctx, "SELECT idx FROM esign_vsigner WHERE envelope_id = ? AND status != ?", envId, "signed");
  if (left.length > 0) return { result: { state: "signed", completed: false, copyAvailable: false } };
  await complete(ctx, envId);
  return { result: { state: "signed", completed: true, copyAvailable: true } };
}

/** The last signature is in: stamp, append the audit page, keep the bytes, save the file beside the original, tell everyone. */
async function complete(ctx: Ctx, envId: string): Promise<void> {
  const env = one(ctx, "SELECT * FROM esign_envelope WHERE id = ?", envId) as Row;
  const doc = one(ctx, "SELECT * FROM esign_doc WHERE envelope_id = ?", envId) as Row;
  const signers = many(ctx, "SELECT * FROM esign_vsigner WHERE envelope_id = ? ORDER BY idx", envId);
  const space = await spaceInfo(ctx);
  const trail = (idx: number, kind: string, first: boolean): Row | undefined =>
    one(
      ctx,
      `SELECT * FROM esign_event WHERE envelope_id = ? AND signer_idx = ? AND kind = ? ORDER BY seq ${first ? "ASC" : "DESC"} LIMIT 1`,
      envId,
      idx,
      kind,
    );
  const stamps: Stamp[] = signers.map((s) => ({
    signer: num(s.idx),
    name: str(s.signed_name) || str(s.name),
    email: isNull(s.email) ? null : str(s.email),
    mark:
      str(s.sig_kind) === "drawn"
        ? { kind: "drawn", png: bytesOf(s.sig_png) }
        : { kind: "typed", text: str(s.sig_text) },
    signedAt: num(s.signed_at),
  }));
  const audit: Audit = {
    title: str(env.title),
    envelopeId: envId,
    senderName: str(env.sender_name) || "Someone",
    sentAt: num(env.created_at),
    zone: space.zone,
    originalSha256: str(env.original_sha256),
    sentSha256: str(env.sent_sha256),
    signers: signers.map((s) => {
      const opened = trail(num(s.idx), "opened", true);
      const signed = trail(num(s.idx), "signed", false);
      return {
        name: str(s.signed_name) || str(s.name),
        email: isNull(s.email) ? null : str(s.email),
        openedAt: opened ? num(opened.at) : null,
        openedIp: opened && !isNull(opened.ip) ? str(opened.ip) : null,
        openedUa: opened && !isNull(opened.ua) ? str(opened.ua) : null,
        signedAt: num(s.signed_at),
        signedIp: signed && !isNull(signed.ip) ? str(signed.ip) : null,
        signedUa: signed && !isNull(signed.ua) ? str(signed.ua) : null,
        kind: str(s.sig_kind),
      };
    }),
  };
  const finalPdf = await finalize(bytesOf(doc.sent), JSON.parse(str(doc.places)) as Place[], stamps, audit);
  const finalSha = await sha256Hex(finalPdf);
  const now = ctx.now();
  ctx.db.run("UPDATE esign_doc SET final = ? WHERE envelope_id = ?", finalPdf, envId);
  ctx.db.run(
    "UPDATE esign_envelope SET status = ?, final_sha256 = ?, updated_at = ? WHERE id = ?",
    "signed",
    finalSha,
    now,
    envId,
  );
  event(ctx, envId, null, "finalized", undefined, finalSha);
  const row = mustEnvelope(ctx, envId);
  const fileId = await saveFinal(ctx, row, finalPdf);
  ctx.emit("signature.signed", subject(envId), { envelopeId: envId, fileId: fileId ?? row.fileId });
  await finishTask(ctx, row, "done", "Everyone signed.");
  await tellThread(
    ctx,
    row,
    `${row.title} is signed by ${signers.map((s) => str(s.signed_name) || str(s.name)).join(", ")}. The signed PDF is saved beside the original${fileId ? "" : " as soon as Files can take it; ask for it again with Fetch signed"}.`,
    "sig-signed",
  );
}

/** Writes "<title> (signed).pdf" beside the original (in the record's folder when there is one); never over the original. Null when Files could not take it: the bytes stay and a later fetch saves them. */
async function saveFinal(ctx: Ctx, env: EnvelopeRow, pdf: Uint8Array): Promise<string | null> {
  let folderId = env.folderId;
  if (env.recordId !== null) {
    try {
      const f = (await ctx.call("projects.files_folder", { recordId: env.recordId })) as { folderId?: string | null };
      if (typeof f.folderId === "string") folderId = f.folderId;
    } catch {
      /* the record has no folder: the original's folder it is */
    }
  }
  if (folderId === null) return null;
  try {
    const made = (await ctx.call("files.create", {
      idempotencyKey: `esign-final-${env.id}`,
      folderId,
      name: `${env.title} (signed).pdf`,
      content: { base64: toBase64(pdf) },
      mime: "application/pdf",
    })) as { file?: { fileId?: string } };
    const id = made.file?.fileId;
    if (typeof id !== "string") return null;
    ctx.db.run("UPDATE esign_envelope SET signed_file_id = ?, updated_at = ? WHERE id = ?", id, ctx.now(), env.id);
    return id;
  } catch (e) {
    ctx.log.warn("esign: the signed file could not be saved", { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** The one call a spent link still answers: the signer's own copy, for a day after they signed. */
async function copyOf(ctx: Ctx, token: unknown, v: Visitor): Promise<Row> {
  const hit = await byToken(ctx, token, true);
  if (!hit || str(hit.signer.status) !== "signed" || ctx.now() - num(hit.signer.signed_at) > COPY_WINDOW_MS) return refuse(ctx);
  const envId = str(hit.env.id);
  if (str(hit.env.status) !== "signed") return { state: "waiting" };
  const doc = one(ctx, "SELECT final FROM esign_doc WHERE envelope_id = ?", envId) as Row;
  const bytes = bytesOf(doc.final);
  if (bytes.length === 0) return { state: "waiting" };
  event(ctx, envId, num(hit.signer.idx), "copy", v);
  return { state: "done", base64: toBase64(bytes) };
}

// ---- the sender's side: status, list, cancel, fetch, providers, health --------------------------------------

export async function statusVyre(ctx: Ctx, envelopeId: string): Promise<Row> {
  vyreEnvelope(ctx, envelopeId);
  expire(ctx, { id: envelopeId });
  const env = one(ctx, "SELECT * FROM esign_envelope WHERE id = ?", envelopeId) as Row;
  const signers = many(ctx, "SELECT * FROM esign_vsigner WHERE envelope_id = ? ORDER BY order_no, idx", envelopeId).map((s) => ({
    name: str(s.name),
    ...(isNull(s.email) ? {} : { email: str(s.email) }),
    status: str(s.status) as EnvelopeStatus,
    order: num(s.order_no),
    ...(isNull(s.viewed_at) ? {} : { openedAt: num(s.viewed_at) }),
    ...(isNull(s.signed_at) ? {} : { signedAt: num(s.signed_at) }),
  }));
  return {
    status: str(env.status),
    ...(isNull(env.expires_at) ? {} : { expiresAt: num(env.expires_at) }),
    ...(isNull(env.declined_reason) ? {} : { declinedReason: str(env.declined_reason) }),
    ...(isNull(env.signed_file_id) ? {} : { signedFileId: str(env.signed_file_id) }),
    ...(isNull(env.final_sha256) ? {} : { finalSha256: str(env.final_sha256) }),
    signers,
  };
}

export async function cancelVyre(ctx: Ctx, envelopeId: string): Promise<{ cancelled: true }> {
  const env = vyreEnvelope(ctx, envelopeId);
  expire(ctx, env);
  const st = str(one(ctx, "SELECT status FROM esign_envelope WHERE id = ?", envelopeId)?.status);
  if (st === "cancelled") return { cancelled: true };
  if (st !== "sent" && st !== "viewed") fail(ctx, "validation.precondition_failed", `This envelope is already ${st}. It cannot be cancelled.`);
  ctx.db.run("UPDATE esign_envelope SET status = ?, updated_at = ? WHERE id = ?", "cancelled", ctx.now(), envelopeId);
  ctx.db.run(
    "UPDATE esign_vsigner SET status = ? WHERE envelope_id = ? AND status IN (?, ?)",
    "cancelled",
    envelopeId,
    "sent",
    "viewed",
  );
  ctx.db.run("UPDATE esign_vsigner SET token_hash = NULL WHERE envelope_id = ? AND status != ?", envelopeId, "signed");
  event(ctx, envelopeId, null, "cancelled");
  ctx.emit("signature.cancelled", subject(envelopeId), { envelopeId });
  await finishTask(ctx, env, "canceled", "The envelope was cancelled.");
  await tellThread(ctx, env, `Cancelled the signature request for ${env.title}.`, "sig-cancel");
  return { cancelled: true };
}

export async function fetchVyre(ctx: Ctx, envelopeId: string): Promise<{ fileId: string }> {
  const env = vyreEnvelope(ctx, envelopeId);
  if (env.status !== "signed") fail(ctx, "validation.precondition_failed", "Not every signer has signed yet.", { state: env.status });
  if (env.signedFileId !== null) return { fileId: env.signedFileId };
  const doc = one(ctx, "SELECT final FROM esign_doc WHERE envelope_id = ?", envelopeId) as Row;
  const id = await saveFinal(ctx, env, bytesOf(doc.final));
  if (id === null) fail(ctx, "provider.unavailable", "The signed file could not be saved to Files just now. Try again in a minute.");
  return { fileId: id };
}

export async function listAll(ctx: Ctx, input: unknown): Promise<{ envelopes: Row[] }> {
  const o = rec(ctx, input);
  const recordId = optStr(ctx, o, "recordId");
  const fileId = optStr(ctx, o, "fileId");
  const wanted = optStr(ctx, o, "status");
  for (const r of many(ctx, "SELECT id FROM esign_envelope WHERE provider = ? AND status IN (?, ?) AND expires_at < ?", "vyre", "sent", "viewed", ctx.now()))
    expire(ctx, { id: str(r.id) });
  let rows = many(ctx, "SELECT * FROM esign_envelope");
  if (recordId !== undefined) rows = rows.filter((r) => str(r.record_id) === recordId);
  if (fileId !== undefined) rows = rows.filter((r) => str(r.file_id) === fileId);
  if (wanted !== undefined) rows = rows.filter((r) => str(r.status) === wanted);
  rows.sort((a, b) => num(b.created_at) - num(a.created_at) || str(b.id).localeCompare(str(a.id)));
  return {
    envelopes: rows.map((r) => ({
      envelopeId: str(r.id),
      title: str(r.title),
      status: str(r.status),
      provider: str(r.provider),
      ...(isNull(r.record_id) ? {} : { recordId: str(r.record_id) }),
      fileId: str(r.file_id),
      ...(isNull(r.signed_file_id) ? {} : { signedFileId: str(r.signed_file_id) }),
      createdAt: num(r.created_at),
      ...(isNull(r.expires_at) ? {} : { expiresAt: num(r.expires_at) }),
    })),
  };
}

const TITLES: Record<ProviderKey, string> = {
  vyre: "Vyre signing",
  documenso: "Documenso",
  dropbox_sign: "Dropbox Sign",
  docusign: "DocuSign",
};
export const titleOf = (k: ProviderKey): string => TITLES[k];

export async function providersVyre(ctx: Ctx): Promise<Row> {
  const def = defaultProvider(ctx);
  return {
    providers: PROVIDER_KEYS.map((key) => {
      const connected = key === "vyre" || providerOf(key) !== undefined;
      return {
        key,
        title: TITLES[key],
        default: key === def,
        connected,
        ...(connected ? {} : { why: `${TITLES[key]} is not connected. Connect it in Settings, Connections.` }),
      };
    }),
  };
}

/** Does this call belong to built-in signing: the provider it names, or the Space's default when it names none. */
export function isBuiltIn(ctx: Ctx, key: unknown): boolean {
  if (key === undefined || key === null) return defaultProvider(ctx) === "vyre";
  return providerKey(ctx, key, "provider") === "vyre";
}
