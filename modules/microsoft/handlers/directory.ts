// The Microsoft 365 directory, for bringing a team in: list the people (admin only, with the app's User.Read.All), invite the ones an admin chose (one invitation each, returned as a link
// for a person to approve and send), and match the people who have joined since to their address so their mail and calendar come in.
import { fail } from "../../../host/src/routes/errors.ts";
import { api, bad, config, EMAIL, ensure, first, GRAPH, list, needHost, normalizeEmail, num, obj, rowsOf, skipTokenOf, str, strOrNull, text } from "../projections.ts";
import type { MsCtx } from "../projections.ts";
import { consentMapMember, stopMember } from "./subscriptions.ts";

function configured(ctx: MsCtx): { connectionId: string; domain: string | null } {
  const cfg = config(ctx);
  const connectionId = strOrNull(cfg, "connectionId");
  if (!cfg || num(cfg, "configured") !== 1 || !connectionId) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "Microsoft 365 is not set up." });
  return { connectionId, domain: strOrNull(cfg, "domain") };
}
const inDomain = (email: string, domain: string | null): boolean => domain === null || email.endsWith(`@${domain}`);

export async function directoryList(ctx: MsCtx, input: { skipToken?: string; query?: string }) {
  ensure(ctx);
  const { connectionId, domain } = configured(ctx);
  const r = await api(ctx, {
    cap: "ms.directory.list", connectionId, tenant: true, bulk: true, url: `${GRAPH}/users`,
    query: { $select: "id,displayName,mail,userPrincipalName,accountEnabled,userType", $top: 100, ...(input.skipToken ? { $skiptoken: input.skipToken } : {}), ...(input.query ? { $search: `"displayName:${input.query.replace(/["\\]/g, "")}"` } : {}) },
  });
  const matched = new Map(rowsOf(ctx.db.all(`SELECT email, "userId" FROM microsoft_member WHERE mapped = ?`, 1)).map((m) => [str(m, "email"), strOrNull(m, "userId")]));
  const people = list(r.value).flatMap((u) => {
    const o = obj(u);
    if (text(o.userType) === "Guest") return [];
    const email = normalizeEmail(text(o.mail) ?? text(o.userPrincipalName) ?? "");
    if (!EMAIL.test(email) || !inDomain(email, domain)) return [];
    const row: Record<string, unknown> = { email, suspended: o.accountEnabled === false };
    const name = text(o.displayName);
    if (name) row.name = name;
    const userId = matched.get(email);
    if (userId) row.userId = userId;
    return [row];
  });
  const out: Record<string, unknown> = { people };
  const next = skipTokenOf(r["@odata.nextLink"]);
  if (next) out.nextSkipToken = next;
  return out;
}

export async function directoryImport(ctx: MsCtx, input: { people: { email: string; role: string }[]; idempotencyKey: string }) {
  ensure(ctx);
  const { domain } = configured(ctx);
  if (!Array.isArray(input.people) || input.people.length === 0) bad(ctx, "Choose at least one person.");
  const invited: { email: string; inviteId: string; link: string }[] = [];
  const skipped: { email: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const p of input.people) {
    const email = normalizeEmail(p?.email ?? "");
    if (!EMAIL.test(email) || !inDomain(email, domain)) { skipped.push({ email: String(p?.email ?? ""), reason: `Only addresses at ${domain ?? "your tenant"} can be invited.` }); continue; }
    if (seen.has(email)) continue;
    seen.add(email);
    const known = first(ctx.db.all(`SELECT mapped, excluded FROM microsoft_member WHERE email = ?`, email));
    if (num(known, "excluded") === 1) { skipped.push({ email, reason: "Excluded. Include them first." }); continue; }
    if (num(known, "mapped") === 1) { skipped.push({ email, reason: "Already in the Space." }); continue; }
    try {
      const made = obj(await ctx.call("members.invites.create", { role: p.role, email, idempotencyKey: `${input.idempotencyKey}:${email}` }));
      const invite = obj(made.invite);
      invited.push({ email, inviteId: text(invite.id) ?? "", link: text(made.link) ?? "" });
    } catch (e) {
      skipped.push({ email, reason: (e as { error?: { message?: string } } | null)?.error?.message ?? "That invitation could not be made." });
    }
  }
  return { invited, skipped };
}

export async function syncMembers(ctx: MsCtx, _input: { idempotencyKey?: string } = {}) {
  ensure(ctx);
  const { domain } = configured(ctx);
  let matched = 0, connected = 0;
  for (const m of await needHost(ctx).memberEmails(ctx)) {
    const email = normalizeEmail(m.email);
    if (!EMAIL.test(email) || !inDomain(email, domain)) continue;
    const have = first(ctx.db.all(`SELECT "userId", mapped, "directoryGone" FROM microsoft_member WHERE email = ?`, email));
    if (have && (num(have, "mapped") === 1 || num(have, "directoryGone") === 1)) continue;
    if (first(ctx.db.all(`SELECT email FROM microsoft_member WHERE "userId" = ? AND mapped = ?`, m.userId, 1))) continue;
    const out = await consentMapMember(ctx, { email, userId: m.userId, idempotencyKey: `sync:${email}` });
    matched += 1;
    if (out.connected) connected += 1;
  }
  return { matched, connected };
}

/**
 * A person finished Sign in with Microsoft in this tenant (its id and the person's immutable id): that account is theirs, so they are matched to it and their own mail and calendar come in.
 * This is how the owner, who has no invitation, gets their own mailbox. A proof never takes an address someone else is matched to, never moves a person who is matched to another address (an admin decides
 * those), and never brings back a person who left the directory.
 */
export async function matchProven(ctx: MsCtx, input: { person: string; email: string; tenant?: string }): Promise<{ matched: boolean; reason?: string }> {
  ensure(ctx);
  const email = normalizeEmail(input.email ?? "");
  if (!/^usr_[a-z0-9]+$/.test(input.person ?? "") || !EMAIL.test(email)) return { matched: false, reason: "not a person and an address" };
  const cfg = config(ctx);
  const tenant = strOrNull(cfg, "tenantId");
  if (!cfg || num(cfg, "configured") !== 1 || !tenant || String(input.tenant ?? "").toLowerCase() !== tenant.toLowerCase() || !inDomain(email, strOrNull(cfg, "domain"))) return { matched: false, reason: "not connected for that tenant" };
  const have = first(ctx.db.all(`SELECT "userId", mapped, "directoryGone" FROM microsoft_member WHERE email = ?`, email));
  if (num(have, "mapped") === 1) {
    if (strOrNull(have, "userId") === input.person) return { matched: true };
    ctx.log.warn("a signed-in address is matched to someone else", { reason: "address_taken" });
    return { matched: false, reason: "matched to someone else" };
  }
  if (num(have, "directoryGone") === 1) return { matched: false, reason: "gone from the directory" };
  if (first(ctx.db.all(`SELECT email FROM microsoft_member WHERE "userId" = ? AND mapped = ?`, input.person, 1))) return { matched: false, reason: "matched to another address" };
  const out = await consentMapMember(ctx, { email, userId: input.person, idempotencyKey: `proven:${email}:${input.person}` });
  return { matched: out.mapped };
}

/** Too many people gone at once is more likely a wrong answer than a real one: a person looks first. */
const heldAt = (mapped: number): number => Math.max(2, Math.ceil(mapped / 4));
const PAGE_LIMIT = 500;

/**
 * The directory as it stands today, against who is matched. A person gone or turned off there stops, and the Space suspends them, which ends their sessions and refuses their next sign-in. Vyre never brings access back by
 * itself: an admin reactivates them. Every page must read, or nothing changes: an answer cut short never removes anyone. An exclusion does not save someone from this: excluding means their mail is never touched, and this reads the directory, not their mail.
 */
export async function directoryReconcile(ctx: MsCtx, input: { confirmed?: boolean } = {}) {
  ensure(ctx);
  if (input.confirmed === true && ctx.principal.kind !== "person") throw fail("permission.no_grant", ctx.trace.traceId, { message: "A person confirms this." });
  const { connectionId } = configured(ctx);
  const present = new Map<string, boolean>();
  let skipToken: string | undefined;
  let pages = 0;
  do {
    const r = await api(ctx, {
      cap: "ms.directory.reconcile", connectionId, tenant: true, bulk: true, url: `${GRAPH}/users`,
      query: { $select: "mail,userPrincipalName,accountEnabled,proxyAddresses", $top: 500, ...(skipToken ? { $skiptoken: skipToken } : {}) },
    });
    for (const u of list(r.value)) {
      const o = obj(u);
      const off = o.accountEnabled === false;
      for (const a of [text(o.mail), text(o.userPrincipalName)]) { const e = normalizeEmail(a ?? ""); if (EMAIL.test(e)) present.set(e, off); }
      // an address change leaves the old one as a proxy address: that person has not left
      for (const a of list(o.proxyAddresses)) { const m = /^smtp:(.+)$/i.exec(text(a) ?? ""); const e = normalizeEmail(m?.[1] ?? ""); if (EMAIL.test(e) && !present.has(e)) present.set(e, off); }
    }
    skipToken = skipTokenOf(r["@odata.nextLink"]);
    pages += 1;
  } while (skipToken && pages < PAGE_LIMIT);
  if (skipToken) return { checked: 0, gone: [], held: "The directory is too long to read in one pass, so nobody was changed." };
  if (present.size === 0) return { checked: 0, gone: [], held: "The directory answered with nobody in it, so nobody was changed." };
  const people = rowsOf(ctx.db.all(`SELECT email, "userId" FROM microsoft_member WHERE mapped = ? AND "userId" IS NOT NULL`, 1));
  const gone = people.filter((m) => present.get(str(m, "email")) !== false).map((m) => ({ email: str(m, "email"), userId: str(m, "userId") }));
  if (gone.length > heldAt(people.length) && input.confirmed !== true) {
    return { checked: present.size, gone: [], held: `${gone.length} of ${people.length} people look gone from the directory, so nobody was changed. Check the directory, then confirm.` };
  }
  for (const m of gone) {
    ctx.db.run(`UPDATE microsoft_member SET mapped = ?, "directoryGone" = ?, updated_at = ? WHERE email = ?`, 0, 1, ctx.now(), m.email);
    await stopMember(ctx, { email: m.email, userId: m.userId, connectionId });
    await ctx.call("members.suspend", { personId: m.userId, reason: "Gone from the company directory" }).catch((e: unknown) => ctx.log.warn("a person gone from the directory was not suspended", { code: (e as { error?: { code?: string } } | null)?.error?.code ?? "" }));
  }
  for (const row of rowsOf(ctx.db.all(`SELECT email FROM microsoft_member WHERE "directoryGone" = ?`, 1))) {
    if (present.get(str(row, "email")) === false) ctx.db.run(`UPDATE microsoft_member SET "directoryGone" = ?, updated_at = ? WHERE email = ?`, 0, ctx.now(), str(row, "email"));
  }
  return { checked: present.size, gone: gone.map((m) => m.email) };
}
