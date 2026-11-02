// A Flow in plain words, from its definition and the step and trigger catalogue: "When a record changes", then one line per step, and a step that sends something marked as held for the person's yes.
// Built by code, so what the card in chat promises is what the definition does; an agent's own description is not trusted for it.
/** The parts of a definition the words need (modules/automations/projections.ts holds the full type). */
export interface FlowNode { id: string; key: string; title?: string; input?: Record<string, unknown>; next?: string[]; branches?: unknown[]; askBeforeSending?: boolean }
export interface FlowDefinition { triggers: { key: string }[]; nodes: FlowNode[]; start?: string[] }
type Node = FlowNode;
type Definition = FlowDefinition;

/** The catalogue the words come from: the registry's steps and triggers (a lib file does not import the registry, so the caller hands it in). */
export interface Catalogue { steps: readonly { key: string; title: string; effects?: string }[]; triggers: readonly { key: string; title: string }[] }

const lower = (s: string): string => (s.length > 1 && s[1] === s[1]!.toLowerCase() ? s[0]!.toLowerCase() + s.slice(1) : s);

/** The steps in the order they run: from the start steps, following next and branches, then any step nothing reached. */
function inOrder(def: Definition): Node[] {
  const byId = new Map(def.nodes.map((n) => [n.id, n] as const));
  const starts = (def.start && def.start.length ? def.start : def.nodes[0] ? [def.nodes[0].id] : []).filter((s) => byId.has(s));
  const seen = new Set<string>();
  const out: Node[] = [];
  const queue = [...starts];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = byId.get(id);
    if (!n) continue;
    out.push(n);
    for (const to of [...(n.next ?? []), ...(n.branches ?? []).map((b) => (b as { to?: string }).to).filter((x): x is string => typeof x === "string")]) queue.push(to);
  }
  for (const n of def.nodes) if (!seen.has(n.id)) out.push(n);
  return out;
}

/** One line per part: how it starts, then each step. This is what Turn on names: a step that sends (an email, a text, a post) says so, and a step set to ask says it is held for a yes. */
export function describeFlow(def: Definition, cat: Catalogue): string[] {
  const STEPS = new Map(cat.steps.map((s) => [s.key, s] as const));
  const TRIGGERS = new Map(cat.triggers.map((t) => [t.key, t] as const));
  const lines: string[] = [];
  const when = def.triggers.map((t) => TRIGGERS.get(t.key)?.title ?? t.key);
  lines.push(`When ${when.length === 0 ? "you run it" : when.map(lower).join(" or ")}`);
  for (const n of inOrder(def)) {
    const step = STEPS.get(n.key);
    const title = n.title?.trim() || step?.title || n.key;
    const sends = step?.effects === "outward" || (n.key === "code" && Array.isArray(n.input?.["hosts"]) && n.input["hosts"].length > 0);
    lines.push(`${lines.length === 1 ? "Then" : "Then"} ${lower(title)}${n.askBeforeSending === true ? ", held for your yes" : sends ? ", goes out once you turn this on" : ""}`);
  }
  if (def.nodes.length === 0) lines.push("It has no steps yet");
  return lines;
}
