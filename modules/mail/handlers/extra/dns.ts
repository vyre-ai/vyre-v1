// The DNS checks behind mail.domain.check (spec 2.18: SPF, DKIM and DMARC shown green or red). The lookups sit behind a seam so CI never
// touches the network: tests bind a recorded zone, production binds node:dns. A record is compared with what the provider told us to publish.
//   pass    the record is published and matches
//   fail    a record is published but wrong, or one that used to pass is gone
//   pending nothing is published yet (DNS can take hours), or the lookup failed for a moment and there is no earlier answer
import type { MailCtx } from "../../projections.ts";

export type DnsState = "pass" | "fail" | "pending";

export interface DnsLookup {
  txt(name: string): Promise<string[]>;
  cname(name: string): Promise<string[]>;
  mx(name: string): Promise<string[]>;
}

export interface PublishedRecord {
  purpose: "spf" | "dkim" | "dmarc" | "mx" | "verify";
  type: "TXT" | "CNAME" | "MX";
  name: string;
  value: string;
  state: DnsState;
}

const bound = new WeakMap<object, DnsLookup>();
let defaultLookup: DnsLookup | null = null;

/** Tests bind a recorded zone to one context. */
export function bindDns(ctx: MailCtx, lookup: DnsLookup): void {
  bound.set(ctx, lookup);
}

export function setDefaultDns(lookup: DnsLookup | null): void {
  defaultLookup = lookup;
}

/** node:dns with a short timeout, loaded on first use. A TXT answer split into 255-byte chunks is joined. */
export function nodeDns(): DnsLookup {
  let resolver: Promise<{ resolveTxt(n: string): Promise<string[][]>; resolveCname(n: string): Promise<string[]>; resolveMx(n: string): Promise<{ exchange: string }[]> }> | null = null;
  const load = (): NonNullable<typeof resolver> => {
    resolver ??= import("node:dns/promises").then((m) => new m.Resolver({ timeout: 3000, tries: 2 }));
    return resolver;
  };
  return {
    async txt(name) { return (await (await load()).resolveTxt(name)).map((chunks) => chunks.join("")); },
    async cname(name) { return (await load()).resolveCname(name); },
    async mx(name) { return (await (await load()).resolveMx(name)).map((m) => m.exchange); },
  };
}

export function dnsFor(ctx: MailCtx): DnsLookup {
  const found = bound.get(ctx) ?? defaultLookup;
  if (found) return found;
  defaultLookup = nodeDns();
  return defaultLookup;
}

const ABSENT = new Set(["ENODATA", "ENOTFOUND", "NXDOMAIN", "ENOENT"]);
const isAbsent = (e: unknown): boolean => typeof e === "object" && e !== null && ABSENT.has(String((e as { code?: unknown }).code));

type Found = { kind: "values"; values: string[] } | { kind: "absent" } | { kind: "error" };

async function look(fn: () => Promise<string[]>): Promise<Found> {
  try {
    const values = await fn();
    return values.length ? { kind: "values", values } : { kind: "absent" };
  } catch (e) {
    return isAbsent(e) ? { kind: "absent" } : { kind: "error" };
  }
}

/** A record name as the provider gives it (relative, "@" or full) turned into a full name under the domain. */
export function fullName(domain: string, name: string): string {
  const n = name.trim().toLowerCase().replace(/\.$/, "");
  if (!n || n === "@") return domain;
  return n === domain || n.endsWith(`.${domain}`) ? n : `${n}.${domain}`;
}

const squash = (v: string): string => v.replace(/^"+|"+$/g, "").replace(/\s+/g, "");
const host = (v: string): string => v.trim().toLowerCase().replace(/\.$/, "");

function settle(found: Found, matches: (values: string[]) => boolean, previous: DnsState): DnsState {
  if (found.kind === "error") return previous;                        // a lookup that failed says nothing new
  if (found.kind === "absent") return previous === "pass" ? "fail" : "pending";
  return matches(found.values) ? "pass" : "fail";
}

/** SPF passes when the published record carries every include and redirect the provider asked for. */
function spfMatches(published: string[], expected: string): boolean {
  const have = published.filter((v) => /^\s*v=spf1\b/i.test(v));
  if (have.length === 0) return false;
  const wanted = expected.toLowerCase().split(/\s+/).filter((tok) => tok.startsWith("include:") || tok.startsWith("redirect="));
  if (wanted.length === 0) return have.some((v) => squash(v).toLowerCase() === squash(expected).toLowerCase());
  return have.some((v) => {
    const tokens = new Set(v.toLowerCase().split(/\s+/));
    return wanted.every((w) => tokens.has(w));
  });
}

export async function checkRecord(domain: string, rec: PublishedRecord, dns: DnsLookup): Promise<DnsState> {
  const name = fullName(domain, rec.name);
  if (rec.type === "CNAME") {
    return settle(await look(() => dns.cname(name)), (vs) => vs.some((v) => host(v) === host(rec.value)), rec.state);
  }
  if (rec.type === "MX") {
    const exchange = host(rec.value.trim().split(/\s+/).pop() ?? "");
    return settle(await look(() => dns.mx(name)), (vs) => vs.some((v) => host(v) === exchange), rec.state);
  }
  const found = await look(() => dns.txt(name));
  if (rec.purpose === "spf") return settle(found, (vs) => spfMatches(vs, rec.value), rec.state);
  if (rec.purpose === "dmarc") return settle(found, dmarcPublished, rec.state);
  return settle(found, (vs) => vs.some((v) => squash(v) === squash(rec.value)), rec.state);
}

const dmarcPublished = (values: string[]): boolean => values.some((v) => /^\s*v=DMARC1\s*;/i.test(v) && /;\s*p=(none|quarantine|reject)\b/i.test(v));

/** The domain's own DMARC policy: a v=DMARC1 record with a p= tag at _dmarc.<domain>. */
export async function checkDmarc(domain: string, dns: DnsLookup, previous: DnsState): Promise<DnsState> {
  return settle(await look(() => dns.txt(`_dmarc.${domain}`)), dmarcPublished, previous);
}
