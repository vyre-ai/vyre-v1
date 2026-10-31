// Which Automations use which Vault item. A step names an item by handle (#Acme_API or #Acme_API.api_key) in its input or its AI block; this reads those names and nothing else.
// The reply holds handles, Automation names and step titles. A Vault value is never read here, and the Automations listed are only the ones the caller may see.
import { allAutomations } from "../projections.ts";
import type { AutoCtx, Automation } from "../projections.ts";
import { canView } from "./defs.ts";

type In = { handle?: unknown };
interface Use { automationId: string; name: string; status: string; steps: { nodeId: string; title: string }[] }

const HANDLE = /#[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)?/g;

function strings(v: unknown, f: (s: string) => void): void {
  if (typeof v === "string") f(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, f);
  else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, f);
}

/** `#Acme_API.api_key` is the item `#Acme_API`. */
function itemOf(handle: string): string {
  const at = handle.indexOf(".");
  return at < 0 ? handle : handle.slice(0, at);
}

/** connectionId to the Vault handles that connection uses. A caller who cannot list connections sees only the handles written in steps. */
async function handlesByConnection(ctx: AutoCtx): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!ctx.call) return out;
  try {
    const r = (await ctx.call("connections.list", { whose: "all", limit: 500 })) as { connections?: { connectionId?: unknown; handles?: unknown }[] } | null;
    for (const c of r?.connections ?? []) {
      if (typeof c.connectionId === "string" && Array.isArray(c.handles)) out.set(c.connectionId, c.handles.filter((h): h is string => typeof h === "string"));
    }
  } catch { /* without the list, connector steps are not counted */ }
  return out;
}

function usesOf(a: Automation, conns: ReadonlyMap<string, string[]>): Map<string, Use> {
  const out = new Map<string, Use>();
  for (const n of a.definition.nodes) {
    const seen = new Set<string>();
    strings({ input: n.input, ai: n.ai }, (s) => { for (const m of s.match(HANDLE) ?? []) seen.add(itemOf(m)); });
    // a connector step names its connection; the connection names the Vault items behind it
    const cid = n.key === "connector_request" ? n.input?.["connectionId"] : undefined;
    if (typeof cid === "string") for (const h of conns.get(cid) ?? []) seen.add(itemOf(h));
    for (const item of seen) {
      const row = out.get(item) ?? { automationId: a.id, name: a.name, status: a.status, steps: [] };
      row.steps.push({ nodeId: n.id, title: n.title && n.title.trim() !== "" ? n.title : n.key });
      out.set(item, row);
    }
  }
  return out;
}

export async function vaultUsage(ctx: AutoCtx, input: In): Promise<{ uses: { handle: string; automations: Use[] }[] }> {
  const conns = await handlesByConnection(ctx);
  const only = typeof input.handle === "string" && input.handle !== "" ? itemOf(input.handle) : null;
  const byItem = new Map<string, Use[]>();
  for (const a of allAutomations(ctx.db)) {
    if (!canView(ctx, a)) continue;
    for (const [item, use] of usesOf(a, conns)) {
      if (only !== null && item !== only) continue;
      byItem.set(item, [...(byItem.get(item) ?? []), use]);
    }
  }
  return {
    uses: [...byItem.entries()].sort(([x], [y]) => (x < y ? -1 : 1)).map(([handle, automations]) => ({ handle, automations: automations.sort((p, q) => (p.name < q.name ? -1 : 1)) })),
  };
}
