// Join the generated tool list with the capability registry: a tool needs its capability's level, effects and Gate flag, and nothing may be added by hand.
import { HIDDEN_FROM_MODEL } from "./versions.ts";
import type { AgentToolRow, Catalog, Effects, LocalKind, McpToolRow, RegistryCapRow, ToolDef } from "./types.ts";

const EFFECT_RANK: Readonly<Record<Effects, number>> = { read: 0, write: 1, outward: 2 };
const LOCAL: ReadonlySet<string> = new Set(["terminal", "chrome", "screen", "files", "none"]);

type Obj = { properties?: Record<string, unknown>; required?: string[]; [k: string]: unknown };

/**
 * What a model is shown of a tool's input. The idempotency key is the tool layer's, so it is not listed and not required (13 Nov 2026: "my first publish attempt was rejected as bad input" was a missing idempotencyKey that
 * no description mentioned). The server still validates the full input.
 */
export function modelSchema(schema: unknown, cap?: string): { schema: unknown; keyed: boolean } {
  const raw = schema as Obj | null;
  if (raw === null || typeof raw !== "object" || raw.properties === undefined) return { schema, keyed: false };
  // version inputs the tool layer fills for the model are not shown to it (agent/src/tools/versions.ts)
  const hide = cap === undefined ? undefined : HIDDEN_FROM_MODEL[cap];
  let props: Record<string, unknown> = raw.properties;
  let required = raw.required ?? [];
  if (hide !== undefined) {
    props = Object.fromEntries(Object.entries(props).filter(([k]) => !hide.includes(k)));
    required = required.filter((r) => !hide.includes(r));
  }
  const s: Obj = hide === undefined ? raw : { ...raw, properties: props, required };
  const keyed = "idempotencyKey" in props && required.includes("idempotencyKey");
  if (!keyed) return { schema: s, keyed: false };
  const { idempotencyKey: _k, ...rest } = props;
  return {
    schema: { ...s, properties: rest, required: required.filter((r) => r !== "idempotencyKey") },
    keyed: true,
  };
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
    const shown = modelSchema(t.inputSchema, cap.name);
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
