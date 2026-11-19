// mail.domain.* (spec 2.18 Sending: Space sending goes through Resend, Mailgun or SMTP on the Space's own domain, DNS checks shown green or red).
// An SMTP domain has no provider to register it at: Vyre makes the domain's DKIM key itself (the private half goes to the Vault, the public half is the record to publish),
// asks for an SPF record that names the mail server and a DMARC record, and the domain is verified when SPF and DKIM are found and the mail server itself last tested well.
// add registers the domain at the provider (resend.domains.create / mailgun.domains.create) and keeps the DNS records it must publish.
// check looks the records up (SPF, DKIM, DMARC), then asks the provider to verify. A domain is verified when the provider says so and SPF and
// DKIM both pass; DMARC is shown but does not block, since a policy is the owner's choice. Only a verified domain can be the default sender.
// The provider's own id and the record list live in the domain row's `records` column as JSON: {ref, providerVerified, records}.
import { fail } from "../../../../host/src/routes/errors.ts";
import { bad, first, isId, missing, newId, num, rowsOf, str } from "../../projections.ts";
import type { MailCtx, Row } from "../../projections.ts";
import { duplicate, ensureAll, idemRef, pageOf, parsePage, preconditionFailed, rememberIdem } from "./common.ts";
import type { PageIn } from "./common.ts";
import { ensureSpaceFolder } from "../../../../lib/space-folder.ts";
import { ensureSmtp } from "../smtp.ts";
import { checkDmarc, checkRecord, checkSpfPublished, dnsFor } from "./dns.ts";
import type { DnsState, PublishedRecord } from "./dns.ts";

type Provider = "resend" | "mailgun" | "smtp";
const providerOf = (row: Row): Provider => {
  const p = str(row, "provider");
  return p === "mailgun" || p === "smtp" ? p : "resend";
};
/** The DKIM selector of a domain Vyre signs for. */
export const DKIM_SELECTOR = "vyre";
const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const PURPOSES = new Set(["spf", "dkim", "dmarc", "mx", "verify"]);
const TYPES = new Set(["TXT", "CNAME", "MX"]);
const STATES = new Set(["pass", "fail", "pending"]);

export interface DomainOut {
  id: string;
  name: string;
  provider: Provider;
  spf: DnsState;
  dkim: DnsState;
  dmarc: DnsState;
  verified: boolean;
  isDefault: boolean;
  checkedAt?: number;
}

interface Stored {
  ref: string;
  providerVerified: boolean;
  records: PublishedRecord[];
  /** an SMTP domain: the Vault handle of the DKIM private key Vyre signs with */
  dkimHandle?: string;
}

const state = (v: unknown): DnsState => (v === "pass" || v === "fail" ? v : "pending");
const domId = (ctx: MailCtx, value: unknown): string => {
  if (!isId("dom", value)) bad(ctx, "Domain id is not valid.");
  return value as string;
};

function liveDomain(ctx: MailCtx, id: string): Row {
  const row = first(ctx.db.all(`SELECT * FROM mail_domain WHERE id = ? AND deleted_at IS NULL`, id));
  if (!row) missing(ctx, "Sending domain does not exist.");
  return row;
}

function readStored(row: Row): Stored {
  try {
    const o = JSON.parse(str(row, "records")) as {
      ref?: unknown;
      providerVerified?: unknown;
      records?: unknown;
      dkimHandle?: unknown;
    };
    return {
      ref: typeof o.ref === "string" ? o.ref : "",
      providerVerified: o.providerVerified === true,
      records: cleanRecords(o.records),
      ...(typeof o.dkimHandle === "string" && o.dkimHandle ? { dkimHandle: o.dkimHandle } : {}),
    };
  } catch {
    return { ref: "", providerVerified: false, records: [] };
  }
}

/** Records as the provider connectors return them; anything that is not a well-formed record is dropped. */
function cleanRecords(value: unknown): PublishedRecord[] {
  if (!Array.isArray(value)) return [];
  const out: PublishedRecord[] = [];
  for (const item of value) {
    const o = (item ?? {}) as Record<string, unknown>;
    if (typeof o.purpose !== "string" || !PURPOSES.has(o.purpose) || typeof o.type !== "string" || !TYPES.has(o.type))
      continue;
    if (typeof o.name !== "string" || typeof o.value !== "string") continue;
    out.push({
      purpose: o.purpose as PublishedRecord["purpose"],
      type: o.type as PublishedRecord["type"],
      name: o.name,
      value: o.value,
      state: typeof o.state === "string" && STATES.has(o.state) ? (o.state as DnsState) : "pending",
    });
  }
  return out;
}

function domainOut(row: Row): DomainOut {
  const out: DomainOut = {
    id: str(row, "id"),
    name: str(row, "name"),
    provider: providerOf(row),
    spf: state(str(row, "spf")),
    dkim: state(str(row, "dkim")),
    dmarc: state(str(row, "dmarc")),
    verified: num(row, "verified") === 1,
    isDefault: num(row, "isDefault") === 1,
  };
  if (typeof row.checkedAt === "number") out.checkedAt = row.checkedAt;
  return out;
}

const withRecords = (row: Row): { domain: DomainOut; records: PublishedRecord[] } => ({
  domain: domainOut(row),
  records: readStored(row).records,
});

function save(ctx: MailCtx, row: Row, set: Record<string, string | number | null>): void {
  const cols = Object.keys(set);
  ctx.db.run(
    `UPDATE mail_domain SET ${cols.map((c) => `"${c}" = ?`).join(", ")}, version = ?, updated_at = ? WHERE id = ?`,
    ...cols.map((c) => set[c] ?? null),
    num(row, "version") + 1,
    ctx.now(),
    str(row, "id"),
  );
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const codeOf = (e: unknown): string => {
  const c = obj(obj(e).error).code;
  return typeof c === "string" ? c : "";
};

// ---- list / get

export async function domainList(
  ctx: MailCtx,
  input: PageIn,
): Promise<{ domains: DomainOut[]; next?: string; total: number }> {
  ensureAll(ctx);
  const { offset, limit } = parsePage(ctx, input);
  const rows = rowsOf(ctx.db.all(`SELECT * FROM mail_domain WHERE deleted_at IS NULL`));
  rows.sort((a, b) => (str(a, "name") < str(b, "name") ? -1 : str(a, "name") > str(b, "name") ? 1 : 0));
  const page = pageOf(rows, offset, limit);
  const out: { domains: DomainOut[]; next?: string; total: number } = {
    domains: page.items.map(domainOut),
    total: page.total,
  };
  if (page.next) out.next = page.next;
  return out;
}

export async function domainGet(ctx: MailCtx, input: { domainId: string }) {
  ensureAll(ctx);
  return withRecords(liveDomain(ctx, domId(ctx, input.domainId)));
}

// ---- add

/** What a provider answers to create: its domain, the id we keep for later calls, and the records to publish. */
function parseCreated(
  provider: Provider,
  answer: unknown,
): { ref: string; spf: DnsState; dkim: DnsState; dmarc: DnsState; records: PublishedRecord[]; verified: boolean } {
  const a = obj(answer);
  const d = obj(a.domain);
  const ref = provider === "resend" ? String(d.providerDomainId ?? "") : String(d.name ?? "");
  const verified = provider === "resend" ? d.status === "verified" : d.state === "active";
  return {
    ref,
    spf: state(d.spf),
    dkim: state(d.dkim),
    dmarc: state(d.dmarc),
    records: cleanRecords(a.records),
    verified,
  };
}

/** Where mail.send finds the DKIM key of an SMTP domain: the selector and the Vault handle, or null for a domain a provider signs. */
export function dkimOf(row: Row): { selector: string; handle: string } | null {
  const stored = readStored(row);
  return providerOf(row) === "smtp" && stored.dkimHandle
    ? { selector: DKIM_SELECTOR, handle: stored.dkimHandle }
    : null;
}

const b64 = (buf: ArrayBuffer): string => Buffer.from(buf).toString("base64");
/** A 2048-bit RSA pair for DKIM (WebCrypto, as the signing seal makes its keys): the private half as PKCS 8 PEM, the public half as the base64 the DNS record carries. */
async function dkimPair(): Promise<{ privatePem: string; publicB64: string }> {
  const subtle = globalThis.crypto.subtle;
  const keys = (await subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const body = b64(await subtle.exportKey("pkcs8", keys.privateKey))
    .replace(/(.{64})/g, "$1\n")
    .trim();
  const dashes = "-".repeat(5);
  return {
    privatePem: `${dashes}BEGIN PRIVATE KEY${dashes}\n${body}\n${dashes}END PRIVATE KEY${dashes}\n`,
    publicB64: b64(await subtle.exportKey("spki", keys.publicKey)),
  };
}

/** The mail server the Space saved (mail.smtp.set), or null. */
function smtpServer(ctx: MailCtx): Row | null {
  ensureSmtp(ctx);
  return first(ctx.db.all(`SELECT * FROM mail_smtp WHERE id = ?`, "space"));
}

/**
 * An SMTP domain's own records. The DKIM key pair is made here: the private half goes straight into the Vault (the Space's Connections folder) and only its handle is kept;
 * the public half is the TXT record. SPF names the mail server, so mail from it passes whatever else the domain already allows.
 */
async function smtpRecords(
  ctx: MailCtx,
  name: string,
  key: string,
): Promise<{ records: PublishedRecord[]; dkimHandle: string }> {
  const server = smtpServer(ctx);
  if (!server) preconditionFailed(ctx, "Add the mail server first, then the domain it sends for.");
  const pair = await dkimPair();
  const folder = await ensureSpaceFolder((cap, input) => ctx.call(cap, input), {
    name: "Connections",
    idem: `connections-folder:shared:${ctx.space}`,
  });
  const made = obj(
    obj(
      await ctx.call("vault.item.put", {
        folderId: folder,
        name: `Smtp Dkim ${name.replace(/[^a-z0-9]+/g, " ").trim()}`,
        kind: "other",
        fields: [{ key: "key", value: pair.privatePem, secret: true }],
        idempotencyKey: `${key}:dkim`,
      }),
    ).item,
  );
  const handle = typeof made.handle === "string" ? made.handle : "";
  if (!handle)
    throw fail("provider.bad_response", ctx.trace.traceId, { message: "The Vault did not keep the signing key." });
  return {
    dkimHandle: handle,
    records: [
      { purpose: "spf", type: "TXT", name, value: `v=spf1 a:${str(server, "host")} ~all`, state: "pending" },
      {
        purpose: "dkim",
        type: "TXT",
        name: `${DKIM_SELECTOR}._domainkey.${name}`,
        value: `v=DKIM1; k=rsa; p=${pair.publicB64}`,
        state: "pending",
      },
      {
        purpose: "dmarc",
        type: "TXT",
        name: `_dmarc.${name}`,
        value: `v=DMARC1; p=none; rua=mailto:dmarc@${name}`,
        state: "pending",
      },
    ],
  };
}

export async function domainAdd(ctx: MailCtx, input: { name: string; provider: Provider; idempotencyKey: string }) {
  ensureAll(ctx);
  const prior = idemRef(ctx, input.idempotencyKey, "domadd");
  if (prior) {
    const row = first(ctx.db.all(`SELECT * FROM mail_domain WHERE id = ? AND deleted_at IS NULL`, prior));
    if (row) return withRecords(row);
  }
  const name = typeof input.name === "string" ? input.name.trim().toLowerCase().replace(/\.$/, "") : "";
  if (!HOST.test(name)) bad(ctx, "That is not a domain name. Use something like mail.example.com.");
  if (input.provider !== "resend" && input.provider !== "mailgun" && input.provider !== "smtp")
    bad(ctx, "Provider must be resend, mailgun or smtp.");
  if (first(ctx.db.all(`SELECT id FROM mail_domain WHERE name = ? AND deleted_at IS NULL`, name)))
    duplicate(ctx, "That domain is already added.");

  let stored: Stored;
  if (input.provider === "smtp") {
    const own = await smtpRecords(ctx, name, input.idempotencyKey);
    stored = { ref: name, providerVerified: false, records: own.records, dkimHandle: own.dkimHandle };
  } else {
    const made = parseCreated(
      input.provider,
      await ctx.call(`${input.provider}.domains.create`, { name, idempotencyKey: `${input.idempotencyKey}:create` }),
    );
    if (!made.ref)
      throw fail("provider.bad_response", ctx.trace.traceId, { message: "The provider did not return the domain." });
    stored = { ref: made.ref, providerVerified: false, records: made.records };
  }
  const id = newId("dom", ctx.now());
  const now = ctx.now();
  ctx.db.run(
    `INSERT INTO mail_domain (id, name, provider, spf, dkim, dmarc, verified, "isDefault", records, "checkedAt", version, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    name,
    input.provider,
    "pending",
    "pending",
    "pending",
    0,
    0,
    JSON.stringify(stored),
    null,
    1,
    now,
    null,
  );
  rememberIdem(ctx, input.idempotencyKey, "domadd", id);
  ctx.emit("sending_domain.added", `domain/${id}`, { domainId: id, name, provider: input.provider });
  return withRecords(liveDomain(ctx, id));
}

// ---- check

const groupState = (records: PublishedRecord[], purpose: string, fallback: DnsState): DnsState => {
  const of = records.filter((r) => r.purpose === purpose);
  if (of.length === 0) return fallback;
  if (of.some((r) => r.state === "fail")) return "fail";
  return of.every((r) => r.state === "pass") ? "pass" : "pending";
};

export async function domainCheck(ctx: MailCtx, input: { domainId: string }) {
  ensureAll(ctx);
  const row = liveDomain(ctx, domId(ctx, input.domainId));
  const name = str(row, "name");
  const provider = providerOf(row);
  const stored = readStored(row);
  const dns = dnsFor(ctx);

  const [records, dmarc] = await Promise.all([
    Promise.all(
      stored.records.map(
        async (r): Promise<PublishedRecord> => ({
          ...r,
          state:
            provider === "smtp" && r.purpose === "spf"
              ? await checkSpfPublished(name, dns, r.state)
              : await checkRecord(name, r, dns),
        }),
      ),
    ),
    checkDmarc(name, dns, state(str(row, "dmarc"))),
  ]);
  const spf = groupState(records, "spf", state(str(row, "spf")));
  const dkim = groupState(records, "dkim", state(str(row, "dkim")));

  // Ask the provider to look too. It may not have caught up with DNS yet; a failed ask keeps what it said last time.
  let providerVerified = stored.providerVerified;
  if (provider === "smtp") {
    // no provider to ask: the mail server itself must have tested well (mail.smtp.verify)
    const server = smtpServer(ctx);
    providerVerified = !!server && str(server, "state") === "ok";
  } else
    try {
      const answer = obj(
        await ctx.call(
          `${provider}.domains.verify`,
          provider === "resend"
            ? { providerDomainId: stored.ref, idempotencyKey: `mail.domain.check:${str(row, "id")}:${ctx.now()}` }
            : { name: stored.ref, idempotencyKey: `mail.domain.check:${str(row, "id")}:${ctx.now()}` },
        ),
      );
      const d = obj(answer.domain);
      providerVerified = provider === "resend" ? d.status === "verified" : d.state === "active";
    } catch (e) {
      ctx.log.warn("mail.domain.check provider verify failed", { domainId: str(row, "id"), code: codeOf(e) });
    }
  const verified = providerVerified && spf === "pass" && dkim === "pass";
  const now = ctx.now();
  save(ctx, row, {
    spf,
    dkim,
    dmarc,
    verified: verified ? 1 : 0,
    checkedAt: now,
    records: JSON.stringify({
      ref: stored.ref,
      providerVerified,
      records,
      ...(stored.dkimHandle ? { dkimHandle: stored.dkimHandle } : {}),
    } satisfies Stored),
    // A domain that stops verifying cannot stay the default sender.
    ...(verified ? {} : { isDefault: 0 }),
  });
  ctx.emit("sending_domain.checked", `domain/${str(row, "id")}`, { domainId: str(row, "id"), spf, dkim, dmarc });
  return withRecords(liveDomain(ctx, str(row, "id")));
}

// ---- default / remove

export async function domainSetDefault(ctx: MailCtx, input: { domainId: string }): Promise<{ domain: DomainOut }> {
  ensureAll(ctx);
  const row = liveDomain(ctx, domId(ctx, input.domainId));
  if (num(row, "verified") !== 1)
    preconditionFailed(ctx, "Only a verified domain can be the default sender. Check the DNS records first.");
  if (num(row, "isDefault") !== 1) {
    for (const other of rowsOf(ctx.db.all(`SELECT * FROM mail_domain WHERE "isDefault" = ? AND deleted_at IS NULL`, 1)))
      save(ctx, other, { isDefault: 0 });
    save(ctx, row, { isDefault: 1 });
  }
  return { domain: domainOut(liveDomain(ctx, str(row, "id"))) };
}

export async function domainRemove(ctx: MailCtx, input: { domainId: string }): Promise<{ removed: boolean }> {
  ensureAll(ctx);
  const id = domId(ctx, input.domainId);
  const existing = first(ctx.db.all(`SELECT * FROM mail_domain WHERE id = ?`, id));
  if (!existing) missing(ctx, "Sending domain does not exist.");
  if (existing.deleted_at !== null && existing.deleted_at !== undefined) return { removed: true }; // a retry after success
  const provider = providerOf(existing);
  const stored = readStored(existing);

  // The provider goes first, so a refusal there leaves our rows exactly as they were. Inbound routes of the domain, each at its provider,
  // then the domain itself; a provider that no longer knows the object is fine, and a retry after a partial failure repeats harmlessly.
  const routes = rowsOf(ctx.db.all(`SELECT * FROM mail_route WHERE "domainId" = ? AND deleted_at IS NULL`, id));
  for (const route of routes) {
    const ext = first(ctx.db.all(`SELECT "providerRouteId" FROM mail_route_ext WHERE "routeId" = ?`, str(route, "id")));
    const providerRoute = ext ? str(ext, "providerRouteId") : "";
    if (providerRoute && provider === "mailgun")
      await forgive(() =>
        ctx.call("mailgun.routes.delete", {
          idempotencyKey: `mail.domains.remove:${id}:route:${str(route, "id")}`,
          routeId: providerRoute,
        }),
      );
  }
  if (stored.ref && provider !== "smtp") {
    await forgive(() =>
      ctx.call(
        `${provider}.domains.delete`,
        provider === "resend"
          ? { providerDomainId: stored.ref, idempotencyKey: `mail.domains.remove:${id}:domain` }
          : { name: stored.ref, idempotencyKey: `mail.domains.remove:${id}:domain` },
      ),
    );
  }
  const now = ctx.now();
  for (const route of routes) {
    ctx.db.run(
      `UPDATE mail_route SET deleted_at = ?, version = ?, updated_at = ? WHERE id = ?`,
      now,
      num(route, "version") + 1,
      now,
      str(route, "id"),
    );
  }
  ctx.db.run(
    `UPDATE mail_domain SET deleted_at = ?, "isDefault" = ?, verified = ?, version = ?, updated_at = ? WHERE id = ?`,
    now,
    0,
    0,
    num(existing, "version") + 1,
    now,
    id,
  );
  ctx.emit("sending_domain.removed", `domain/${id}`, { domainId: id, name: str(existing, "name") });
  return { removed: true };
}

async function forgive(call: () => Promise<unknown>): Promise<void> {
  try {
    await call();
  } catch (e) {
    const c = codeOf(e);
    if (c !== "validation.not_found") throw e;
  }
}
