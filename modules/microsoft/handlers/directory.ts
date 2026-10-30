// The Microsoft 365 directory, for bringing a team in: list the people (admin only, with the app's User.Read.All), invite the ones an admin chose (one invitation each, returned as a link
// for a person to approve and send), and match the people who have joined since to their address so their mail and calendar come in.
import { fail } from "../../../host/src/routes/errors.ts";
import { api, bad, config, EMAIL, ensure, first, GRAPH, list, needHost, normalizeEmail, num, obj, rowsOf, skipTokenOf, str, strOrNull, text } from "../projections.ts";
import type { MsCtx } from "../projections.ts";
import { consentMapMember } from "./subscriptions.ts";

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
    if (first(ctx.db.all(`SELECT email FROM microsoft_member WHERE email = ? AND mapped = ?`, email, 1))) { skipped.push({ email, reason: "Already in the Space." }); continue; }
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
    const have = first(ctx.db.all(`SELECT "userId", mapped FROM microsoft_member WHERE email = ?`, email));
    if (have && num(have, "mapped") === 1) continue;
    if (first(ctx.db.all(`SELECT email FROM microsoft_member WHERE "userId" = ? AND mapped = ?`, m.userId, 1))) continue;
    const out = await consentMapMember(ctx, { email, userId: m.userId, idempotencyKey: `sync:${email}` });
    matched += 1;
    if (out.connected) connected += 1;
  }
  return { matched, connected };
}
