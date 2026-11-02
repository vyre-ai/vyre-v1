// The Google Workspace directory, for bringing a team in: list the people (admin only, read as the admin with the directory scope), invite the ones an admin chose (one invitation each,
// returned as a link for a person to approve and send), and match the people who have joined since to their Google address so their mail and calendar come in.
import { fail } from "../../../host/src/routes/errors.ts";
import { api, bad, config, EMAIL, ensure, first, list, needHost, normalizeEmail, num, obj, rowsOf, str, strOrNull, text } from "../projections.ts";
import type { GoogleCtx } from "../projections.ts";
import { dwdMapMember, stopMember } from "./workspace.ts";

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
    const known = first(ctx.db.all(`SELECT mapped, excluded FROM google_member WHERE email = ?`, email));
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

export async function syncMembers(ctx: GoogleCtx, _input: { idempotencyKey?: string } = {}) {
  ensure(ctx);
  const { domain } = configured(ctx);
  let matched = 0, connected = 0;
  for (const m of await needHost(ctx).memberEmails(ctx)) {
    const email = normalizeEmail(m.email);
    if (!EMAIL.test(email) || !email.endsWith(`@${domain}`)) continue;
    const have = first(ctx.db.all(`SELECT "userId", mapped, "directoryGone" FROM google_member WHERE email = ?`, email));
    if (have && (num(have, "mapped") === 1 || num(have, "directoryGone") === 1)) continue;
    const taken = first(ctx.db.all(`SELECT email FROM google_member WHERE "userId" = ? AND mapped = ?`, m.userId, 1));
    if (taken) continue;
    const out = await dwdMapMember(ctx, { email, userId: m.userId, idempotencyKey: `sync:${email}` });
    matched += 1;
    if (out.connected) connected += 1;
  }
  return { matched, connected };
}


const PAGE_LIMIT = 500;
/** Too many people gone at once is more likely a wrong answer than a real one: a person looks first. */
const heldAt = (mapped: number): number => Math.max(2, Math.ceil(mapped / 4));

/**
 * The directory as it stands today, against who is matched. A person gone or suspended there stops, and the Space suspends them, which ends their sessions and refuses their next sign-in. Reinstated at Google, a
 * person is matched again by an admin reactivating them; Vyre never brings access back by itself. Every page must read, or nothing changes: an answer cut short never removes anyone.
 * An exclusion does not save someone from this: excluding means their mail is never touched, and this reads the directory, not their mail.
 */
export async function directoryReconcile(ctx: GoogleCtx, input: { confirmed?: boolean } = {}) {
  ensure(ctx);
  if (input.confirmed === true && ctx.principal.kind !== "person") throw fail("permission.no_grant", ctx.trace.traceId, { message: "A person confirms this." });
  const { connectionId, admin, domain } = configured(ctx);
  const present = new Map<string, boolean>();
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const r = await api(ctx, {
      cap: "google.directory.reconcile", connectionId, as: admin, open: true, scope: "admin.directory.user.readonly", bulk: true, url: DIRECTORY,
      query: { domain, maxResults: 500, projection: "basic", ...(pageToken ? { pageToken } : {}) },
    });
    for (const u of list(r.users)) {
      const o = obj(u);
      const main = normalizeEmail(text(o.primaryEmail) ?? "");
      if (EMAIL.test(main)) present.set(main, o.suspended === true || o.archived === true);
      // an address change leaves the old one as an alias: that person has not left
      for (const a of list(o.aliases)) { const alias = normalizeEmail(text(a) ?? ""); if (EMAIL.test(alias) && !present.has(alias)) present.set(alias, o.suspended === true || o.archived === true); }
    }
    pageToken = text(r.nextPageToken);
    pages += 1;
  } while (pageToken && pages < PAGE_LIMIT);
  if (pageToken) return { checked: 0, gone: [], held: "The directory is too long to read in one pass, so nobody was changed." };
  if (!present.has(admin)) return { checked: present.size, gone: [], held: `The directory answered without ${admin}, so nobody was changed. Check the admin address.` };
  const people = rowsOf(ctx.db.all(`SELECT email, "userId", "directoryGone" FROM google_member WHERE mapped = ? AND "userId" IS NOT NULL`, 1));
  const gone = people.filter((m) => str(m, "email") !== admin && present.get(str(m, "email")) !== false).map((m) => ({ email: str(m, "email"), userId: str(m, "userId") }));
  if (gone.length > heldAt(people.length) && input.confirmed !== true) {
    return { checked: present.size, gone: [], held: `${gone.length} of ${people.length} people look gone from the directory, so nobody was changed. Check the directory, then confirm.` };
  }
  for (const m of gone) {
    ctx.db.run(`UPDATE google_member SET mapped = ?, "directoryGone" = ?, updated_at = ? WHERE email = ?`, 0, 1, ctx.now(), m.email);
    await stopMember(ctx, { email: m.email, userId: m.userId, connectionId });
    await ctx.call("members.suspend", { personId: m.userId, reason: "Gone from the company directory" }).catch((e: unknown) => ctx.log.warn("a person gone from the directory was not suspended", { code: (e as { error?: { code?: string } } | null)?.error?.code ?? "" }));
  }
  for (const row of rowsOf(ctx.db.all(`SELECT email FROM google_member WHERE "directoryGone" = ?`, 1))) {
    if (present.get(str(row, "email")) === false) ctx.db.run(`UPDATE google_member SET "directoryGone" = ?, updated_at = ? WHERE email = ?`, 0, ctx.now(), str(row, "email"));
  }
  return { checked: present.size, gone: gone.map((m) => m.email) };
}
