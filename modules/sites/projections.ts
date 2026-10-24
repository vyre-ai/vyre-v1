// sites projections. Handlers write the same rows on the call; replay is idempotent (a newer at wins).
// activity (inline): the last site event per site, used to order the Sites list.
// merged_previews (async): a merged pull request marks the previews built from it; the next write call removes them (spec 2.20).

export interface ProjTx {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

export interface ProjEvent {
  at: number;
  actor: string;
  payload: Uint8Array;
}

type Row = Record<string, unknown>;

function payloadOf(payload: Uint8Array): Row {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(payload));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Row) : {};
  } catch {
    return {};
  }
}

export function touchActivity(db: ProjTx, siteId: string, event: string, at: number): void {
  const rows = db.all("SELECT * FROM sites_activity WHERE site_id = ?", siteId) as Row[];
  const current = rows[0];
  if (current) {
    const prev = typeof current.at === "number" ? current.at : 0;
    if (at >= prev) db.run("UPDATE sites_activity SET last_event = ?, at = ? WHERE site_id = ?", event, at, siteId);
    return;
  }
  db.run("INSERT INTO sites_activity (site_id, last_event, at) VALUES (?, ?, ?)", siteId, event, at);
}

function forEvent(name: string): (tx: ProjTx, e: ProjEvent) => void {
  return (tx, e) => {
    const siteId = payloadOf(e.payload).siteId;
    if (typeof siteId === "string" && siteId.length > 0) touchActivity(tx, siteId, name, e.at);
  };
}

const SITE_EVENTS = [
  "site.created", "site.build_failed", "site.deployed", "site.promoted", "site.rolled_back",
  "site.preview_created", "site.preview_removed", "site.table_created", "site.table_promoted", "site.domain_changed",
] as const;

export const activityProjection = {
  name: "sites.activity",
  version: 1,
  mode: "inline" as const,
  rebuild: "replay" as const,
  reset(tx: ProjTx): void {
    tx.run("DELETE FROM sites_activity");
  },
  on: Object.fromEntries(SITE_EVENTS.map((n) => [n, forEvent(n)])) as Record<string, (tx: ProjTx, e: ProjEvent) => void>,
};

/** True when a site repo url names the repo `owner/name` (https, ssh or git@ forms, with or without .git). */
export function repoMatches(repoUrl: string, repo: string): boolean {
  const clean = repoUrl.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const want = repo.trim().replace(/\.git$/, "");
  if (!want) return false;
  return clean === want || clean.endsWith(`/${want}`) || clean.endsWith(`:${want}`);
}

/** Mark the previews built from a merged pull request. Idempotent: a second pass changes nothing. */
export function markMerged(tx: ProjTx, repo: string, number: number): number {
  let marked = 0;
  const sites = tx.all("SELECT * FROM sites_site WHERE deleted_at IS NULL") as Row[];
  for (const s of sites) {
    if (typeof s.repo_url !== "string" || !repoMatches(s.repo_url, repo)) continue;
    const res = tx.run(
      "UPDATE sites_deployment SET merge_pending = ? WHERE site_id = ? AND env = ? AND pr_number = ? AND removed_at IS NULL AND merge_pending = ?",
      1, s.id, "preview", number, 0,
    );
    marked += res.changes;
  }
  return marked;
}

function onMerged(tx: ProjTx, e: ProjEvent): void {
  const p = payloadOf(e.payload);
  if (typeof p.repo === "string" && typeof p.number === "number") markMerged(tx, p.repo, p.number);
}

export const mergedPreviewsConsumer = {
  name: "sites.merged_previews",
  version: 1,
  mode: "async" as const,
  rebuild: "replay" as const,
  on: { "pull_request.merged": onMerged } as Record<string, (tx: ProjTx, e: ProjEvent) => void>,
};

export const inline = { "sites.activity": activityProjection };
export const consumers = { "sites.merged_previews": mergedPreviewsConsumer };
