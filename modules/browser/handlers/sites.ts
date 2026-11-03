// Browser connections (lane l-chrome2a): list, set and remove. The rows are a person's own. The extension reads them to know which agent may Act where (apps/chrome/src/agent/rights.js);
// an agent (the Chrome in an agent's computer is signed in as the agent) lists the sites that name it, and can never set or widen a right.
import { TABLE, hostOf, nid, raise, rightsOf, siteOut } from "../projections.ts";
import type { BrowserCtx, RightRow, RunsIn, SiteRow } from "../projections.ts";

const RUNS: readonly string[] = ["chrome", "computers", "both"];
const personOf = (ctx: BrowserCtx): string | null => (ctx.principal.kind === "person" ? ctx.principal.id : null);
const rows = (ctx: BrowserCtx): SiteRow[] => (ctx.db.all(`SELECT * FROM ${TABLE}`) as SiteRow[]).filter((r) => r.removed === 0);

export async function sitesList(ctx: BrowserCtx) {
  const me = personOf(ctx);
  const mine = rows(ctx).filter((r) => (me ? r.owner === me : r.owner === ctx.actingFor || rightsOf(r).some((x) => x.agentId === ctx.principal.id)));
  const seen = mine.map((r) => (me ? siteOut(r) : { ...siteOut(r), rights: siteOut(r).rights.filter((x) => x.agentId === ctx.principal.id) }));
  return { sites: seen.sort((a, b) => a.host.localeCompare(b.host)) };
}

export async function sitesSet(ctx: BrowserCtx, input: { host: string; runsIn: RunsIn; rights: RightRow[]; idempotencyKey: string }) {
  const trace = ctx.trace.traceId;
  const me = personOf(ctx);
  if (!me) raise(trace, "permission.no_grant", "Only you can change what an agent may do in your browser.");
  const host = hostOf(input.host);
  if (!host) raise(trace, "validation.bad_input", "Give the site's address, like app.gohighlevel.com.");
  if (!RUNS.includes(input.runsIn)) raise(trace, "validation.bad_input", "Say where it runs: My Chrome, agent computers, or both.");
  const rights = new Map<string, RightRow>();
  for (const r of input.rights) {
    if (r.right !== "read" && r.right !== "act") raise(trace, "validation.bad_input", "An agent's right is Read only or Act.");
    rights.set(r.agentId, { agentId: r.agentId, right: r.right });
  }
  const now = ctx.now();
  const have = rows(ctx).find((r) => r.owner === me && r.host === host);
  if (have) {
    ctx.db.run(`UPDATE ${TABLE} SET runs_in = ?, rights_json = ?, updated_at = ? WHERE id = ?`, input.runsIn, JSON.stringify([...rights.values()]), now, have.id);
    ctx.emit("browser.site_changed", have.id, { siteId: have.id, host, runsIn: input.runsIn, removed: false });
    return { site: siteOut({ ...have, runs_in: input.runsIn, rights_json: JSON.stringify([...rights.values()]), updated_at: now }) };
  }
  const id = nid("bsi");
  const row: SiteRow = { id, owner: me, host, runs_in: input.runsIn, rights_json: JSON.stringify([...rights.values()]), removed: 0, at: now, updated_at: now };
  ctx.db.run(`INSERT INTO ${TABLE} (id, owner, host, runs_in, rights_json, removed, at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, row.id, row.owner, row.host, row.runs_in, row.rights_json, row.removed, row.at, row.updated_at);
  ctx.emit("browser.site_changed", id, { siteId: id, host, runsIn: input.runsIn, removed: false });
  return { site: siteOut(row) };
}

export async function sitesRemove(ctx: BrowserCtx, input: { siteId: string }) {
  const trace = ctx.trace.traceId;
  const me = personOf(ctx);
  const row = me ? rows(ctx).find((r) => r.id === input.siteId && r.owner === me) : undefined;
  // somebody else's row is "not found": ids leak nothing
  if (!row) raise(trace, "validation.not_found", "That Browser connection is not there.");
  ctx.db.run(`UPDATE ${TABLE} SET removed = ?, updated_at = ? WHERE id = ?`, 1, ctx.now(), row.id);
  ctx.emit("browser.site_changed", row.id, { siteId: row.id, host: row.host, runsIn: row.runs_in, removed: true });
  return { ok: true };
}
