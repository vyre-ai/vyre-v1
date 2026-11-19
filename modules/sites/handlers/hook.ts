// GitHub's webhook for a site that comes from a repo (the lane's slice 6). The edge route (host/src/routes/webhooks.ts, POST /hooks/sites) reads the raw body and limits its size and rate; this is what checks it.
//   secret    one per site, made here, sealed with the Space's key, shown once. GitHub signs the raw body with it (x-hub-signature-256, HMAC SHA-256); the compare is constant time.
//   who       the body names the repo, which finds the candidate sites; a delivery counts for the sites whose secret verifies it, and for no other. An unsigned one, one for an unknown repo and one with a
//             wrong signature all get the same refusal (and the same work, so the time tells nothing).
//   replay    a delivery id is remembered per site for good (a signature carries no clock); the same id again is refused. The order of pushes comes from git, not from a clock: a push whose head
//             commit is one the branch already moved past (a later handled push named it as its parent), or one already handled, is refused, so an old captured delivery can never put old code back, and
//             a commit dated in the future blocks nothing. A push that could not run is recorded as failed and gives its id back, so GitHub's redelivery is taken again.
//   forks     a closed pull request counts only when its head is a branch of the site's own repo.
//   what      a push to the production branch deploys when the site deploys on push; a push to a branch the site follows builds its preview; a deleted branch, or a closed pull request, removes it. Any other
//             branch, and any other event, is acknowledged and ignored.
//   running   a verified push is not run here (this call has no person behind it, and the Vault is checked against a person): it leaves a row in sites_push, and the server's tick runs it as whoever deployed last.
// @reads ../migrations/0007_webhook.sql
// @reads ../migrations/0009_hook_failures.sql
// @reads ../migrations/0013_hook_order.sql
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { hostOnly } from "../../../host/src/ctx/host-only.ts";
import type { WebhookAccept } from "../../../host/src/routes/webhooks.ts";
import { fail, isNull, many, mustSite, nid, one, optBool, rec, reqStr, str } from "./deploy.ts";
import { sourceOf } from "./release.ts";
import { routesHost } from "./route.ts";

type Row = Record<string, unknown>;
const FOLLOW = /^[A-Za-z0-9._/-]{1,100}\*?$|^\*$/;
const MAX_FOLLOW = 20;

/** owner/name of a site's repo, lowercase; null when it has none. */
function repoOfSite(site: Row): string | null {
  const repo = sourceOf(site)?.repo;
  if (!repo) return null;
  return (
    repo
      .trim()
      .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
      .replace(/\.git$/, "")
      .replace(/\/+$/, "")
      .toLowerCase() || null
  );
}

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const randomHex = (n: number): string => hex(globalThis.crypto.getRandomValues(new Uint8Array(n)));

/** Does GitHub's signature header match this body under this secret? The digest is HMAC SHA-256 of the raw body, compared over its whole length without stopping at the first difference. */
export async function signed(secret: string, header: string | undefined, body: string): Promise<boolean> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const want = `sha256=${hex(mac)}`;
  const got = header ?? "";
  let diff = got.length ^ want.length;
  for (let i = 0; i < want.length; i++) diff |= (got.charCodeAt(i) || 0) ^ want.charCodeAt(i);
  return diff === 0;
}

const secretOf = (ctx: Ctx, site: Row): string | null => {
  const sealed = parseSealed(site.hook_secret);
  return sealed ? new TextDecoder().decode(ctx.seal.unseal(sealed as never)) : null;
};
function parseSealed(v: unknown): { keyId: string; nonce: string; bytes: string } | null {
  if (isNull(v)) return null;
  try {
    return JSON.parse(str(v)) as { keyId: string; nonce: string; bytes: string };
  } catch {
    return null;
  }
}

export const followList = (site: Row): string[] => {
  try {
    const v = JSON.parse(isNull(site.hook_follow) ? "[]" : str(site.hook_follow)) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

/** A branch the site gives a preview to: an exact name, a prefix ending in *, or * for all. */
export function follows(patterns: readonly string[], branch: string): boolean {
  return patterns.some((p) => (p === "*" ? true : p.endsWith("*") ? branch.startsWith(p.slice(0, -1)) : p === branch));
}

const header = (h: WebhookAccept["headers"], name: string): string | undefined => {
  const v = h[name];
  return typeof v === "string" ? v : undefined;
};

// ---- the delivery

export async function acceptWebhook(ctx: Ctx, a: WebhookAccept): Promise<unknown> {
  hostOnly(ctx, "sites.accept_webhook");
  const signature = header(a.headers, "x-hub-signature-256");
  const event = header(a.headers, "x-github-event");
  const delivery = header(a.headers, "x-github-delivery");
  let payload: Record<string, unknown> = {};
  try {
    const p = JSON.parse(a.body) as unknown;
    if (p !== null && typeof p === "object") payload = p as Record<string, unknown>;
  } catch {
    /* an unsigned body that is not JSON is refused below like any other unsigned one */
  }
  const repository = (payload["repository"] ?? {}) as Record<string, unknown>;
  const full = typeof repository["full_name"] === "string" ? repository["full_name"].toLowerCase() : "";
  const candidates = many(
    ctx,
    "SELECT * FROM sites_site WHERE hook_secret IS NOT NULL AND deleted_at IS NULL AND source IS NOT NULL",
  ).filter((s) => full !== "" && repoOfSite(s) === full);
  const verified: Row[] = [];
  for (const s of candidates) {
    const secret = secretOf(ctx, s);
    if (secret !== null && (await signed(secret, signature, a.body))) verified.push(s);
  }
  // the same work whatever was found, so the time says nothing about which check failed or whether a site has a webhook
  await signed(randomHex(16), signature, a.body);
  if (verified.length === 0)
    fail(ctx, "auth.bad_credentials", "That request was not signed with a secret this Space knows.");
  if (!event || !delivery || !/^[A-Za-z0-9-]{8,100}$/.test(delivery))
    fail(ctx, "validation.bad_input", "A GitHub delivery names its event and its id.");

  const now = ctx.now();
  // nothing is written until every refusal is behind: which sites have not seen this delivery, and whether it is stale for them
  const fresh = verified.filter(
    (site) =>
      !one(ctx, "SELECT delivery_id FROM sites_hook_delivery WHERE delivery_id = ? AND site_id = ?", delivery, site.id),
  );
  if (fresh.length === 0) fail(ctx, "validation.duplicate", "That delivery was already received.");
  const current = fresh.filter((site) => !stale(ctx, site, event, payload));
  if (current.length === 0)
    fail(ctx, "validation.bad_input", "That push is older than what this site has already handled.");
  let work = false;
  for (const site of current) {
    if (act(ctx, site, event, payload, now, delivery)) work = true;
    // the id is spent only once what the delivery asked for is queued
    ctx.db.run("INSERT INTO sites_hook_delivery (delivery_id, site_id, at) VALUES (?, ?, ?)", delivery, site.id, now);
    remember(ctx, site, event, payload, delivery, now);
  }
  return { accepted: true, nudge: work };
}

/** The branch and head commits a push names: where it came from (before) and where it went (after). Null for anything but a push of a branch. */
function pushOf(event: string, p: Record<string, unknown>): { branch: string; before: string; after: string } | null {
  if (event !== "push") return null;
  const ref = typeof p["ref"] === "string" ? p["ref"] : "";
  if (!ref.startsWith("refs/heads/")) return null;
  const sha = (v: unknown): string =>
    typeof v === "string" && /^[0-9a-f]{7,64}$/i.test(v) && !/^0+$/.test(v) ? v.toLowerCase() : "";
  return { branch: ref.slice("refs/heads/".length), before: sha(p["before"]), after: sha(p["after"]) };
}

/**
 * Old news: the push's head is a commit this branch already moved past (a handled push named it as its parent), or one already handled. It follows the chain of commits the pushes name, so no clock decides it:
 * a commit dated 10:00, a manual deploy at 10:30 and a push at 11:00 deploys, and a commit dated in the future blocks nothing. A branch put back to an earlier commit by force is old news too; deploy it by hand.
 */
function stale(ctx: Ctx, site: Row, event: string, p: Record<string, unknown>): boolean {
  const push = pushOf(event, p);
  if (push === null || push.after === "") return false;
  const row = one(
    ctx,
    "SELECT delivery_id FROM sites_hook_head WHERE site_id = ? AND branch = ? AND (before_sha = ? OR after_sha = ?)",
    site.id,
    push.branch,
    push.after,
    push.after,
  );
  return row !== undefined;
}

function remember(ctx: Ctx, site: Row, event: string, p: Record<string, unknown>, delivery: string, now: number): void {
  const push = pushOf(event, p);
  if (push === null || push.after === "") return;
  ctx.db.run(
    "INSERT OR IGNORE INTO sites_hook_head (site_id, branch, delivery_id, before_sha, after_sha, at) VALUES (?, ?, ?, ?, ?, ?)",
    site.id,
    push.branch,
    delivery,
    push.before,
    push.after,
    now,
  );
}

/** What a verified delivery asks of one site. True when the server should look now: a production push to a site that deploys on push, or a preview queued or removed. */
function act(ctx: Ctx, site: Row, event: string, p: Record<string, unknown>, now: number, delivery: string): boolean {
  const src = sourceOf(site);
  const repository = (p["repository"] ?? {}) as Record<string, unknown>;
  const production =
    src?.branch ?? (typeof repository["default_branch"] === "string" ? repository["default_branch"] : "main");
  const patterns = followList(site);
  if (event === "push") {
    const ref = typeof p["ref"] === "string" ? p["ref"] : "";
    if (!ref.startsWith("refs/heads/")) return false;
    const branch = ref.slice("refs/heads/".length);
    const after = typeof p["after"] === "string" ? p["after"] : "";
    const deleted = p["deleted"] === true || /^0+$/.test(after);
    if (branch === production)
      return !deleted && ctx.db.all("SELECT 1 FROM sites_site WHERE id = ? AND auto_deploy = 1", site.id).length > 0;
    if (!follows(patterns, branch)) return false;
    queue(ctx, site, branch, deleted ? "remove" : "preview", deleted ? null : after, now, delivery);
    return true;
  }
  if (event === "pull_request" && p["action"] === "closed") {
    const head = ((p["pull_request"] ?? {}) as Record<string, unknown>)["head"] as Record<string, unknown> | undefined;
    const branch = typeof head?.["ref"] === "string" ? head["ref"] : "";
    // a pull request from a fork is not the site's branch, whatever its branch is called
    const headRepo = (
      ((p["pull_request"] ?? {}) as Record<string, unknown>)["head"] as Record<string, unknown> | undefined
    )?.["repo"] as Record<string, unknown> | null | undefined;
    const sameRepo =
      typeof headRepo?.["full_name"] === "string" && headRepo["full_name"].toLowerCase() === repoOfSite(site);
    if (sameRepo && branch && branch !== production && follows(patterns, branch)) {
      queue(ctx, site, branch, "remove", null, now, delivery);
      return true;
    }
  }
  return false;
}

/** One open job per site, branch and kind: a second push to the same branch replaces the sha of the one still waiting; a remove after a preview waiting cancels it. */
function queue(
  ctx: Ctx,
  site: Row,
  branch: string,
  action: "preview" | "remove",
  sha: string | null,
  now: number,
  delivery: string,
): void {
  const open = many(
    ctx,
    "SELECT * FROM sites_push WHERE site_id = ? AND branch = ? AND done_at IS NULL",
    site.id,
    branch,
  );
  for (const o of open) {
    if (o.action === action) {
      ctx.db.run("UPDATE sites_push SET sha = ?, at = ?, delivery_id = ? WHERE id = ?", sha, now, delivery, o.id);
      return;
    }
    ctx.db.run("UPDATE sites_push SET done_at = ? WHERE id = ?", now, o.id);
  }
  ctx.db.run(
    "INSERT INTO sites_push (id, site_id, branch, sha, action, at, done_at, delivery_id) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
    nid(ctx, "psh"),
    site.id,
    branch,
    sha,
    action,
    now,
    delivery,
  );
}

/** What the server's tick runs: each push a verified delivery left, with the person to run it as (whoever deployed the site last, else its owner). */
export function pendingPushes(
  ctx: Pick<Ctx, "db">,
): { id: string; siteId: string; branch: string; action: "preview" | "remove"; as: string }[] {
  const rows = ctx.db.all(
    "SELECT p.id AS id, p.site_id AS site_id, p.branch AS branch, p.action AS action, s.deployed_by AS deployed_by, s.owner AS owner FROM sites_push p JOIN sites_site s ON s.id = p.site_id WHERE p.done_at IS NULL AND s.deleted_at IS NULL ORDER BY p.at LIMIT 20",
  ) as Row[];
  return rows.map((r) => ({
    id: str(r.id),
    siteId: str(r.site_id),
    branch: str(r.branch),
    action: str(r.action) as "preview" | "remove",
    as: isNull(r.deployed_by) ? str(r.owner) : str(r.deployed_by),
  }));
}

export function markPushDone(ctx: Pick<Ctx, "db">, id: string): void {
  ctx.db.run("UPDATE sites_push SET done_at = ? WHERE id = ?", Date.now(), id);
}

/** A push that could not run: recorded as failed (the site's page says so), and its delivery id is given back, so GitHub's redelivery is taken and queues it again. */
export function markPushFailed(ctx: Pick<Ctx, "db">, id: string, why: string): void {
  const now = Date.now();
  const row = (ctx.db.all("SELECT site_id, delivery_id FROM sites_push WHERE id = ?", id) as Row[])[0];
  ctx.db.run(
    "UPDATE sites_push SET done_at = ?, failed_at = ?, error = ? WHERE id = ?",
    now,
    now,
    why.slice(0, 200),
    id,
  );
  if (row && !isNull(row.delivery_id)) {
    ctx.db.run("DELETE FROM sites_hook_delivery WHERE delivery_id = ? AND site_id = ?", row.delivery_id, row.site_id);
    ctx.db.run("DELETE FROM sites_hook_head WHERE delivery_id = ? AND site_id = ?", row.delivery_id, row.site_id);
  }
}

// ---- the site's settings for it

interface HookInfo {
  enabled: boolean;
  url?: string;
  follow: string[];
  secret?: string;
  lastDeliveryAt?: number;
  failed: { branch: string; action: string; error: string; at: number }[];
}

function info(ctx: Ctx, site: Row, secret?: string): HookInfo {
  const enabled = !isNull(site.hook_secret);
  const origin = routesHost()?.origin()?.origin;
  const last = (ctx.db.all("SELECT MAX(at) AS at FROM sites_hook_delivery WHERE site_id = ?", site.id) as Row[])[0]?.at;
  return {
    enabled,
    ...(enabled && origin ? { url: `${origin.replace(/\/+$/, "")}/hooks/sites` } : {}),
    follow: followList(site),
    ...(secret ? { secret } : {}),
    ...(typeof last === "number" ? { lastDeliveryAt: last } : {}),
    failed: (
      ctx.db.all(
        "SELECT branch, action, error, failed_at FROM sites_push WHERE site_id = ? AND failed_at IS NOT NULL ORDER BY failed_at DESC LIMIT 3",
        site.id,
      ) as Row[]
    ).map((r) => ({ branch: str(r.branch), action: str(r.action), error: str(r.error), at: Number(r.failed_at) })),
  };
}

async function webhookGet(ctx: Ctx, input: unknown): Promise<HookInfo> {
  return info(ctx, mustSite(ctx, reqStr(ctx, rec(ctx, input), "siteId")));
}

/** The branch patterns of a request, refused before anything is written: a name, a prefix ending in *, or *. */
function cleanFollow(ctx: Ctx, raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > MAX_FOLLOW)
    fail(ctx, "validation.bad_input", `A site follows at most ${MAX_FOLLOW} branch patterns.`, { field: "follow" });
  const list: string[] = [];
  for (const p of raw) {
    const s = typeof p === "string" ? p.trim() : "";
    if (!FOLLOW.test(s) || s.includes(".."))
      fail(ctx, "validation.bad_input", "A branch pattern is a name, a prefix ending in *, or *.", { field: "follow" });
    if (!list.includes(s)) list.push(s);
  }
  return list;
}

async function webhookSet(ctx: Ctx, input: unknown): Promise<HookInfo> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  if (!repoOfSite(site))
    fail(ctx, "validation.precondition_failed", "A webhook is for a site that comes from a GitHub repo.");
  const siteId = str(site.id);
  const enabled = optBool(ctx, o, "enabled");
  const rotate = optBool(ctx, o, "rotate") === true;
  const follow = o["follow"] === undefined ? null : cleanFollow(ctx, o["follow"]);
  const now = ctx.now();
  let shown: string | undefined;
  if (enabled === false) {
    ctx.db.run("UPDATE sites_site SET hook_secret = NULL, updated_at = ? WHERE id = ?", now, siteId);
    // what a delivery of the old secret left and has not run is not run after it is off
    ctx.db.run("UPDATE sites_push SET done_at = ? WHERE site_id = ? AND done_at IS NULL", now, siteId);
  } else if (enabled === true || rotate) {
    if (isNull(site.hook_secret) || rotate) {
      const secret = randomHex(32);
      ctx.db.run(
        "UPDATE sites_site SET hook_secret = ?, updated_at = ? WHERE id = ?",
        JSON.stringify(ctx.seal.seal(new TextEncoder().encode(secret), `site-hook:${siteId}`)),
        now,
        siteId,
      );
      if (rotate) ctx.db.run("UPDATE sites_push SET done_at = ? WHERE site_id = ? AND done_at IS NULL", now, siteId);
      shown = secret;
    }
  }
  if (follow !== null)
    ctx.db.run(
      "UPDATE sites_site SET hook_follow = ?, updated_at = ? WHERE id = ?",
      JSON.stringify(follow),
      now,
      siteId,
    );
  return info(ctx, mustSite(ctx, siteId), shown);
}

export const hookHandlers = {
  "sites.webhook_get": (ctx: Ctx, input: unknown) => webhookGet(ctx, input),
  "sites.webhook_set": (ctx: Ctx, input: unknown) => webhookSet(ctx, input),
};
