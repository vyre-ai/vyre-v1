// Join the generated tool list with the capability registry: a tool needs its capability's level, effects and Gate flag, and nothing may be added by hand.
import { probeIn } from "../../../lib/probe.ts";
import { fillsThread } from "./fill.ts";
import type { AgentToolRow, Catalog, Effects, LocalKind, McpToolRow, RegistryCapRow, ToolDef } from "./types.ts";

const EFFECT_RANK: Readonly<Record<Effects, number>> = { read: 0, write: 1, outward: 2 };
const LOCAL: ReadonlySet<string> = new Set(["terminal", "chrome", "screen", "files", "none"]);

type Obj = { properties?: Record<string, unknown>; required?: string[]; [k: string]: unknown };

/**
 * What a model is shown of a tool's input. The idempotency key is the tool layer's, and a chat the tool names is this chat unless the model says another: neither is something it has to write, so neither is
 * listed as required (13 Nov 2026: "my first publish attempt was rejected as bad input" was a missing idempotencyKey that no description mentioned). The server still validates the full input.
 */
/**
 * An example in a schema is shown to a model that reads it (a CLI engine through the MCP bridge shows the whole schema). A model copies an example whole, and one that is a placeholder (an example.com address) is
 * refused by the placeholder guard (lib/probe.ts), so a first call that copied it fails. Those examples are not shown; an id's example stays, it shows the shape.
 */
function withoutPlaceholderExamples(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutPlaceholderExamples);
  if (v === null || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (k === "examples" && Array.isArray(x)) {
      const keep = x.filter((e) => probeIn(e) === null);
      if (keep.length > 0) out[k] = keep;
      continue;
    }
    out[k] = withoutPlaceholderExamples(x);
  }
  return out;
}

export function modelSchema(cap: string, schema: unknown): { schema: unknown; keyed: boolean } {
  const s = withoutPlaceholderExamples(schema) as Obj | null;
  if (s === null || typeof s !== "object" || s.properties === undefined) return { schema: s, keyed: false };
  const props = { ...s.properties };
  let required = [...(s.required ?? [])];
  const keyed = "idempotencyKey" in props && required.includes("idempotencyKey");
  if (keyed) {
    delete props["idempotencyKey"];
    required = required.filter((r) => r !== "idempotencyKey");
  }
  if (fillsThread({ cap, inputSchema: schema })) {
    const th = props["threadId"] as { description?: string } | undefined;
    if (th) props["threadId"] = { ...th, description: th.description ?? "The chat. Leave it out for this chat." };
    required = required.filter((r) => r !== "threadId");
  }
  return { schema: { ...s, properties: props, required }, keyed };
}

export function buildCatalog(
  caps: readonly RegistryCapRow[],
  tools: readonly McpToolRow[],
  agentTools: readonly AgentToolRow[] = [],
): Catalog {
  const capBy = new Map(caps.map((c) => [`${c.name}@${c.v}`, c] as const));
  const localBy = new Map(
    agentTools.filter((a) => a.local !== undefined).map((a) => [a.name, a.local as string] as const),
  );
  const defs: ToolDef[] = [];
  const seen = new Set<string>();
  for (const t of tools) {
    if (t.cap === null) throw new Error(`tool ${t.name} has no capability: every tool is backed by one`);
    if (seen.has(t.name)) throw new Error(`duplicate tool name ${t.name}`);
    seen.add(t.name);
    const cap = capBy.get(`${t.cap}@${t.v}`);
    if (!cap) throw new Error(`tool ${t.name} names capability ${t.cap}@${t.v}, which is not in the registry`);
    const raw = t.local ?? localBy.get(t.name) ?? "none";
    const local: LocalKind = LOCAL.has(raw) ? (raw as LocalKind) : "none";
    // The stricter of the two effect labels wins, so a tool can never look safer than its capability.
    const effects = EFFECT_RANK[cap.effects] >= EFFECT_RANK[t.effects] ? cap.effects : t.effects;
    const shown = modelSchema(cap.name, t.inputSchema);
    defs.push({
      name: t.name,
      cap: cap.name,
      v: cap.v,
      toolset: t.toolset,
      summary: t.description,
      inputSchema: shown.schema,
      ...(shown.keyed ? { keyed: true } : {}),
      effects,
      planMode: t.planMode,
      level: cap.level === "member" ? "view" : cap.level,
      deferred: t.deferred,
      blocks: [...(t.blocks ?? [])],
      local,
      gated: cap.gate !== undefined,
      ...(cap.resource?.id ? { resource: { type: cap.resource.type, id: cap.resource.id } } : {}),
    });
  }
  const byName = new Map(defs.map((d) => [d.name, d] as const));
  return { all: defs, byName: (n) => byName.get(n) };
}

/**
 * The same catalog, offering only tools that can work. `refuses` says a capability's handler only refuses (host/src/routes/deferred.ts), so no agent is told to use it, listed or searched.
 * It is asked on every read and names nothing, so a capability that goes live comes back by itself. A call by name still resolves and is refused, never an unknown tool.
 */
export function offerable(catalog: Catalog, refuses: (cap: string) => boolean): Catalog {
  return {
    get all() {
      return catalog.all.filter((t) => !refuses(t.cap));
    },
    byName: catalog.byName,
  };
}

/** The default listed tool names from the frozen table in docs/frozen/agent-tools.md: rows that start with "| `name` |" under "Default listed toolset". */
export function parseDefaultTools(markdown: string): Set<string> {
  const out = new Set<string>();
  const start = markdown.indexOf("## Default listed toolset");
  if (start < 0) throw new Error("no default listed toolset section");
  for (const line of markdown.slice(start).split("\n").slice(1)) {
    if (line.startsWith("## ")) break;
    const m = /^\| `([a-z][a-z0-9_]*)` \|/.exec(line);
    if (m?.[1]) out.add(m[1]);
  }
  return out;
}
