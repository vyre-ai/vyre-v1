// From a saved definition (triggers, nodes with next and branches) to what the builder page draws (design 2.5): a trigger and the steps in the order they run, each a sentence with names and data chips,
// never a field key. Pure. The words about what is missing, who may not use an app and which steps send come in through `ctx`, from the server's own tables (lib/words/step-missing.ts, the full catalogue read).
// A step whose app this person may not use is kept whole with one plain line: an Automation someone else built always opens whole.
import { appMarkOfStep, glyphKeyOf } from "../picker/model.ts";
import { sentence } from "./model.ts";
import type { Need, StepIn, TriggerIn, Value } from "./model.ts";

export interface DefNodeIn {
  id: string;
  key: string;
  title?: string;
  input: Record<string, unknown>;
  next?: string[];
  branches?: { label: string; to: string; when?: string }[];
}
export interface DefIn {
  triggers: { key: string; config?: Record<string, unknown> }[];
  nodes: DefNodeIn[];
  start?: string[];
}

export interface AdaptCtx {
  /** The FULL catalogue by step key, including apps this person may not use. */
  catalog: Readonly<Record<string, { title: string; app?: { id: string; name: string } }>>;
  triggerTitles: Readonly<Record<string, string>>;
  /** The name a person knows a reference's source by: the trigger's title, or a step's sentence title. */
  nameOfNode(id: string): string;
  /** Sample values from a real past event, by `<node>.<path>`. */
  sample?: Readonly<Record<string, string>>;
  canUse(appId: string): boolean;
  /** A person, group or other thing named by an id in a step's input, as the name people know it by. */
  nameOfId?(id: string): string;
  noAccess?(appName: string): { line: string; button: string };
  /** The server's missing-thing words for a step, most important first. */
  needsOf(nodeId: string): Need[];
  /** False for a step kind this version does not know (read once the full catalogue is in). Omitted while the catalogue loads. */
  isKnown?(key: string): boolean;
  writes?(key: string): boolean;
}

const PREFIX: Readonly<Record<string, string>> = { to: "to ", channel: "in ", from: "from ", cc: "cc " };
const REF = /\{\{\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_.]+)\s*\}\}/g;

const human = (s: string): string => {
  const w = (s.split(".").at(-1) ?? s).replace(/[_-]+/g, " ").trim();
  return w === "" ? s : w.charAt(0).toUpperCase() + w.slice(1);
};

/** One reference as a chip: "Lead · Email", with the step it comes from named and the sample from a real event. */
function refChip(source: string, path: string, ctx: AdaptCtx): Value {
  // "steps.find.out.email" names the step find and its field email
  const st = source === "steps" ? /^([^.]+)\.out\.?(.*)$/.exec(path) : null;
  const node = st ? st[1]! : source;
  const field = st ? st[2]! : path;
  const from = ctx.nameOfNode(node);
  return {
    chip: {
      label: field === "" ? from : `${from} \u00b7 ${human(field)}`,
      from,
      sample: ctx.sample?.[`${node}.${field}`] ?? ctx.sample?.[`${source}.${path}`] ?? "",
    },
  };
}

/** A stored value as the page shows it: a lone reference is a chip, a text with references keeps its words. */
function valueOf(v: unknown, ctx: AdaptCtx): Value | undefined {
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return undefined;
    // an id never reaches the page: a person or thing a step names is shown by its name
    if (/^[a-z]{2,6}_[0-9a-f]{8,}$/.test(t)) return { text: ctx.nameOfId?.(t) ?? "Chosen" };
    const whole = new RegExp(`^${REF.source}$`).exec(t);
    if (whole) return refChip(whole[1]!, whole[2]!, ctx);
    return { text: t.replace(REF, (_m, _n, path: string) => human(path)) };
  }
  if (typeof v === "number" || typeof v === "boolean") return { text: String(v) };
  if (Array.isArray(v)) {
    const parts = v.map((x) => valueOf(x, ctx)).filter((x): x is Value => x !== undefined);
    return parts.length === 0
      ? undefined
      : { text: parts.map((p) => ("text" in p ? p.text : p.chip.label)).join(", ") };
  }
  if (v && typeof v === "object") {
    const o = v as { kind?: unknown; nodeId?: unknown; path?: unknown; value?: unknown; label?: unknown };
    if (o.kind === "ref" && typeof o.nodeId === "string" && typeof o.path === "string")
      return refChip(o.nodeId, o.path, ctx);
    if (o.kind === "literal") return valueOf(o.value, ctx);
    // a person (or another thing) chosen by id is shown by its name
    const who = v as { id?: unknown };
    if (typeof who.id === "string" && Object.keys(v as object).every((k) => k === "id" || k === "kind"))
      return { text: ctx.nameOfId?.(who.id) ?? "Chosen" };
    if (o.kind === "resource" && typeof o.label === "string") return { text: o.label };
  }
  return undefined;
}

function sentenceOf(
  title: string,
  input: Record<string, unknown>,
  ctx: AdaptCtx,
): { template: string; values: Record<string, Value | undefined> } {
  const values: Record<string, Value | undefined> = {};
  const bits: string[] = [];
  let i = 0;
  for (const [k, raw] of Object.entries(input)) {
    if (i >= 6) break;
    // a text that holds references keeps them as chips among its words: "Thanks, [Lead · Name]"
    if (typeof raw === "string" && /\{\{[^{}]*\}\}/.test(raw) && !new RegExp(`^${REF.source}$`).test(raw.trim())) {
      const pieces: string[] = [];
      let at = 0;
      for (const m of raw.matchAll(new RegExp(REF.source, "g"))) {
        if ((m.index ?? 0) > at) {
          values[`f${i}`] = { text: raw.slice(at, m.index) };
          pieces.push(`{f${i}}`);
          i++;
        }
        values[`f${i}`] = refChip(m[1]!, m[2]!, ctx);
        pieces.push(`{f${i}}`);
        i++;
        at = (m.index ?? 0) + m[0].length;
      }
      if (at < raw.length) {
        values[`f${i}`] = { text: raw.slice(at) };
        pieces.push(`{f${i}}`);
        i++;
      }
      bits.push(`${PREFIX[k] ?? ""}\u201c${pieces.join("")}\u201d`);
      continue;
    }
    const v = valueOf(raw, ctx);
    if (!v) continue;
    values[`f${i}`] = v;
    bits.push(`${PREFIX[k] ?? ""}{f${i}}`);
    i++;
  }
  return { template: bits.length === 0 ? title : `${title}: ${bits.join(", ")}`, values };
}

/** The quiet second line of a step: what its settings add to the sentence, in words ("to Phone, Message"). Absent when the first line already says it, never the title again. */
function detailOf(n: DefNodeIn, title: string, catalogTitle: string | undefined, ctx: AdaptCtx): string {
  if (!n.title?.trim()) return "";
  // an id is not words: a key like mailboxId or a value like mbx_1 never reaches the page
  const plain = Object.fromEntries(
    Object.entries(n.input).filter(
      ([k, v]) => (k in PREFIX || k === "subject") && !(typeof v === "string" && /^[a-z]{2,6}_[A-Za-z0-9]+$/.test(v)),
    ),
  );
  const s = sentenceOf("", plain, ctx);
  const bits = sentence({ template: s.template.replace(/^: /, ""), values: s.values }).text.trim();
  if (bits !== "" && bits !== title) return bits;
  return catalogTitle && catalogTitle !== title ? catalogTitle : "";
}

function loopHead(n: DefNodeIn, ctx: AdaptCtx): string {
  const v = valueOf(n.input["items"], ctx);
  const what = !v ? "" : "chip" in v ? v.chip.label : v.text;
  return what === "" ? "For each item:" : `For each item in ${what}:`;
}

export function fromDefinition(def: DefIn, ctx: AdaptCtx): { trigger: TriggerIn | null; steps: StepIn[] } {
  const by = new Map(def.nodes.map((n) => [n.id, n]));
  const t = def.triggers[0];
  let trigger: TriggerIn | null = null;
  if (t) {
    const title = ctx.triggerTitles[t.key] ?? human(t.key);
    const cfg = Object.entries(t.config ?? {}).find(([, v]) => typeof v === "string" && v !== "");
    trigger = {
      id: "trigger",
      app: { id: "vyre:trigger", name: title },
      template: cfg ? `${title}: {${cfg[0]}}` : title,
      values: cfg ? { [cfg[0]]: { text: String(cfg[1]) } } : {},
      hand: t.key === "manual" || t.key === "button",
    };
  }
  const seen = new Set<string>();
  const succ = (n: DefNodeIn): string[] =>
    n.key === "loop"
      ? (n.next ?? [])
      : n.branches && n.branches.length > 0
        ? n.branches.map((b) => b.to)
        : (n.next ?? []);
  const reach = (from: string): string[] => {
    const out: string[] = [];
    const s = new Set<string>();
    const walk = (id: string): void => {
      const n = by.get(id);
      if (!n || s.has(id)) return;
      s.add(id);
      out.push(id);
      for (const x of succ(n)) walk(x);
    };
    walk(from);
    return out;
  };
  const build = (n: DefNodeIn): StepIn => {
    const known = ctx.catalog[n.key];
    const title = n.title?.trim() || known?.title || human(n.key);
    // a step someone titled reads as that title: the title is already the sentence. An untitled one is its catalogue name and its first values
    // a kind this version does not know is shown as its own row, named, and is left exactly as saved
    const foreign = ctx.isKnown ? !ctx.isKnown(n.key) : false;
    const s = foreign
      ? {
          template: `A step this version can't show${n.title?.trim() ? `: ${n.title.trim()}` : ""} (${n.key})`,
          values: {},
        }
      : n.title?.trim()
        ? { template: title, values: {} }
        : sentenceOf(title, n.input, ctx);
    // the mark a step wears: an app's own for its own steps (the Drive mark for a Drive step), a Vyre glyph for Vyre's
    const own = appMarkOfStep({ key: n.key, title: "" });
    const connector =
      n.key === "connector_request" && typeof n.input["connector"] === "string" ? n.input["connector"] : null;
    const app = connector
      ? { id: connector, name: human(connector) }
      : known?.app
        ? { id: own ?? known.app.id, name: known.app.name }
        : { id: `vyre:${glyphKeyOf(n.key)}`, name: "Vyre" };
    const needs: Need[] = [];
    if (known?.app && !ctx.canUse(known.app.id)) {
      const w = ctx.noAccess?.(known.app.name) ?? { line: `You cannot use ${known.app.name}.`, button: "Ask an admin" };
      needs.push({ kind: "no_access", line: w.line, button: w.button });
    }
    needs.push(...ctx.needsOf(n.id));
    return {
      id: n.id,
      app,
      action: n.title?.trim()
        ? detailOf(n, title, known?.title, ctx)
        : Object.keys(s.values).length > 0
          ? (known?.title ?? human(n.key))
          : "",
      template: s.template,
      values: s.values,
      ...(needs.length > 0 ? { needs } : {}),
      ...(ctx.writes?.(n.key) ? { writes: true } : {}),
    };
  };
  const chain = (from: string | undefined, stop: string | null): StepIn[] => {
    const out: StepIn[] = [];
    let id = from;
    while (id && id !== stop && !seen.has(id)) {
      const n = by.get(id);
      if (!n) break;
      seen.add(id);
      const step = build(n);
      out.push(step);
      const lanes = n.branches ?? [];
      if (n.key === "paths" && lanes.length >= 2) {
        const sets = lanes.map((l) => new Set(reach(l.to)));
        const join = reach(lanes[0]!.to).find((x) => sets.every((st) => st.has(x))) ?? null;
        step.yes = chain(lanes[0]!.to, join);
        step.otherwise = lanes.slice(1).flatMap((l) => chain(l.to, join));
        id = join ?? undefined;
      } else if (lanes.length > 0) {
        // a loop's body or parallel lanes: one group under a one-line head, in run order
        const sets = lanes.map((l) => new Set(reach(l.to)));
        const join = lanes.length > 1 ? (reach(lanes[0]!.to).find((x) => sets.every((st) => st.has(x))) ?? null) : null;
        const inner = lanes.flatMap((l) => chain(l.to, join));
        step.group = { head: n.key === "loop" ? loopHead(n, ctx) : "At the same time:", steps: inner };
        id = join ?? (n.key === "loop" ? n.next?.[0] : undefined);
      } else id = n.next?.[0];
    }
    return out;
  };
  const roots = def.start && def.start.length > 0 ? def.start : def.nodes[0] ? [def.nodes[0].id] : [];
  const steps = roots.flatMap((r) => chain(r, null));
  // a step nothing leads to is still the person's: it is shown after the rest, never hidden
  for (const n of def.nodes) if (!seen.has(n.id)) steps.push(...chain(n.id, null));
  return { trigger, steps };
}
