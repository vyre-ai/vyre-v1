// Join the generated tool list with the capability registry: a tool needs its capability's level, effects and Gate flag, and nothing may be added by hand.
import { connectCardOn, isConnectCap } from "../../../lib/connect-switch.ts";
import { probeIn } from "../../../lib/probe.ts";
import { fillsThread, forAskerField } from "./fill.ts";
import { placeField } from "./place.ts";
import { HIDDEN_FROM_MODEL } from "./versions.ts";
import { shareFragments } from "./share-fragments.ts";
import { MCP_TOOLS } from "../../../packages/contracts/src/mcp-coverage.ts";
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

/**
 * A size limit is part of what a model reads about an input: a text over it is refused, and a model that was never told the limit cannot write a call that fits. Every limit that a call can meet by writing
 * a longer text or a longer list (500 characters or more, 100 items or more) is said in the input's own description.
 */
export function statesLimits(v: unknown): unknown {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return v;
  const p = v as Record<string, unknown>;
  const out: Record<string, unknown> = { ...p };
  if (p["properties"] !== null && typeof p["properties"] === "object")
    out["properties"] = Object.fromEntries(
      Object.entries(p["properties"] as Record<string, unknown>).map(([k, x]) => [k, statesLimits(x)]),
    );
  if (p["items"] !== undefined) out["items"] = statesLimits(p["items"]);
  const says: string[] = [];
  const max = p["maxLength"];
  if (typeof max === "number" && max >= 500) says.push(`Max ${max} characters.`);
  const items = p["maxItems"];
  if (typeof items === "number" && items >= 100) says.push(`Max ${items} items.`);
  const min = p["minLength"];
  if (typeof min === "number" && min > 1) says.push(`Min ${min} characters.`);
  const already = typeof p["description"] === "string" ? (p["description"] as string) : "";
  const add = says.filter((x) => !already.includes(x));
  if (add.length > 0)
    out["description"] = `${already}${already === "" || /[.!?]$/.test(already) ? " " : ". "}${add.join(" ")}`.trim();
  return out;
}

/** The tools added for the full set (mcp-coverage.ts) show one plain line: the first sentence, cut at 100 characters. What a model is shown of its tools may only go down (scripts/tool-tokens.test.ts). */
export function oneLine(cap: string, text: string): string {
  if (!(cap in MCP_TOOLS)) return text;
  const first = (text.split(/\.(?:\s|$)|; /)[0] ?? text).replace(/^(Console|System|Space admins): /, "");
  const cut = first.length <= 100 ? first : `${first.slice(0, 97).replace(/\s+\S*$/, "")}...`;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}

/** Timestamps are written as epoch milliseconds in nearly every tool: one short word for it, and no floor (a time before 1970 is refused by the server all the same). */
function shortTimes(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(shortTimes);
  if (v === null || typeof v !== "object") return v;
  const o = v as Record<string, unknown>;
  if (o["description"] === "Milliseconds since the Unix epoch" && o["type"] === "integer") {
    const { minimum: _m, ...rest } = o;
    return { ...rest, description: "Epoch ms" };
  }
  return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, shortTimes(x)]));
}

export function modelSchema(schema: unknown, cap?: string): { schema: unknown; keyed: boolean; thread: boolean } {
  const raw = statesLimits(shortTimes(withoutPlaceholderExamples(schema))) as Obj | null;
  if (raw === null || typeof raw !== "object" || raw.properties === undefined)
    return { schema: raw, keyed: false, thread: false };
  // version inputs the tool layer fills for the model are not shown to it (agent/src/tools/versions.ts)
  const hide = cap === undefined ? undefined : HIDDEN_FROM_MODEL[cap];
  let props: Record<string, unknown> = { ...raw.properties };
  let required = [...(raw.required ?? [])];
  if (hide !== undefined) {
    props = Object.fromEntries(Object.entries(props).filter(([k]) => !hide.includes(k)));
    required = required.filter((r) => !hide.includes(r));
  }
  const keyed = "idempotencyKey" in props && required.includes("idempotencyKey");
  if (keyed) {
    delete props["idempotencyKey"];
    required = required.filter((r) => r !== "idempotencyKey");
  }
  // a chat the tool REQUIRES is this chat unless the model names another; a chat the tool takes as a filter (a search) is never filled: that would narrow the answer
  const thread =
    cap !== undefined &&
    required.includes("threadId") &&
    fillsThread({ cap, inputSchema: schema as ToolDef["inputSchema"] });
  if (thread) required = required.filter((r) => r !== "threadId");
  // who a new thing is for is the person the agent works for unless the model says another
  const whom = cap === undefined ? undefined : forAskerField(cap);
  if (whom !== undefined && whom in props) {
    const p = props[whom] as { description?: string };
    props[whom] = { ...p, description: p.description ?? "Who it is for. Leave it out for the person you work for." };
    required = required.filter((r) => r !== whom);
  }
  // a folder a new thing goes in is the person's own files unless the model names another (agent/src/tools/place.ts)
  const place = cap === undefined ? undefined : placeField(cap);
  if (place !== undefined && place in props) {
    const p = props[place] as { description?: string };
    props[place] = { ...p, description: p.description ?? "The folder. Leave it out for the person's own files." };
    required = required.filter((r) => r !== place);
  }
  const { required: _was, ...rest } = raw;
  return { schema: { ...rest, properties: props, ...(required.length > 0 ? { required } : {}) }, keyed, thread };
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
      summary: oneLine(cap.name, t.description),
      inputSchema: shown.schema,
      ...(shown.keyed ? { keyed: true } : {}),
      ...(shown.thread ? { thread: true } : {}),
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
  const all = shareFragments(defs);
  const byName = new Map(all.map((d) => [d.name, d] as const));
  return { all, byName: (n) => byName.get(n) };
}

/** What a plain key request says once the connect card is on (rc.29): a service the person names goes to the card, not to a request. Added at read time, so the frozen description is the rc.27 one and a switch at 0 shows none. */
export const POINT_TO_CARD = ". A service the person names (Fathom, Slack): use vault_connect instead";

/**
 * The same catalog, offering only tools that can work. `refuses` says a capability's handler only refuses (host/src/routes/deferred.ts), so no agent is told to use it, listed or searched.
 * It is asked on every read and names nothing, so a capability that goes live comes back by itself. A call by name still resolves and is refused, never an unknown tool.
 */
export function offerable(catalog: Catalog, refuses: (cap: string) => boolean): Catalog {
  return {
    get all() {
      // the connect card's tools too, while VYRE_CONNECT_CARD is off (lib/connect-switch.ts): not listed, not found with tool_search, and a call by name still resolves and is refused by the server
      const on = connectCardOn();
      return catalog.all
        .filter((t) => !refuses(t.cap) && (on || !isConnectCap(t.cap)))
        .map((t) => (on && t.name === "vault_request" ? { ...t, summary: `${t.summary}${POINT_TO_CARD}` } : t));
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
  // with the connect card on, its one tool is listed from the first turn (off: the frozen list is exactly the rc.27 one)
  if (connectCardOn()) out.add("vault_connect");
  return out;
}
