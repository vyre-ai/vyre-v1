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
import dns from "node:dns/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fail } from "../../../host/src/routes/errors.ts";
import { blockedAddress } from "../../../lib/net-guard.ts";
import { bad, ensure, first, num, statements, str, strOrNull } from "../projections.ts";
import type { MailCtx, Row } from "../projections.ts";
import { clearSmtpStrikes, SAME_FAILURE_MS, strike, strikeSmtpDomains } from "./watch.ts";

export type Security = "starttls" | "tls";
export type SmtpReason = "blocked" | "refused" | "unknown_host" | "address" | "auth" | "tls" | "failed";

export interface SmtpConn {
  host: string;
  port: number;
  security: Security;
  username: string;
  password: string;
  /** the address that was checked and is connected to; the name is kept for the certificate */
  ip?: string;
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
  send(conn: SmtpConn, mail: SmtpMail): Promise<{ rejected: { address: string; code?: number }[] }>;
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
/** Every address a name answers with. */
export type SmtpResolve = (host: string) => Promise<string[]>;
const liveResolve: SmtpResolve = async (host) => (await dns.lookup(host, { all: true })).map((r) => r.address);
const resolvers = new WeakMap<object, SmtpResolve>();
/** A public address that names no real place, for tests that bind no resolver of their own. */
const TEST_ADDRESS = "93.184.216.34";
/** Tests bind a recorded transport to one context, and by default a resolver that answers a public address. */
export function bindSmtp(ctx: MailCtx, t: SmtpTransport, resolve: SmtpResolve = async () => [TEST_ADDRESS]): void {
  bound.set(ctx, t);
  resolvers.set(ctx, resolve);
}

/** A mail server must be a public place: a name that answers with a loopback, private, link-local or metadata address is refused, checked after DNS, and the connection goes to the address that was checked. */
class Refused extends Error {
  readonly reason: "address" | "unknown_host";
  constructor(reason: "address" | "unknown_host", message: string) {
    super(message);
    this.reason = reason;
  }
}
async function vet(ctx: MailCtx, host: string): Promise<string> {
  const resolve = resolvers.get(ctx) ?? liveResolve;
  let ips: string[];
  try {
    ips = await resolve(host);
  } catch {
    throw new Refused("unknown_host", `No mail server answers at ${host}. Check the name.`);
  }
  if (!ips.length) throw new Refused("unknown_host", `No mail server answers at ${host}. Check the name.`);
  for (const ip of ips)
    if (blockedAddress(ip, false))
      throw new Refused("address", "A mail server must be on the public internet. That address is not allowed.");
  return ips[0] as string;
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
  sendMail(m: Record<string, unknown>): Promise<{ rejected?: unknown[]; rejectedErrors?: unknown[] }>;
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
    host: conn.ip ?? conn.host,
    port: conn.port,
    tls: { servername: conn.host },
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
      const codes = new Map(
        ((sent as { rejectedErrors?: { recipient?: unknown; responseCode?: unknown }[] }).rejectedErrors ?? []).map(
          (e) => [String(e.recipient), typeof e.responseCode === "number" ? e.responseCode : undefined] as const,
        ),
      );
      return {
        rejected: (sent.rejected ?? []).map((a) => {
          const address = String(a);
          const code = codes.get(address);
          return code === undefined ? { address } : { address, code };
        }),
      };
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

/** What people and agents read of the username: its first two letters and the domain. It is often a whole mailbox or an API key id. */
export function mask(username: string): string {
  const at = username.lastIndexOf("@");
  const local = at > 0 ? username.slice(0, at) : username;
  const head = local.slice(0, 2);
  return `${head}…${at > 0 ? username.slice(at) : ""}`;
}

function out(row: Row | null): SmtpOut {
  if (!row) return { configured: false, state: "none" };
  const state = str(row, "state");
  const o: SmtpOut = {
    configured: true,
    host: str(row, "host"),
    port: num(row, "port"),
    security: str(row, "security") === "tls" ? "tls" : "starttls",
    username: mask(str(row, "username")),
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
/** The Vault kinds a mail password may have: a Login (username and password) or an API key. Any other secret the person can read (an env file, a card, an SSH key) is never given to a mail server. */
const MAIL_KINDS = ["login", "api_key"] as const;

/** The handle names a Vault item of a mail kind that this person can see. The Vault lists only what the asker may open, so this is also the read check. */
/** The Vault item a handle names, whatever its spelling (case, a field after the dot), or null when this person cannot see one of a mail kind. The Vault lists only what the asker may open. */
async function findMailCredential(ctx: MailCtx, handle: string): Promise<string | null> {
  const want = (handle.replace(/^#/, "").split(".")[0] ?? "").toLowerCase();
  for (const kind of MAIL_KINDS) {
    let cursor: string | undefined;
    // the list searches by part of a name, so a short name can match many items: read every page (up to 20) before saying there is no such item
    for (let page = 0; page < 20; page++) {
      let got: { items?: { id?: unknown; handle?: unknown }[]; next?: unknown } | null;
      try {
        got = (await ctx.call("vault.items.list", {
          kind,
          q: want,
          limit: 50,
          ...(cursor ? { cursor } : {}),
        })) as typeof got;
      } catch {
        throw fail("provider.auth_failed", ctx.trace.traceId, {
          message: "The Vault could not be read just now. Try again.",
        });
      }
      const hit = (got?.items ?? []).find(
        (i) => typeof i.handle === "string" && (i.handle.replace(/^#/, "").split(".")[0] ?? "").toLowerCase() === want,
      );
      if (hit) return typeof hit.id === "string" ? hit.id : `handle:${want}`;
      cursor = typeof got?.next === "string" && got.next !== "" ? got.next : undefined;
      if (!cursor) break;
    }
  }
  return null;
}

/** The item id of a password the person may use for mail, or a refusal in words. */
async function ensureMailCredential(ctx: MailCtx, handle: string): Promise<string> {
  const id = await findMailCredential(ctx, handle);
  if (id === null)
    bad(
      ctx,
      "The password must be a Vault item of the kind Login or API key that you can open. Save it there, then give its handle.",
    );
  return id;
}

/** The saved password is for the saved server only: for another host, port or username it is refused whatever the handle is spelled like, because both handles are resolved to the Vault item before they are compared. */
async function refuseSavedItemElsewhere(ctx: MailCtx, base: Row | null, c: Clean, itemId: string): Promise<void> {
  if (!base) return;
  const moved = c.host !== str(base, "host") || c.port !== num(base, "port") || c.username !== str(base, "username");
  if (!moved) return;
  const saved = await findMailCredential(ctx, str(base, "passwordHandle")).catch(() => null);
  if (saved !== null && saved === itemId)
    bad(
      ctx,
      "That Vault item is the saved server's password. Give a different Vault item for a different server, port or username.",
    );
}

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
  // The saved password belongs to the saved place. A different server, port or username never inherits it: the handle is given again, and read as the person asking.
  const moved =
    base !== null &&
    (hostName !== str(base, "host") || port !== num(base, "port") || username !== str(base, "username"));
  if (moved && typeof input.passwordHandle !== "string")
    bad(
      ctx,
      "You changed the server, port or username, so give the password's Vault handle again. A saved password is never sent to a different place.",
    );
  // and the saved handle is for the saved server only: pointing it at another server is refused whoever asks, so the saved password can never be sent to a place a person did not give it to. A new place needs its own Vault item.
  if (moved && base && input.passwordHandle === str(base, "passwordHandle"))
    bad(
      ctx,
      "That Vault item is the saved server's password. Give a different Vault item for a different server, port or username.",
    );
  const passwordHandle =
    typeof input.passwordHandle === "string" ? input.passwordHandle : base ? str(base, "passwordHandle") : "";
  if (!HANDLE.test(passwordHandle))
    bad(ctx, "Save the password in the Vault and give its handle, like #Smtp_Password.");
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
  await vet(ctx, c.host).catch((e: unknown) => {
    if (e instanceof Refused) bad(ctx, e.message);
    throw e;
  });
  const itemId = await ensureMailCredential(ctx, c.passwordHandle);
  await refuseSavedItemElsewhere(ctx, base, c, itemId);
  ctx.vault.use(c.passwordHandle); // the person saving it must be able to use that Vault item now: sends log in later as the server
  await secret(ctx, c.passwordHandle); // and to read it: the Vault answers as this person, so an item they cannot open cannot be given to a mail server
  const now = ctx.now();
  if (base && (c.host !== str(base, "host") || c.port !== num(base, "port") || c.username !== str(base, "username")))
    stopVerified(ctx);
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
    typeof status !== "number" &&
    (code === "ETIMEDOUT" ||
      code === "ECONNECTION" ||
      code === "ESOCKET" ||
      code === "EHOSTUNREACH" ||
      code === "ENETUNREACH" ||
      /timed? ?out|greeting never received/i.test(text))
  )
    return {
      reason: "blocked",
      message: `This server cannot open port ${c.port}. Some hosts, such as Railway, block mail ports. Try port 2525, or send with Mailgun or Resend, which use HTTPS.`,
    };
  // never the server's own words: a server that is not a mail server could be made to say anything, and the line is stored and shown
  return {
    reason: "failed",
    message:
      typeof status === "number"
        ? `The mail server answered with an error (${status}).`
        : "The mail server did not accept the connection.",
  };
}

/** `strike: false` is for the daily re-check, which counts the failure once itself, per domain. */
export async function smtpVerify(ctx: MailCtx, input: SmtpIn, opts: { strike?: boolean } = {}): Promise<VerifyOut> {
  ensureSmtp(ctx);
  const base = saved(ctx);
  const overrides = ["host", "port", "security", "username", "passwordHandle"].some(
    (k) => (input as Record<string, unknown>)[k] !== undefined,
  );
  if (!base && !overrides) bad(ctx, "No mail server is saved yet. Enter one to test it.");
  const c = clean(ctx, input, base);
  const itemId = await ensureMailCredential(ctx, c.passwordHandle);
  await refuseSavedItemElsewhere(ctx, base, c, itemId);
  ctx.vault.use(c.passwordHandle);
  const started = ctx.now();
  let result: VerifyOut;
  try {
    const ip = await vet(ctx, c.host);
    const password = await secret(ctx, c.passwordHandle);
    await transportFor(ctx).verify({
      host: c.host,
      port: c.port,
      security: c.security,
      username: c.username,
      password,
      ip,
    });
    result = { ok: true, message: `Connected to ${c.host} and signed in.`, ms: Math.max(0, ctx.now() - started) };
  } catch (e) {
    if (codeOf(e) === "internal.unavailable") throw e;
    result = {
      ok: false,
      ...(e instanceof Refused ? { reason: e.reason, message: e.message } : explain(e, c)),
      ms: Math.max(0, ctx.now() - started),
    };
    ctx.log.warn("mail.smtp.verify failed", {
      host: c.host,
      port: c.port,
      reason: result.reason,
      traceId: ctx.trace.traceId,
    });
  }
  // only a test of the saved server changes what the page shows about it; trying other values leaves the saved state alone
  if (base && !overrides && opts.strike !== false) {
    if (result.ok) clearSmtpStrikes(ctx);
    else strikeSmtpDomains(ctx, result.message);
  }
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

/** A domain whose mail server no longer works stops saying "verified": mail.send refuses it until the next domain check finds the server well again. */
function stopVerified(ctx: MailCtx): void {
  ctx.db.run(
    `UPDATE mail_domain SET verified = ?, updated_at = ? WHERE provider = ? AND verified = ? AND deleted_at IS NULL`,
    0,
    ctx.now(),
    "smtp",
    1,
  );
}
function recordServerFailure(ctx: MailCtx, message: string, domainId?: string): void {
  if (domainId) strike(ctx, domainId, message, { minGapMs: SAME_FAILURE_MS });
  else strikeSmtpDomains(ctx, message);
  ctx.db.run(
    `UPDATE mail_smtp SET state = ?, detail = ?, "checkedAt" = ?, updated_at = ? WHERE id = ?`,
    "failed",
    message,
    ctx.now(),
    ctx.now(),
    ROW,
  );
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
  /** the mail.send message row, for the per-recipient report */
  rowId?: string;
  /** the sending domain this message went out through: a failure of the server counts against this domain only */
  domainId?: string;
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
  const host = str(row, "host");
  const ip = await vet(ctx, host).catch((e: unknown) => {
    if (e instanceof Refused) throw fail("provider.bad_response", ctx.trace.traceId, { message: e.message });
    throw fail("provider.network", ctx.trace.traceId, { message: `No mail server answers at ${host}.` });
  });
  const conn: SmtpConn = {
    ip,
    host,
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
  let sent: { rejected: { address: string; code?: number }[] };
  try {
    sent = await transportFor(ctx).send(conn, mail);
  } catch (e) {
    const status = (e as { responseCode?: unknown } | null)?.responseCode;
    const command = String((e as { command?: unknown } | null)?.command ?? "");
    // Once the message body may have left, a socket failure says nothing about whether the server kept it. That is an unknown outcome: never retried (a retry could deliver it twice), and said so.
    if (typeof status !== "number" && !BEFORE_DATA.test(command)) {
      ctx.log.warn("mail.send over smtp: outcome unknown", { host: conn.host, traceId: ctx.trace.traceId });
      throw fail("provider.bad_response", ctx.trace.traceId, {
        message: `The mail server stopped answering after the message was sent, so it may have been delivered. Vyre did not send it again. Look for ${m.messageId} in the mail server's sent mail before sending it again.`,
      });
    }
    const why = explain(e, conn);
    ctx.log.warn("mail.send over smtp failed", { host: conn.host, reason: why.reason, traceId: ctx.trace.traceId });
    // a 4xx from the server is "try again later": it did not take the message, so the step retries, as with a provider that pushes back
    if (typeof status === "number" && status >= 400 && status < 500)
      throw fail("provider.rate_limited", ctx.trace.traceId, { message: why.message });
    // a server that cannot be reached by name, refuses the sign-in or fails TLS is not a place mail can go: the domain stops saying verified until it is checked again (a busy or slow server is not that)
    if (["auth", "unknown_host", "tls"].includes(why.reason)) recordServerFailure(ctx, why.message, m.domainId);
    throw fail(why.reason === "auth" ? "provider.auth_failed" : "provider.bad_response", ctx.trace.traceId, {
      message: why.message,
    });
  }
  const total = m.to.length + (m.cc?.length ?? 0) + (m.bcc?.length ?? 0);
  if (sent.rejected.length >= total)
    throw fail("provider.bad_response", ctx.trace.traceId, { message: "The mail server refused every recipient." });
  // The others were accepted: the message is sent. Each refused address is reported on its own, as a bounce at the door, so it is never lost.
  if (m.rowId)
    for (const r of sent.rejected)
      ctx.emit("message.bounced", `mail_message/${m.rowId}`, {
        messageId: m.rowId,
        channel: "email",
        address: r.address,
        kind: r.code !== undefined && r.code >= 500 ? "hard" : "soft",
        reason: "The mail server refused this address.",
      });
  return m.messageId.replace(/^<|>$/g, "");
}

/** The commands before the message body goes out: an error here means nothing was delivered. */
const BEFORE_DATA = /^(CONN|EHLO|HELO|LHLO|STARTTLS|AUTH.*|MAIL FROM|RCPT TO|RSET)$/;
