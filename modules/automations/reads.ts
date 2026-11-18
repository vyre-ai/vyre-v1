// What a Flow refers to is checked when it is saved (r40 audit, gaps 2, 3 and 4): a trigger filter may use only the keys its event carries, and every `{{ }}` must name something the Run will have.
// The audit found a record_change filter written with `field` that matched every record (the engine reads `fields`), a form filter on `recordType` that never matched (the payload says `type`), and
// `{{trigger.record.x}}` on a trigger that carried no record, each of which ran and sent an empty value. Pure: it reads the trigger and step catalogue.
// DECISION: a name under a record, a body, a header list or a step that returns free-form data is not checked past the part the catalogue names; a record's field names belong to its type, which this does not see.
import { registry } from "../../generated/registry.ts";
import { ROOTS, checkAgainst, nearest, readsOf, shapeOf, textsIn, unknownLine } from "../../lib/flow-reads.ts";
import type { Read, Shape } from "../../lib/flow-reads.ts";
import type { Definition, Node } from "./projections.ts";

export interface ReadIssue {
  nodeId?: string;
  message: string;
}

const TRIGGERS = new Map(registry.triggers.map((t) => [t.key, t] as const));
const STEPS = new Map(registry.steps.map((s) => [s.key, s] as const));
const EVENTS = new Map(registry.events.map((e) => [e.name, e] as const));
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const propsOf = (schema: unknown): string[] => {
  const p = (schema as { properties?: unknown } | null)?.properties;
  return isRec(p) ? Object.keys(p) : [];
};

// ---- trigger filters ----

/** The keys a trigger's filter may use: the filter the trigger declares, else what its event carries. Not `record`: the event does not hold the record, the Run does. */
export function filterKeys(key: string): string[] | undefined {
  const def = TRIGGERS.get(key);
  if (!def) return undefined;
  const src = def.source as { event?: string; events?: string[]; filter?: unknown };
  const names = src.events ?? (src.event ? [src.event] : []);
  if (names.length === 0) return undefined; // schedule, webhook, manual and button start without an event: there is nothing to filter
  const declared = propsOf(src.filter);
  if (declared.length) return declared;
  const have = new Set([...propsOf(def.payload), ...names.flatMap((n) => propsOf(EVENTS.get(n)?.payload))]);
  have.delete("record");
  return [...have];
}

/** One sentence per filter that cannot work: not an object, or a key the trigger does not have (with the nearest key that it does). */
export function filterIssues(def: Definition): ReadIssue[] {
  const out: ReadIssue[] = [];
  for (const t of def.triggers) {
    if (t.filter === undefined || t.filter === null) continue;
    const title = TRIGGERS.get(t.key)?.title ?? t.key;
    if (!isRec(t.filter)) {
      if (filterKeys(t.key)) out.push({ message: `The filter on "${title}" must be a set of key and value pairs.` });
      continue;
    }
    const allowed = filterKeys(t.key);
    if (!allowed) continue;
    for (const k of Object.keys(t.filter)) {
      if (allowed.includes(k)) continue;
      const near = nearest(k, allowed);
      out.push({
        message: `The filter on "${title}" uses "${k}", which this trigger does not have. ${
          near ? `Use "${near}". ` : ""
        }It can filter on: ${allowed.join(", ")}.`,
      });
    }
    if (t.key === "record_change" && t.filter["fields"] !== undefined && !Array.isArray(t.filter["fields"]))
      out.push({ message: `The "fields" filter on "${title}" must be a list of field names.` });
  }
  return out;
}

// ---- variables ----

/** What the Run's `trigger` holds across this definition's triggers: every part any of them carries. */
export function triggerShape(def: Definition): Shape | undefined {
  const props: Record<string, Shape> = {};
  let any = false;
  for (const t of def.triggers) {
    const d = TRIGGERS.get(t.key);
    if (!d) continue;
    any = true;
    for (const [k, v] of Object.entries(shapeOf(d.payload).props ?? {})) props[k] = props[k] ?? v;
  }
  return any ? { props } : undefined;
}

function checkRead(r: Read, def: Definition, ids: Set<string>): string | undefined {
  if (!ROOTS.includes(r.root)) {
    if (r.root === "now") return `{{${r.text}}} is not a variable. Use now() for the time.`;
    return unknownLine(r, 0, ROOTS);
  }
  if (r.root === "trigger" || r.root === "input") {
    const shape = triggerShape(def);
    if (!shape) return undefined;
    return checkAgainst(r, shape);
  }
  if (r.root === "steps") {
    const id = r.segs[0];
    if (id === undefined) return undefined;
    if (!ids.has(id)) {
      const near = nearest(id, [...ids]);
      return near
        ? `{{${r.text}}} points at a step called "${id}", which this Flow does not have. Did you mean steps.${near}.out${r.segs.length > 1 ? "..." : ""}?`
        : `{{${r.text}}} points at a step called "${id}", which this Flow does not have.`;
    }
    if (r.segs.length > 1 && r.segs[1] !== "out")
      return `{{${r.text}}} is not a variable. What a step returns is under steps.${id}.out, so use steps.${id}.out.${r.segs[1]}.`;
    if (r.segs.length > 2) {
      const key = byId(def, id)?.key;
      return checkAgainst(r, shapeOf(key ? STEPS.get(key)?.output : undefined), 2);
    }
  }
  return undefined;
}

const byId = (def: Definition, id: string): Node | undefined => def.nodes.find((n) => n.id === id);

/** One sentence per `{{ }}` that names something the Run will not have. */
export function variableIssues(def: Definition): ReadIssue[] {
  const out: ReadIssue[] = [];
  const ids = new Set(def.nodes.map((n) => n.id));
  for (const n of def.nodes) {
    const seen = new Set<string>();
    for (const text of [...textsIn(n.input), ...textsIn(n.ai ?? {})])
      for (const r of readsOf(text)) {
        if (seen.has(r.text)) continue;
        seen.add(r.text);
        const bad = checkRead(r, def, ids);
        if (bad) out.push({ nodeId: n.id, message: bad });
      }
  }
  return out;
}

/** Everything a saved Flow refers to that is not there. */
export function readIssues(def: Definition): ReadIssue[] {
  return [...filterIssues(def), ...variableIssues(def)];
}
