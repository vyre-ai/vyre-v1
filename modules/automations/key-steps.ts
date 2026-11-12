// Who may put a Vault key in a step (lead rule, 12 Nov 2026): a step may name a Vault item only if the person (or agent) who saves that version may use the item themselves. A step that names a key and
// whose address, headers or body changed needs that right again. Someone without it can still change every other step. A Run fills the key as the Automation, so this check at save is what stops an
// editor from pointing a key they cannot use at their own server. The host a key goes to is fixed in the step: an address whose host is filled in at run time cannot carry a key.
import { isTrustedService } from "../../lib/trust.ts";
import { hostOfUrl } from "../../lib/key-target.ts";
import { keyHostApproved } from "./key-hosts.ts";
import type { KeyHostDb } from "./key-hosts.ts";
import { raise } from "./projections.ts";
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
  }
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
