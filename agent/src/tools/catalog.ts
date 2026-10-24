// Join the generated tool list with the capability registry: a tool needs its capability's level, effects and Gate flag, and nothing may be added by hand.
import type { AgentToolRow, Catalog, Effects, LocalKind, McpToolRow, RegistryCapRow, ToolDef } from "./types.ts";

const EFFECT_RANK: Readonly<Record<Effects, number>> = { read: 0, write: 1, outward: 2 };
const LOCAL: ReadonlySet<string> = new Set(["terminal", "chrome", "screen", "files", "none"]);

export function buildCatalog(caps: readonly RegistryCapRow[], tools: readonly McpToolRow[], agentTools: readonly AgentToolRow[] = []): Catalog {
  const capBy = new Map(caps.map((c) => [`${c.name}@${c.v}`, c] as const));
  const localBy = new Map(agentTools.filter((a) => a.local !== undefined).map((a) => [a.name, a.local as string] as const));
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
    defs.push({
      name: t.name, cap: cap.name, v: cap.v, toolset: t.toolset, summary: t.description, inputSchema: t.inputSchema, effects, planMode: t.planMode,
      level: cap.level, deferred: t.deferred, blocks: [...(t.blocks ?? [])], local, gated: cap.gate !== undefined,
    });
  }
  const byName = new Map(defs.map((d) => [d.name, d] as const));
  return { all: defs, byName: (n) => byName.get(n) };
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
