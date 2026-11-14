// The builder as one calm page (owner, 13 Nov 2026, design 2.5). Pure: the screen turns the saved definition into these inputs, and draws what comes back.
// A step is a sentence with real names; what is missing is one orange line and one button; the trigger is When and steps count from 1.

export type Value = { text: string } | { chip: { label: string; from: string; sample: string } };

export interface Need {
  kind: "no_access" | "allow" | "connect" | "ask_admin" | "unclear" | "unmapped" | "channel" | "value";
  line: string;
  button: string;
  /** Not asked yet: one thing is asked at a time, so the step stays quiet until its turn. */
  queued?: boolean;
}

export interface StepIn {
  id: string;
  app: { id: string; name: string };
  /** The quiet second line: the action's name. */
  action: string;
  /** The sentence with `{field}` blanks. */
  template: string;
  values: Record<string, Value | undefined>;
  needs?: Need[];
  /** Sends, writes or tells someone: a test shows it and does not do it. */
  writes?: boolean;
  proposed?: boolean;
  yes?: StepIn[];
  otherwise?: StepIn[];
  /** A loop or parallel lanes: one indented group under a one-line head ("For each row in Leads:", "At the same time:"). */
  group?: { head: string; steps: StepIn[] };
}

export interface TriggerIn {
  id: string;
  app: { id: string; name: string };
  template: string;
  values: Record<string, Value | undefined>;
  hand: boolean;
}

export type Part = { t: "text"; v: string } | { t: "chip"; label: string; tip: string } | { t: "blank" };

export interface Sentence {
  parts: Part[];
  /** The same sentence as plain words, for the run page and for screen readers. */
  text: string;
}

const DANGLING = /\b(from|to|in|for|with|on|at|by|of|about|into)\s*$/i;

export function sentence(s: { template: string; values: Record<string, Value | undefined> }): Sentence {
  const parts: Part[] = [];
  const re = /\{(\w+)\}/g;
  let at = 0;
  let text = "";
  const push = (p: Part, plain: string) => {
    parts.push(p);
    text += plain;
  };
  for (let m = re.exec(s.template); m; m = re.exec(s.template)) {
    if (m.index > at) push({ t: "text", v: s.template.slice(at, m.index) }, s.template.slice(at, m.index));
    const v = s.values[m[1]!];
    if (!v) push({ t: "blank" }, "…");
    else if ("chip" in v)
      push(
        { t: "chip", label: v.chip.label, tip: `From: ${v.chip.from}\n${v.chip.label}: ${v.chip.sample}` },
        v.chip.label,
      );
    else push({ t: "text", v: v.text }, v.text);
    at = m.index + m[0].length;
  }
  if (at < s.template.length) push({ t: "text", v: s.template.slice(at) }, s.template.slice(at));
  // a sentence never ends on a preposition: what should follow it is not there yet, so the blank says so
  const last = parts.at(-1);
  if (last && last.t === "text" && DANGLING.test(last.v)) push({ t: "blank" }, "\u2026");
  return { parts, text };
}

export interface TestResult {
  status: "ok" | "stop";
  line: string;
  values: readonly (readonly [string, string])[];
}

export interface StoryIn {
  name: string;
  on: boolean;
  trigger: TriggerIn | null;
  /** The other triggers of an Automation that several things start: each its own row, Or. */
  moreTriggers?: readonly TriggerIn[];
  steps: readonly StepIn[];
  /** The Assistant's draft is on the page and not accepted. */
  proposed: boolean;
  /** An On Automation whose draft differs from what is live. */
  dirty: boolean;
  /** local: edits are kept on this screen until Save (today). draft: the server holds a draft next to what is live. */
  saveMode?: "local" | "draft";
  test: { caseName: string; results: Record<string, TestResult | undefined> } | null;
}

export type StoryRow =
  | { kind: "trigger"; id: string; label: "When" | "Or"; app: { id: string; name: string }; sentence: Sentence }
  | { kind: "label"; label: "If yes" | "Otherwise"; depth: number }
  | { kind: "head"; text: string; depth: number }
  | {
      kind: "step";
      id: string;
      number: number;
      depth: number;
      app: { id: string; name: string };
      sentence: Sentence;
      action: string;
      need: Need | null;
      proposed: boolean;
    };

export interface Bar {
  kind: "draft" | "live" | "test";
  text: string;
  actions: string[];
}

export interface Head {
  name: string;
  state: string;
  primary: { label: "Turn on" | "Run now" | "Turn off"; disabled?: boolean; why?: string } | null;
  /** A quiet Turn off beside Run now. */
  secondary: { label: "Turn off" } | null;
  test: boolean;
}

export interface Story {
  head: Head;
  bars: Bar[];
  rows: StoryRow[];
  /** Steps with their one missing thing showing. */
  needsYou: number;
  /** Ids after which a step can be added: every trigger and step row but the last, branches included. */
  slots: string[];
}

const MISSING_ORDER: Need["kind"][] = [
  "no_access",
  "ask_admin",
  "allow",
  "connect",
  "unclear",
  "unmapped",
  "channel",
  "value",
];

/** One missing thing per step: the most important that is being asked now. */
export function needOf(s: StepIn): Need | null {
  const live = (s.needs ?? []).filter((n) => !n.queued);
  if (live.length === 0) return null;
  const first = [...live].sort((a, b) => MISSING_ORDER.indexOf(a.kind) - MISSING_ORDER.indexOf(b.kind))[0]!;
  return { kind: first.kind, line: first.line, button: first.button };
}

type Flat = { s: StepIn; depth: number; label?: "If yes" | "Otherwise"; head?: string };

function flatten(steps: readonly StepIn[], depth: number, out: Flat[]): void {
  for (const s of steps) {
    out.push({ s, depth });
    if (s.yes || s.otherwise) {
      out.push({ s, depth: depth + 1, label: "If yes" });
      flatten(s.yes ?? [], depth + 1, out);
      out.push({ s, depth: depth + 1, label: "Otherwise" });
      flatten(s.otherwise ?? [], depth + 1, out);
    }
    if (s.group) {
      out.push({ s, depth: depth + 1, head: s.group.head });
      flatten(s.group.steps, depth + 1, out);
    }
  }
}

/** Every step in the order it runs, branches inline. The one place numbering comes from: the builder, the run page and the first page count the same way. */
export function ordered(steps: readonly StepIn[]): { step: StepIn; number: number; depth: number }[] {
  const flat: Flat[] = [];
  flatten(steps, 0, flat);
  let n = 0;
  return flat.filter((f) => !f.label && !f.head).map((f) => ({ step: f.s, number: ++n, depth: f.depth }));
}

export function draftState(i: { on: boolean; live: unknown; draft: unknown }): "off" | "clean" | "dirty" {
  if (!i.on) return "off";
  return stable(i.live) === stable(i.draft) ? "clean" : "dirty";
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

export function story(i: StoryIn): Story {
  const flat: Flat[] = [];
  flatten(i.steps, 0, flat);
  const all = flat.filter((f) => !f.label && !f.head).map((f) => f.s);
  const rows: StoryRow[] = [];
  if (i.trigger) rows.push({ kind: "trigger", id: i.trigger.id, label: "When", app: i.trigger.app, sentence: sentence(i.trigger) });
  for (const t of i.moreTriggers ?? []) rows.push({ kind: "trigger", id: t.id, label: "Or", app: t.app, sentence: sentence(t) });
  let n = 0;
  for (const f of flat) {
    if (f.label) {
      rows.push({ kind: "label", label: f.label, depth: f.depth });
      continue;
    }
    if (f.head) {
      rows.push({ kind: "head", text: f.head, depth: f.depth });
      continue;
    }
    rows.push({
      kind: "step",
      id: f.s.id,
      number: ++n,
      depth: f.depth,
      app: f.s.app,
      sentence: sentence(f.s),
      action: f.s.action,
      need: needOf(f.s),
      proposed: i.proposed || f.s.proposed === true,
    });
  }
  const needsYou = rows.filter((r) => r.kind === "step" && r.need).length;
  const hasContent = i.trigger !== null || all.length > 0;
  const hand = i.trigger?.hand === true;
  const local = i.saveMode === "local";
  const state = i.on
    ? i.dirty
      ? local
        ? "On, you have unsaved changes"
        : "On, your changes are a draft"
      : "On"
    : hasContent
      ? "Off, saved as a draft"
      : "Off";
  let primary: Head["primary"] = null;
  let secondary: Head["secondary"] = null;
  if (hasContent && !(local && i.dirty)) {
    if (!i.on) {
      primary = { label: "Turn on" };
      if (needsYou > 0)
        primary = {
          label: "Turn on",
          disabled: true,
          why: needsYou === 1 ? "1 step needs you" : `${needsYou} steps need you`,
        };
    } else if (!i.dirty) {
      if (hand) primary = { label: "Run now" };
      secondary = { label: "Turn off" };
    }
  }
  const bars: Bar[] = [];
  if (i.proposed)
    bars.push({
      kind: "draft",
      text: `Assistant’s draft, ${all.length} ${all.length === 1 ? "step" : "steps"}. Nothing is on yet.`,
      actions: ["Discard", "Change", "Accept"],
    });
  if (i.dirty && local)
    bars.push({
      kind: "live",
      text: i.on
        ? "You have changes that are not saved yet. Saving makes them live."
        : "You have changes that are not saved yet.",
      actions: ["Discard", "Save"],
    });
  else if (i.dirty && i.on)
    bars.push({
      kind: "live",
      text: "Your changes are saved as a draft, not live. Runs already started finish as they were.",
      actions: ["Discard", "Make live"],
    });
  if (i.test)
    bars.push({
      kind: "test",
      text: `Test with ${i.test.caseName}. The test sent nothing.`,
      actions: ["Run again", "Done"],
    });
  const lastTrigger = rows.map((r) => r.kind).lastIndexOf("trigger");
  const ids = rows.flatMap((r, at) => (r.kind === "step" || (r.kind === "trigger" && at === lastTrigger) ? [r.id] : []));
  return {
    head: { name: i.name, state, primary, secondary, test: hasContent },
    bars,
    rows,
    needsYou,
    slots: ids.slice(0, -1),
  };
}

export interface TestRow {
  id: string;
  mark: "done" | "stopped" | "skipped";
  /** Not sent: the step sends or writes, and the test did not. */
  tag: "Not sent" | null;
  line: string | null;
  values: readonly (readonly [string, string])[];
  need: Need | null;
}

/**
 * What Test shows for each step, in order. It tries the draft; the first step that needs something stops it ("Stopped here", with the same orange line and button) and the steps after it are not reached.
 * A step that sends or writes is labelled Not sent.
 */
export function testView(steps: readonly StepIn[], results: Record<string, TestResult | undefined>): TestRow[] {
  const out: TestRow[] = [];
  let stopped = false;
  for (const { step } of ordered(steps)) {
    if (stopped) {
      out.push({ id: step.id, mark: "skipped", tag: null, line: null, values: [], need: null });
      continue;
    }
    const need = needOf(step);
    const r = results[step.id];
    if (need || r?.status === "stop") {
      stopped = true;
      out.push({ id: step.id, mark: "stopped", tag: null, line: "Stopped here", values: [], need });
      continue;
    }
    if (!r) {
      out.push({ id: step.id, mark: "skipped", tag: null, line: null, values: [], need: null });
      continue;
    }
    out.push({
      id: step.id,
      mark: "done",
      tag: step.writes ? "Not sent" : null,
      line: r.line,
      values: r.values,
      need: null,
    });
  }
  return out;
}
