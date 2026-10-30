// The Google Workspace directory, for bringing a team in: list the people (admin only, read as the admin with the directory scope), invite the ones an admin chose (one invitation each,
// returned as a link for a person to approve and send), and match the people who have joined since to their Google address so their mail and calendar come in.
import { fail } from "../../../host/src/routes/errors.ts";
import { api, bad, config, EMAIL, ensure, first, list, needHost, normalizeEmail, num, obj, rowsOf, str, strOrNull, text } from "../projections.ts";
import type { GoogleCtx } from "../projections.ts";
import { dwdMapMember } from "./workspace.ts";

const DIRECTORY = "https://admin.googleapis.com/admin/directory/v1/users";

function configured(ctx: GoogleCtx): { connectionId: string; admin: string; domain: string } {
  const cfg = config(ctx);
  const connectionId = strOrNull(cfg, "connectionId"), admin = strOrNull(cfg, "adminEmail"), domain = strOrNull(cfg, "domain");
  if (!cfg || num(cfg, "configured") !== 1 || !connectionId || !admin || !domain) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "Google delegation is not set up." });
  return { connectionId, admin, domain };
}

export async function directoryList(ctx: GoogleCtx, input: { pageToken?: string; query?: string }) {
  ensure(ctx);
  const { connectionId, admin, domain } = configured(ctx);
  const r = await api(ctx, {
    cap: "google.directory.list", connectionId, as: admin, open: true, scope: "admin.directory.user.readonly", bulk: true, url: DIRECTORY,
    query: { domain, maxResults: 200, projection: "basic", orderBy: "email", ...(input.pageToken ? { pageToken: input.pageToken } : {}), ...(input.query ? { query: input.query } : {}) },
  });
  const matched = new Map(rowsOf(ctx.db.all(`SELECT email, "userId" FROM google_member WHERE mapped = ?`, 1)).map((m) => [str(m, "email"), strOrNull(m, "userId")]));
  const people = list(r.users).flatMap((u) => {
    const o = obj(u);
    const email = normalizeEmail(text(o.primaryEmail) ?? "");
    if (!EMAIL.test(email)) return [];
    const row: Record<string, unknown> = { email, suspended: o.suspended === true };
    const name = text(obj(o.name).fullName);
    if (name) row.name = name;
    const userId = matched.get(email);
    if (userId) row.userId = userId;
    return [row];
  });
  const out: Record<string, unknown> = { people };
  if (text(r.nextPageToken)) out.nextPageToken = text(r.nextPageToken);
  return out;
}

export async function directoryImport(ctx: GoogleCtx, input: { people: { email: string; role: string }[]; idempotencyKey: string }) {
  ensure(ctx);
  const { domain } = configured(ctx);
  if (!Array.isArray(input.people) || input.people.length === 0) bad(ctx, "Choose at least one person.");
  const invited: { email: string; inviteId: string; link: string }[] = [];
  const skipped: { email: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const p of input.people) {
    const email = normalizeEmail(p?.email ?? "");
    if (!EMAIL.test(email) || !email.endsWith(`@${domain}`)) { skipped.push({ email: String(p?.email ?? ""), reason: `Only addresses at ${domain} can be invited.` }); continue; }
    if (seen.has(email)) continue;
    seen.add(email);
    if (first(ctx.db.all(`SELECT email FROM google_member WHERE email = ? AND mapped = ?`, email, 1))) { skipped.push({ email, reason: "Already in the Space." }); continue; }
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

export async function syncMembers(ctx: GoogleCtx, _input: { idempotencyKey?: string } = {}) {
  ensure(ctx);
  const { domain } = configured(ctx);
  let matched = 0, connected = 0;
  for (const m of await needHost(ctx).memberEmails(ctx)) {
    const email = normalizeEmail(m.email);
    if (!EMAIL.test(email) || !email.endsWith(`@${domain}`)) continue;
    const have = first(ctx.db.all(`SELECT "userId", mapped FROM google_member WHERE email = ?`, email));
    if (have && num(have, "mapped") === 1) continue;
    const taken = first(ctx.db.all(`SELECT email FROM google_member WHERE "userId" = ? AND mapped = ?`, m.userId, 1));
    if (taken) continue;
    const out = await dwdMapMember(ctx, { email, userId: m.userId, idempotencyKey: `sync:${email}` });
    matched += 1;
    if (out.connected) connected += 1;
  }
  return { matched, connected };
}

