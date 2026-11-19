// SMTP: the third way a Space's own domain sends (owner, 19 Nov 2026: "Mailgun, Railway and SMTP all work so a Space gets its own email").
// Any mail server a person has a username and a password for. The server, port and username are one row (mail_smtp); the password stays in the Vault behind a handle and is
// read at the last moment for one connection; nodemailer carries the bytes (loaded on first use, so a Space that never uses SMTP never loads it).
//
// mail.smtp.set saves the server. mail.smtp.verify opens a connection and signs in without sending anything, and says in plain words what went wrong: a server that cannot open
// mail ports at all (many hosts, Railway among them, block 25, 465 and 587) is told so, with the way out (port 2525, or Mailgun or Resend, which send over HTTPS).
// mail.send calls smtpDeliver below when the Space's sending provider is smtp. Nothing here decides whether to send: the limits, the suppression list and the Gate ran in mail.send.
//
// Vyre signs each message with the domain's own DKIM key (made by mail.domain.add, kept in the Vault), so the DNS record a person publishes is exact whatever the mail server is.
// SMTP reports no delivery events: a message is "sent" when the server accepts it. A bounce comes back as an email to the sender's inbox.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fail } from "../../../host/src/routes/errors.ts";
import { bad, ensure, first, num, statements, str, strOrNull } from "../projections.ts";
import type { MailCtx, Row } from "../projections.ts";

export type Security = "starttls" | "tls";
export type SmtpReason = "blocked" | "refused" | "unknown_host" | "auth" | "tls" | "failed";

export interface SmtpConn {
  host: string;
  port: number;
  security: Security;
  username: string;
  password: string;
}
export interface SmtpMail {
  /** the RFC Message-ID, with its angle brackets */
  messageId: string;
  from: string;
  fromName?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  attachments?: { name: string; mime: string; bytes: Uint8Array }[];
  dkim?: { domain: string; selector: string; privateKey: string };
}
/** The socket. Tests bind a recorded one; production binds nodemailer. */
export interface SmtpTransport {
  verify(conn: SmtpConn): Promise<void>;
  send(conn: SmtpConn, mail: SmtpMail): Promise<{ rejected: string[] }>;
}
/** A Vault value for one use (the mail module's own Vault reader, the one IMAP logs in with). Module code never keeps it. */
export type SmtpSecret = (ctx: MailCtx, handle: string) => Promise<string>;
/** A Space file's bytes for an attachment: the host's half (hostSeams.setMailFileBytes in impl.ts). */
export type MailFileBytes = (
  ctx: Pick<MailCtx, "space" | "trace">,
  fileId: string,
) => Promise<{ name: string; mime: string; bytes: Uint8Array }>;

export interface SmtpOut {
  configured: boolean;
  host?: string;
  port?: number;
  security?: Security;
  username?: string;
  state: "none" | "unchecked" | "ok" | "failed";
  detail?: string;
  checkedAt?: number;
}
export interface VerifyOut {
  ok: boolean;
  reason?: SmtpReason;
  message: string;
  ms: number;
}

// ---- seams

let secretOf: SmtpSecret | null = null;
let fileBytes: MailFileBytes | null = null;
/** impl.ts hands over the Vault reader it already holds for IMAP. */
export function setSmtpSecret(fn: SmtpSecret | null): void {
  secretOf = fn;
}
/** The host registers how a Space file's bytes are read (hostSeams in impl.ts). */
export function setMailFileBytes(fn: MailFileBytes | null): void {
  fileBytes = fn;
}
const bound = new WeakMap<object, SmtpTransport>();
let defaultTransport: SmtpTransport | null = null;
/** Tests bind a recorded transport to one context. */
export function bindSmtp(ctx: MailCtx, t: SmtpTransport): void {
  bound.set(ctx, t);
}
export function setDefaultSmtp(t: SmtpTransport | null): void {
  defaultTransport = t;
}
function transportFor(ctx: MailCtx): SmtpTransport {
  const t = bound.get(ctx) ?? defaultTransport;
  if (!t) throw fail("internal.unavailable", ctx.trace.traceId, { message: "SMTP is not set up on this server." });
  return t;
}

function secret(ctx: MailCtx, handle: string): Promise<string> {
  if (!secretOf)
    throw fail("internal.unavailable", ctx.trace.traceId, { message: "SMTP is not set up on this server." });
  return secretOf(ctx, handle);
}

// ---- nodemailer, loaded on first use

interface NmTransport {
  verify(): Promise<unknown>;
  sendMail(m: Record<string, unknown>): Promise<{ rejected?: unknown[] }>;
  close(): void;
}
type NmCreate = (o: Record<string, unknown>) => NmTransport;
const TIMEOUT_MS = 10_000;

async function open(conn: SmtpConn, dkim?: SmtpMail["dkim"]): Promise<NmTransport> {
  const mod = (await import("nodemailer")) as unknown as {
    createTransport?: NmCreate;
    default?: { createTransport: NmCreate };
  };
  const create = mod.createTransport ?? mod.default?.createTransport;
  if (!create) throw new Error("nodemailer did not load");
  return create({
    host: conn.host,
    port: conn.port,
    secure: conn.security === "tls",
    requireTLS: conn.security === "starttls",
    auth: { user: conn.username, pass: conn.password },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: 2 * TIMEOUT_MS,
    disableFileAccess: true,
    disableUrlAccess: true,
    ...(dkim ? { dkim: { domainName: dkim.domain, keySelector: dkim.selector, privateKey: dkim.privateKey } } : {}),
  });
}

/** The real socket. impl.ts makes it the default; tests bind a recorded one instead. */
export const liveSmtp: SmtpTransport = {
  async verify(conn) {
    const t = await open(conn);
    try {
      await t.verify();
    } finally {
      t.close();
    }
  },
  async send(conn, mail) {
    const t = await open(conn, mail.dkim);
    try {
      const sent = await t.sendMail({
        messageId: mail.messageId,
        from: mail.fromName ? { name: mail.fromName, address: mail.from } : mail.from,
        to: mail.to,
        ...(mail.cc?.length ? { cc: mail.cc } : {}),
        ...(mail.bcc?.length ? { bcc: mail.bcc } : {}),
        ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
        subject: mail.subject,
        ...(mail.text !== undefined ? { text: mail.text } : {}),
        ...(mail.html !== undefined ? { html: mail.html } : {}),
        ...(mail.headers ? { headers: mail.headers } : {}),
        ...(mail.attachments?.length
          ? {
              attachments: mail.attachments.map((a) => ({
                filename: a.name,
                content: Buffer.from(a.bytes),
                contentType: a.mime,
              })),
            }
          : {}),
      });
      return { rejected: (sent.rejected ?? []).map(String) };
    } finally {
      t.close();
    }
  },
};

// ---- the saved server (one row per Space)

const migrationSql = readFileSync(fileURLToPath(new URL("../migrations/0007_mail_smtp.sql", import.meta.url)), "utf8");
const ready = new WeakSet<object>();
const ROW = "space";

export function ensureSmtp(ctx: Pick<MailCtx, "db">): void {
  ensure(ctx);
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT id FROM mail_smtp WHERE id = ?`, "probe");
  } catch {
    for (const statement of statements(migrationSql)) ctx.db.run(statement);
  }
  ready.add(ctx.db);
}

const saved = (ctx: MailCtx): Row | null => first(ctx.db.all(`SELECT * FROM mail_smtp WHERE id = ?`, ROW));

function out(row: Row | null): SmtpOut {
  if (!row) return { configured: false, state: "none" };
  const state = str(row, "state");
  const o: SmtpOut = {
    configured: true,
    host: str(row, "host"),
    port: num(row, "port"),
    security: str(row, "security") === "tls" ? "tls" : "starttls",
    username: str(row, "username"),
    state: state === "ok" || state === "failed" ? state : "unchecked",
  };
  const detail = strOrNull(row, "detail");
  if (detail) o.detail = detail;
  if (typeof row.checkedAt === "number") o.checkedAt = row.checkedAt;
  return o;
}

// ---- what a person may enter

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const HANDLE = /^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;

export interface SmtpIn {
  host?: unknown;
  port?: unknown;
  security?: unknown;
  username?: unknown;
  passwordHandle?: unknown;
}
interface Clean {
  host: string;
  port: number;
  security: Security;
  username: string;
  passwordHandle: string;
}

/** The server as entered, checked. A field left out falls back to the saved one, so a person can test a new port without typing the rest again. */
function clean(ctx: MailCtx, input: SmtpIn, base: Row | null): Clean {
  const hostName = (typeof input.host === "string" ? input.host : base ? str(base, "host") : "").trim().toLowerCase();
  if (!HOSTNAME.test(hostName)) bad(ctx, "Enter the mail server's name, like smtp.example.com.");
  const port = input.port === undefined && base ? num(base, "port") : input.port;
  if (typeof port !== "number" || !Number.isSafeInteger(port) || port < 1 || port > 65535)
    bad(ctx, "The port is a number from 1 to 65535. Most mail servers use 587.");
  const asked = input.security === undefined && base ? str(base, "security") : input.security;
  // the port says how the secure connection starts unless the person chose: 465 is TLS from the first byte, everything else upgrades with STARTTLS
  const security: Security =
    asked === "tls" || asked === "starttls"
      ? asked
      : asked === undefined
        ? port === 465
          ? "tls"
          : "starttls"
        : bad(ctx, "Security is starttls or tls.");
  const username = (typeof input.username === "string" ? input.username : base ? str(base, "username") : "").trim();
  if (!username || username.length > 320) bad(ctx, "Enter the username the mail server gave you.");
  const passwordHandle =
    typeof input.passwordHandle === "string" ? input.passwordHandle : base ? str(base, "passwordHandle") : "";
  if (!HANDLE.test(passwordHandle)) bad(ctx, "Save the password in the Vault and give its handle.");
  return { host: hostName, port: port as number, security, username, passwordHandle };
}

// ---- mail.smtp.get / set

export async function smtpGet(ctx: MailCtx): Promise<SmtpOut> {
  ensureSmtp(ctx);
  return out(saved(ctx));
}

export async function smtpSet(ctx: MailCtx, input: SmtpIn): Promise<SmtpOut> {
  ensureSmtp(ctx);
  const base = saved(ctx);
  const c = clean(ctx, input, base);
  ctx.vault.use(c.passwordHandle); // the person saving it must be able to use that Vault item now: sends log in later as the server
  const now = ctx.now();
  if (base)
    ctx.db.run(
      `UPDATE mail_smtp SET host = ?, port = ?, security = ?, username = ?, "passwordHandle" = ?, state = ?, detail = ?, "checkedAt" = ?, updated_at = ? WHERE id = ?`,
      c.host,
      c.port,
      c.security,
      c.username,
      c.passwordHandle,
      "unchecked",
      null,
      null,
      now,
      ROW,
    );
  else
    ctx.db.run(
      `INSERT INTO mail_smtp (id, host, port, security, username, "passwordHandle", state, detail, "checkedAt", updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ROW,
      c.host,
      c.port,
      c.security,
      c.username,
      c.passwordHandle,
      "unchecked",
      null,
      null,
      now,
    );
  return out(saved(ctx));
}

// ---- mail.smtp.verify

const codeOf = (e: unknown): string => {
  const o = (e ?? {}) as { code?: unknown; error?: { code?: unknown } };
  return typeof o.code === "string" ? o.code : typeof o.error?.code === "string" ? o.error.code : "";
};
const said = (e: unknown): string => {
  const o = (e ?? {}) as { response?: unknown; message?: unknown };
  const line = typeof o.response === "string" ? o.response : typeof o.message === "string" ? o.message : "";
  return (line.split(/\r?\n/)[0] ?? "").trim().slice(0, 200);
};

/** What went wrong, in words a person can act on. The password is never in the text. */
export function explain(
  e: unknown,
  c: { host: string; port: number; security: Security },
): { reason: SmtpReason; message: string } {
  const code = codeOf(e);
  const text = said(e);
  const status = (e as { responseCode?: unknown } | null)?.responseCode;
  if (code === "provider.auth_failed")
    return { reason: "auth", message: text || "The Vault did not release the password." };
  if (code === "EAUTH" || status === 535 || status === 534 || status === 530)
    return { reason: "auth", message: "The mail server did not accept that username and password." };
  if (code === "ENOTFOUND" || code === "EDNS" || code === "EAI_AGAIN")
    return { reason: "unknown_host", message: `No mail server answers at ${c.host}. Check the name.` };
  if (code === "ECONNREFUSED")
    return { reason: "refused", message: `${c.host} refused the connection on port ${c.port}. Check the port.` };
  if (code === "ETLS" || /certificate|ssl routines|wrong version number|self.signed/i.test(text))
    return {
      reason: "tls",
      message:
        c.security === "tls"
          ? `The secure connection to ${c.host} failed. Port 465 starts secure; ports 587 and 2525 use STARTTLS.`
          : `The secure connection to ${c.host} failed. If the port is 465, choose TLS.`,
    };
  if (
    code === "ETIMEDOUT" ||
    code === "ECONNECTION" ||
    code === "ESOCKET" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH" ||
    /timed? ?out|greeting never received/i.test(text)
  )
    return {
      reason: "blocked",
      message: `This server cannot open port ${c.port}. Some hosts, such as Railway, block mail ports. Try port 2525, or send with Mailgun or Resend, which use HTTPS.`,
    };
  return {
    reason: "failed",
    message: text ? `The mail server answered: ${text}` : "The mail server did not accept the connection.",
  };
}

export async function smtpVerify(ctx: MailCtx, input: SmtpIn): Promise<VerifyOut> {
  ensureSmtp(ctx);
  const base = saved(ctx);
  const overrides = ["host", "port", "security", "username", "passwordHandle"].some(
    (k) => (input as Record<string, unknown>)[k] !== undefined,
  );
  if (!base && !overrides) bad(ctx, "No mail server is saved yet. Enter one to test it.");
  const c = clean(ctx, input, base);
  ctx.vault.use(c.passwordHandle);
  const started = ctx.now();
  let result: VerifyOut;
  try {
    const password = await secret(ctx, c.passwordHandle);
    await transportFor(ctx).verify({
      host: c.host,
      port: c.port,
      security: c.security,
      username: c.username,
      password,
    });
    result = { ok: true, message: `Connected to ${c.host} and signed in.`, ms: Math.max(0, ctx.now() - started) };
  } catch (e) {
    if (codeOf(e) === "internal.unavailable") throw e;
    result = { ok: false, ...explain(e, c), ms: Math.max(0, ctx.now() - started) };
    ctx.log.warn("mail.smtp.verify failed", {
      host: c.host,
      port: c.port,
      reason: result.reason,
      traceId: ctx.trace.traceId,
    });
  }
  // only a test of the saved server changes what the page shows about it; trying other values leaves the saved state alone
  if (base && !overrides)
    ctx.db.run(
      `UPDATE mail_smtp SET state = ?, detail = ?, "checkedAt" = ?, updated_at = ? WHERE id = ?`,
      result.ok ? "ok" : "failed",
      result.ok ? null : result.message,
      ctx.now(),
      ctx.now(),
      ROW,
    );
  return result;
}

// ---- the send behind mail.send (provider smtp)

export interface DeliverIn {
  messageId: string;
  from: string;
  fromName?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  attachments?: { name: string; fileId: string }[];
  /** the sending domain and where its DKIM key is kept; absent: the message goes out signed by the mail server alone */
  dkim?: { domain: string; selector: string; handle: string };
}

/** Send one message through the Space's mail server. Answers the provider id mail.send keeps: the Message-ID without its brackets. */
export async function smtpDeliver(ctx: MailCtx, m: DeliverIn): Promise<string> {
  ensureSmtp(ctx);
  const row = saved(ctx);
  if (!row)
    throw fail("validation.precondition_failed", ctx.trace.traceId, {
      message: "No mail server is set up. Add one in Console, Comms.",
    });
  const conn: SmtpConn = {
    host: str(row, "host"),
    port: num(row, "port"),
    security: str(row, "security") === "tls" ? "tls" : "starttls",
    username: str(row, "username"),
    password: await secret(ctx, str(row, "passwordHandle")),
  };
  const mail: SmtpMail = { messageId: m.messageId, from: m.from, to: m.to, subject: m.subject };
  if (m.fromName) mail.fromName = m.fromName;
  if (m.cc?.length) mail.cc = m.cc;
  if (m.bcc?.length) mail.bcc = m.bcc;
  if (m.replyTo) mail.replyTo = m.replyTo;
  if (m.text !== undefined) mail.text = m.text;
  if (m.html !== undefined) mail.html = m.html;
  // the Message-ID travels as its own field so it is written once
  const headers = Object.fromEntries(Object.entries(m.headers ?? {}).filter(([k]) => k.toLowerCase() !== "message-id"));
  if (Object.keys(headers).length) mail.headers = headers;
  if (m.attachments?.length) {
    if (!fileBytes)
      throw fail("internal.unavailable", ctx.trace.traceId, {
        message: "This server cannot attach files to SMTP mail yet.",
      });
    mail.attachments = [];
    for (const a of m.attachments) {
      const f = await fileBytes(ctx, a.fileId);
      mail.attachments.push({ name: a.name || f.name, mime: f.mime, bytes: f.bytes });
    }
  }
  if (m.dkim)
    mail.dkim = { domain: m.dkim.domain, selector: m.dkim.selector, privateKey: await secret(ctx, m.dkim.handle) };
  let sent: { rejected: string[] };
  try {
    sent = await transportFor(ctx).send(conn, mail);
  } catch (e) {
    const why = explain(e, conn);
    ctx.log.warn("mail.send over smtp failed", { host: conn.host, reason: why.reason, traceId: ctx.trace.traceId });
    const status = (e as { responseCode?: unknown } | null)?.responseCode;
    // 4xx from the server is "try again later": the step retries, as with a provider that pushes back
    if (typeof status === "number" && status >= 400 && status < 500)
      throw fail("provider.rate_limited", ctx.trace.traceId, { message: why.message });
    throw fail(why.reason === "auth" ? "provider.auth_failed" : "provider.bad_response", ctx.trace.traceId, {
      message: why.message,
    });
  }
  if (sent.rejected.length >= m.to.length + (m.cc?.length ?? 0) + (m.bcc?.length ?? 0))
    throw fail("provider.bad_response", ctx.trace.traceId, { message: "The mail server refused every recipient." });
  return m.messageId.replace(/^<|>$/g, "");
}
