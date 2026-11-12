// Who may put a Vault key in a step (lead rule, 12 Nov 2026): a step may name a Vault item only if the person (or agent) who saves that version may use the item themselves. A step that names a key and
// whose address, headers or body changed needs that right again. Someone without it can still change every other step. A Run fills the key as the Automation, so this check at save is what stops an
// editor from pointing a key they cannot use at their own server. The host a key goes to is fixed in the step: an address whose host is filled in at run time cannot carry a key.
import { isTrustedService } from "../../lib/trust.ts";
import { hostOfUrl } from "../../lib/key-target.ts";
import { allowKeyHost, keyHostApproved } from "./key-hosts.ts";
import type { KeyHostDb } from "./key-hosts.ts";
import { keyRefResolver, keyUsableBy } from "./key-ref-port.ts";
import { allAutomations, raise } from "./projections.ts";
import type { AutoCtx, Definition } from "./projections.ts";

const HANDLE = /#[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)?/g;
const USE = new Set(["use", "edit", "manage"]);

function strings(v: unknown, f: (s: string) => void): void {
  if (typeof v === "string") f(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, f);
  else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, f);
}
const itemOf = (h: string): string => { const at = h.indexOf("."); return (at < 0 ? h : h.slice(0, at)).toLowerCase(); };

type Node = Definition["nodes"][number];

async function connectionHandles(ctx: AutoCtx): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!ctx.call) return out;
  try {
    const r = (await ctx.call("connections.list", { whose: "all", limit: 500 })) as { connections?: { connectionId?: unknown; handles?: unknown }[] } | null;
    for (const c of r?.connections ?? []) if (typeof c.connectionId === "string" && Array.isArray(c.handles)) out.set(c.connectionId, c.handles.filter((h): h is string => typeof h === "string"));
  } catch { /* without the list a connector step's key is not known here; the Run's own fill still decides */ }
  return out;
}

function handlesOf(n: Node, conns: ReadonlyMap<string, string[]>): Set<string> {
  const seen = new Set<string>();
  strings({ input: n.input, ai: (n as { ai?: unknown }).ai }, (s) => { for (const m of s.match(HANDLE) ?? []) seen.add(itemOf(m)); });
  const cid = n.key === "connector_request" ? (n.input as Record<string, unknown> | undefined)?.["connectionId"] : undefined;
  if (typeof cid === "string") for (const h of conns.get(cid) ?? []) seen.add(itemOf(h));
  return seen;
}

const sameStep = (a: Node | undefined, b: Node): boolean => a !== undefined && a.key === b.key && JSON.stringify(a.input ?? null) === JSON.stringify(b.input ?? null) && JSON.stringify((a as { ai?: unknown }).ai ?? null) === JSON.stringify((b as { ai?: unknown }).ai ?? null);

/** A request that carries a key goes to a host written in the step. */
function hostIsComputed(n: Node): boolean {
  const input = n.input as Record<string, unknown> | undefined;
  if (n.key !== "http_request" || !input || input["auth"] === undefined || input["auth"] === null || typeof input["url"] !== "string") return false;
  const m = /^\s*([a-z]+:\/\/)?([^/?#]*)/i.exec(input["url"]);
  return !m || !m[1] || /\{\{|\$\{|\{/.test(m[2] ?? "");
}

/** Refuses a save that puts a key the caller cannot use into a new or changed step, or sends a key to a computed host. `before` is the version being replaced (none for a new Automation). */
export async function guardKeySteps(ctx: AutoCtx, before: Definition | undefined, after: Definition): Promise<void> {
  const nodes = after.nodes ?? [];
  nodes.forEach((n, i) => {
    if (hostIsComputed(n)) raise(ctx, "validation.bad_input", `Step ${i + 1} sends a key to an address filled in when it runs. Write the host in the step; only the path can come from earlier steps.`, { reason: "computed_key_host", step: n.id });
  });
  if (isTrustedService(ctx.principal)) return;
  const conns = await connectionHandles(ctx);
  const changed: { index: number; node: Node; handles: Set<string> }[] = [];
  nodes.forEach((n, index) => {
    const handles = handlesOf(n, conns);
    if (handles.size === 0) return;
    if (sameStep(before?.nodes.find((p) => p.id === n.id), n)) return;
    changed.push({ index, node: n, handles });
  });
  if (changed.length === 0) return;
  const usable = new Set<string>();
  const ids = new Map<string, string>();
  if (ctx.call) {
    try {
      const out = (await ctx.call("vault.items.list", { limit: 500 })) as { items?: { id?: unknown; handle?: unknown; yourLevel?: unknown }[] } | null;
      for (const i of out?.items ?? []) {
        if (typeof i.handle !== "string" || typeof i.yourLevel !== "string" || !USE.has(i.yourLevel)) continue;
        usable.add(i.handle.toLowerCase());
        if (typeof i.id === "string") ids.set(i.handle.toLowerCase(), i.id);
      }
    } catch { /* the Vault did not answer: nothing counts as usable */ }
  }
  for (const c of changed) {
    const missing = [...c.handles].find((h) => !usable.has(h));
    if (missing) raise(ctx, "permission.no_grant", `Step ${c.index + 1} uses a key you cannot use. Ask someone who can use it to publish this change, or remove the key from the step.`, { reason: "key_not_yours", step: c.node.id });
  }
  // an agent (anything but a person) writing a step that sends a key: the host must be one a person approved for that key, as for the test read. A test run would otherwise send it there at once.
  if (ctx.principal.kind !== "person") {
    for (const c of changed) await agentHostApproved(ctx, c.index, c.node, ids);
    return;
  }
  // a person who may use the key saved a step that sends it to a host: that host is approved for the key by them ("Sent to" on the key lists it, and removing it stops the step)
  recordStepHosts(ctx, changed.map((c) => c.node), ids);
}

/** The literal host each key-bearing HTTP step sends to, recorded as approved for its key by the person saving (`ids`: their usable keys, handle to item id). */
export function recordStepHosts(ctx: AutoCtx, nodes: readonly Node[], ids: ReadonlyMap<string, string>, by = ctx.principal.id, marker = true): number {
  let n0 = 0;
  for (const n of nodes) {
    const input = n.input as Record<string, unknown> | undefined;
    const auth = input?.["auth"] as { handle?: unknown } | undefined;
    if (n.key !== "http_request" || !input || typeof input["url"] !== "string" || !auth || typeof auth.handle !== "string") continue;
    const host = hostOfUrl(input["url"]);
    const itemId = ids.get(itemOf(auth.handle));
    if (host === null || itemId === undefined) continue;
    if (marker) allowKeyHost(ctx.db as unknown as KeyHostDb, itemId, host, by, ctx.now());
    else (ctx.db as unknown as KeyHostDb).run(`INSERT OR IGNORE INTO automations_key_hosts (item_id, host, by, at) VALUES (?, ?, ?, ?)`, itemId, host, by, ctx.now());
    n0 += 1;
  }
  return n0;
}

/** The keys the caller may use, handle (lower case, #Name) to item id. */
export async function usableKeyIds(ctx: AutoCtx): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  if (!ctx.call) return ids;
  try {
    const out = (await ctx.call("vault.items.list", { limit: 500 })) as { items?: { id?: unknown; handle?: unknown; yourLevel?: unknown }[] } | null;
    for (const i of out?.items ?? []) if (typeof i.handle === "string" && typeof i.id === "string" && typeof i.yourLevel === "string" && USE.has(i.yourLevel)) ids.set(i.handle.toLowerCase(), i.id);
  } catch { /* nothing usable */ }
  return ids;
}

async function agentHostApproved(ctx: AutoCtx, index: number, n: Node, ids: ReadonlyMap<string, string>): Promise<void> {
  const input = n.input as Record<string, unknown> | undefined;
  if (n.key !== "http_request" || !input || typeof input["url"] !== "string") return;
  const auth = input["auth"] as { handle?: unknown } | undefined;
  if (!auth || typeof auth.handle !== "string") return;
  const host = hostOfUrl(input["url"]);
  const handle = itemOf(auth.handle);
  const itemId = ids.get(handle);
  if (host !== null && itemId !== undefined) {
    if (keyHostApproved(ctx.db as unknown as KeyHostDb, itemId, host)) return;
    // the item's own saved address counts for its exact host only (a saved address on a shared hosting domain must not approve other tenants' subdomains)
    const hits = async (h: string): Promise<boolean> => {
      try {
        const m = ctx.call ? (await ctx.call("vault.items.match", { url: `https://${h}/` })) as { items?: { item?: { id?: unknown } }[] } | null : null;
        return (m?.items ?? []).some((x) => x.item?.id === itemId);
      } catch { return false; }
    };
    const dot = host.indexOf(".");
    const parent = dot > 0 && !host.startsWith("[") ? host.slice(dot + 1) : "";
    if (await hits(host) && (parent === "" || !parent.includes(".") || !(await hits(parent)))) return;
  }
  const named = auth.handle.split(".")[0] ?? "";
  raise(ctx, "permission.no_grant", `Step ${index + 1} sends ${/^#[A-Za-z0-9_]{1,80}$/.test(named) ? named : "a key"} to ${host ?? "an address"}, which nobody approved for this key. A person allows the host on the key first.`, { reason: "key_host_unapproved", step: n.id, ...(host ? { host } : {}) });
}

const BACKFILLED = "automations.key_hosts_backfilled";

/**
 * Once, after the update that made keys go only to approved hosts: a key-bearing HTTP step's host is approved for its key only where a PERSON chose it, that is, the newest version of the Automation
 * that holds that exact step (same id, kind and input) was saved by a person; it is attributed to them. A step only an agent ever saved is not adopted: its next Run stops with the plain line and a
 * person allows the host on the key's page. These rows do not mark the key's list as kept by people, so a connector a person bound before the update is still adopted on first use.
 */
export async function backfillStepHosts(ctx: AutoCtx): Promise<number> {
  if (ctx.db.all("SELECT 1 AS x FROM automations_policy WHERE policy_key = ?", BACKFILLED).length > 0) return 0;
  const usable = keyUsableBy();
  if (!keyRefResolver() || !usable) return 0;   // the host's reading of keys is not wired yet: the next tick tries again
  let done = 0;
  // only Automations that are on, from the version that runs (the one turned on, or saved while on), and only when a person saved that version and may use the key. Anything else is not
  // recorded: its next Run refuses the step with the plain line and the key's page offers Allow to someone who may use it.
  for (const a of allAutomations(ctx.db)) {
    if (a.status !== "on") continue;
    const v = (ctx.db.all("SELECT by_who, definition FROM automations_versions WHERE automation_id = ? AND n = ?", a.id, a.version) as { by_who: string; definition: string }[])[0];
    if (!v || typeof v.by_who !== "string" || !v.by_who.startsWith("usr_")) continue;
    let def: Definition | null = null;
    try { def = JSON.parse(v.definition) as Definition; } catch { def = null; }
    const steps = (def?.nodes ?? []).filter((n) => a.definition.nodes.some((cur) => sameStep(cur, n)));
    if (steps.length === 0) continue;
    let ids: ReadonlyMap<string, string>;
    try { ids = await usable(v.by_who); } catch { continue; }
    done += recordStepHosts(ctx, steps, ids, v.by_who, false);
  }
  ctx.db.run("INSERT OR REPLACE INTO automations_policy (policy_key, policy_value) VALUES (?, ?)", BACKFILLED, "true");
  return done;
}
