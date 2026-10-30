// The Automation canvas model (spec 3.7, 2.12; ARCH 7.7; its tests are model.test.ts), from kernel/flows/canvas.js of 0.6 reworked for the v1 definition (triggers + nodes with next/branches).
// Everything here is data in, data out: the layout of a definition into cards and connectors, the lane a run took, the edits a person makes (add, remove, move, rename),
// and the local check that mirrors `automations.validate`, so errors show inline while someone builds, before the server answers.
import type { CapMap } from "../../../../../../generated/types.ts";
import { messageSummary } from "../builder/compose.ts";
import { LOOP_CHILD, PARALLEL_JOIN, parallelLaneMark } from "../chrome.ts";

export type Automation = CapMap["automations.get"]["out"]["automation"];
export type Definition = Automation["definition"];
export type DefNode = Definition["nodes"][number];
export type DefTrigger = Definition["triggers"][number];
export interface KeyChoice { id: string; name: string; kind: "subscription" | "api" }
export type Issue = CapMap["automations.validate"]["out"]["issues"][number];

// ---------------------------------------------------------------- step kinds

export type StepKind = "plain" | "ai" | "paths" | "parallel" | "wait" | "loop" | "approval" | "stop";
export type IconKey =
  | "bolt" | "clock" | "hook" | "inbox" | "mail" | "chat" | "sheet" | "ci" | "meeting" | "stage" | "reply" | "button" | "hand" | "record"
  | "search" | "plus" | "edit" | "task" | "send" | "phone" | "ai" | "journey" | "hourglass" | "branch" | "parallel" | "loop" | "stop" | "shield" | "sign" | "code";

/** Glyphs and fallback titles for cards already on the canvas. The add menu loads automations.steps.list. This list is not the product catalog. */
export const STEP_PALETTE: readonly { key: string; title: string; group: string; icon: IconKey }[] = [
  { key: "records.find", title: "Find records", group: "Data", icon: "search" },
  { key: "records.create", title: "Create a record", group: "Data", icon: "plus" },
  { key: "records.update", title: "Update a record", group: "Data", icon: "edit" },
  { key: "create_task", title: "Create a task", group: "Data", icon: "task" },
  { key: "send_email", title: "Send an email", group: "Send", icon: "send" },
  { key: "send_sms", title: "Send a text message", group: "Send", icon: "phone" },
  { key: "post_message", title: "Post a chat message", group: "Send", icon: "chat" },
  { key: "ai", title: "AI step", group: "People and agents", icon: "ai" },
  { key: "approval", title: "Approval", group: "People and agents", icon: "shield" },
  { key: "paths", title: "Paths", group: "Flow", icon: "branch" },
  { key: "parallel", title: "Parallel", group: "Flow", icon: "parallel" },
  { key: "loop", title: "Loop", group: "Flow", icon: "loop" },
  { key: "wait", title: "Wait", group: "Flow", icon: "hourglass" },
  { key: "stop", title: "Stop", group: "Flow", icon: "stop" },
  { key: "transform", title: "Transform", group: "Flow", icon: "edit" },
  { key: "collect", title: "Collect", group: "Flow", icon: "loop" },
  { key: "group_by", title: "Group by", group: "Flow", icon: "branch" },
  { key: "call_automation", title: "Run another automation", group: "Flow", icon: "journey" },
  { key: "start_journey", title: "Start a Journey", group: "Journeys", icon: "journey" },
  { key: "wait_stage", title: "Wait for a Journey stage", group: "Journeys", icon: "hourglass" },
  { key: "sheet.add_rows", title: "Add rows", group: "Spreadsheets", icon: "sheet" },
  { key: "sheet.find_rows", title: "Find rows", group: "Spreadsheets", icon: "search" },
  { key: "sheet.update_rows", title: "Update rows", group: "Spreadsheets", icon: "edit" },
  { key: "sign", title: "Send for signature", group: "Documents", icon: "sign" },
  { key: "connector_request", title: "Authenticated request", group: "Data", icon: "hook" },
  { key: "code", title: "Run code", group: "Advanced", icon: "code" },
];

export const TRIGGER_PALETTE: readonly { key: string; title: string; icon: IconKey }[] = [
  { key: "record_change", title: "A record changes", icon: "bolt" },
  { key: "schedule", title: "On a schedule", icon: "clock" },
  { key: "webhook", title: "A webhook is received", icon: "hook" },
  { key: "form_submit", title: "A form is submitted", icon: "inbox" },
  { key: "email_received", title: "An email is received", icon: "mail" },
  { key: "chat_message", title: "A chat message is posted", icon: "chat" },
  { key: "spreadsheet_row", title: "A spreadsheet row is added or changed", icon: "sheet" },
  { key: "ci_check", title: "A CI check finishes", icon: "ci" },
  { key: "meeting_transcript_ready", title: "A meeting transcript is ready", icon: "meeting" },
  { key: "journey_stage_entered", title: "A Journey record enters a stage", icon: "stage" },
  { key: "campaign_reply", title: "A campaign gets a reply", icon: "reply" },
  { key: "button", title: "A button is pressed", icon: "button" },
  { key: "manual", title: "Run by hand", icon: "hand" },
];

export function kindOfKey(key: string): StepKind {
  switch (key) {
    case "paths": case "if": return "paths";
    case "parallel": return "parallel";
    case "loop": return "loop";
    case "wait": case "wait_stage": return "wait";
    case "approval": return "approval";
    case "stop": return "stop";
    case "ai": return "ai";
    default: return "plain";
  }
}

const PRODUCT_TITLES: Readonly<Record<string, string>> = {
  "google.gmail.list_messages": "Google · List Gmail messages",
  "google.gmail.send_message": "Google · Send a Gmail message",
  "google.calendar.list_events": "Google · List calendar events",
  "google.calendar.create_event": "Google · Create a calendar event",
  "google.drive.list_files": "Google · List Drive files",
  "google.drive.create_folder": "Google · Create a Drive folder",
  "google.sheets.get_values": "Google · Read sheet cells",
  "google.sheets.append_values": "Google · Append sheet rows",
  "google.docs.create_document": "Google · Create a document",
  "ms.mail.list_messages": "Microsoft · List Outlook messages",
  "ms.mail.send_message": "Microsoft · Send an Outlook message",
  "ms.calendar.list_events": "Microsoft · List calendar events",
  "ms.calendar.create_event": "Microsoft · Create a calendar event",
  "ms.drive.list_items": "Microsoft · List OneDrive or SharePoint items",
  "ms.drive.create_folder": "Microsoft · Create a OneDrive or SharePoint folder",
  "calendar.list_events": "Calendar · List events",
  "calendar.create_event": "Calendar · Create an event",
  "files.list": "Files · List files",
  "files.get": "Files · Read file details",
  "files.create": "Files · Create a file",
  "files.move": "Files · Move a file",
  "files.copy": "Files · Copy a file",
  "files.share": "Files · Share a file",
  "github.repos.list": "GitHub · List repositories",
  "github.pull_request.get": "GitHub · Read a pull request",
  "github.issue.create": "GitHub · Open an issue",
  "github.issue.comment": "GitHub · Comment on an issue",
  "github.issue.assign_agent": "GitHub · Assign an issue to an agent",
  "forms.list": "Forms · List forms",
  "forms.create": "Forms · Create a form",
  "forms.publish": "Forms · Publish a form",
  "records.relate": "Link records",
};

export function iconOfKey(key: string): IconKey {
  const hit = STEP_PALETTE.find((p) => p.key === key);
  if (hit) return hit.icon;
  if (key.startsWith("records.")) return "record";
  if (key.startsWith("sheet.") || key.startsWith("files.") || key.startsWith("google.drive") || key.startsWith("google.sheets") || key.startsWith("google.docs") || key.startsWith("ms.drive")) return "sheet";
  if (key.startsWith("google.gmail") || key.startsWith("ms.mail")) return "mail";
  if (key.startsWith("calendar.") || key.includes(".calendar.")) return "hourglass";
  if (key.startsWith("github.")) return "code";
  if (key.startsWith("forms.")) return "edit";
  return "record";
}

export function titleOfKey(key: string): string {
  return STEP_PALETTE.find((p) => p.key === key)?.title ?? PRODUCT_TITLES[key] ?? key.replace(/[._]+/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Step group for the inspector subtitle. Unknown keys stay "Step". */
export function groupOfKey(key: string): string {
  return STEP_PALETTE.find((p) => p.key === key)?.group ?? "Step";
}

export function triggerMeta(key: string, config?: Record<string, unknown>): { title: string; icon: IconKey } {
  const base = TRIGGER_PALETTE.find((t) => t.key === key) ?? { title: titleOfKey(key), icon: "bolt" as IconKey };
  const label = config?.["label"];
  return typeof label === "string" && label.trim() ? { ...base, title: label } : base;
}

/** Whether a step branches into lanes that rejoin (Paths, Parallel), runs a body per item (Loop) or just goes on. */
export function branching(n: DefNode): boolean {
  const k = kindOfKey(n.key);
  return (k === "paths" || k === "parallel") && (n.branches?.length ?? 0) > 0;
}
export const isLoop = (n: DefNode): boolean => n.key === "loop";

/** The step ids this step leads to, in lane order. A Loop's body is its first branch; what runs after the loop is `next`. */
export function successors(n: DefNode): string[] {
  if (isLoop(n)) return n.next ?? [];
  if (n.branches && n.branches.length > 0) return n.branches.map((b) => b.to);
  return n.next ?? [];
}

/** Every id a step can reach, in order (depth first), without looping. */
function reach(by: Map<string, DefNode>, from: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (id: string): void => {
    if (seen.has(id)) return;
    const n = by.get(id);
    if (!n) return;
    seen.add(id);
    out.push(id);
    if (isLoop(n)) { if (n.branches?.[0]) walk(n.branches[0].to); }
    for (const s of successors(n)) walk(s);
  };
  walk(from);
  return out;
}

/** The step the lanes of a Paths or Parallel step come back together at: the first step every lane reaches. Null when each lane ends on its own. */
export function joinOf(by: Map<string, DefNode>, n: DefNode): string | null {
  const heads = (n.branches ?? []).map((b) => b.to);
  if (heads.length < 2) return null;
  const sets = heads.map((h) => new Set(reach(by, h)));
  const first = reach(by, heads[0]!);
  for (const id of first) if (sets.every((s) => s.has(id))) return id;
  return null;
}

// ---------------------------------------------------------------- layout

export const CARD_W = 260;
export const CARD_H = 52;
export const GAP_Y = 30;
export const LANE_GAP = 36;
export const TRIG_HEAD = 26;
export const TRIG_ROW = 54;
const CHIP_H = 22;

export type RunState = "done" | "failed" | "waiting" | "running" | "skipped" | "pending";
export type StatusChip = "error" | "waiting" | "tested";

/** A chip only for a real error, a waiting run, or a stored test sample. Never a live stamp. */
export function stepStatusChip(id: string, issues: readonly { severity: string }[], state: RunState | undefined, tested: ReadonlySet<string> | undefined): StatusChip | null {
  if (issues.some((issue) => issue.severity === "error") || state === "failed") return "error";
  if (state === "waiting") return "waiting";
  if (tested?.has(id)) return "tested";
  return null;
}

export interface CardNode {
  id: string;
  type: "trigger" | "step";
  x: number;
  y: number;
  w: number;
  h: number;
  node?: DefNode;
  kind?: StepKind;
  icon?: IconKey;
  title: string;
  sub: string;
  issues: Issue[];
  state?: RunState;
  chip?: StatusChip;
}
export interface Seg { x1: number; y1: number; x2: number; y2: number; lit?: boolean }
export interface Chip { x: number; y: number; text: string; mono?: boolean; kind: "if" | "otherwise" | "each" | "lane" | "join"; lit?: boolean }
export interface Frame { x: number; y: number; w: number; h: number; label: string }
export interface Layout { cards: CardNode[]; segs: Seg[]; chips: Chip[]; frames: Frame[]; width: number; height: number; order: string[] }

export function triggerCardHeight(count: number): number {
  return TRIG_HEAD + Math.max(1, count) * TRIG_ROW;
}

/** The second line of a card: what the step does, from its inputs, in words. */
export function subtitleOf(n: DefNode, names: { key?: (id: string) => string } = {}): string {
  const k = kindOfKey(n.key);
  const inp = n.input ?? {};
  const composed = messageSummary(n.key, inp);
  if (composed) return composed;
  if (typeof inp["summary"] === "string" && k === "plain") return inp["summary"];
  const str = (v: unknown): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : typeof v === "number" || typeof v === "boolean" ? String(v) : "");
  if (k === "paths") {
    const c = n.branches?.filter((b) => b.when !== undefined).length ?? 0;
    const other = n.branches?.some((b) => b.when === undefined) ?? false;
    return `${c} ${c === 1 ? "path" : "paths"}${other ? " and Otherwise" : ""}, first match wins`;
  }
  if (k === "parallel") return `${n.branches?.length ?? 0} lanes at the same time, ${inp["waitFor"] === "any" ? "carry on when one finishes" : "carry on when all finish"}`;
  if (k === "loop") return `For each item in ${str(inp["items"]) || "a list"}${inp["maxIterations"] !== undefined ? `, up to ${str(inp["maxIterations"])}` : ""}. ${LOOP_CHILD}`;
  if (k === "stop") return str(inp["message"]) || (inp["outcome"] === "failed" ? "The run ends as failed" : "The run ends here");
  if (k === "approval") return `${str(inp["summary"]) || "Waits for a yes"}${inp["timeout"] ? `, up to ${str(inp["timeout"])}` : ""}`;
  if (k === "wait") return str(inp["note"]) || (inp["event"] ? "Waits for an event" : inp["forDuration"] ? `Waits ${str(inp["forDuration"])}` : inp["until"] ? `Waits until ${str(inp["until"])}` : "Waits");
  if (n.key === "connector_request") {
    const connector = str(inp["connector"]);
    const action = str(inp["action"]);
    if (!connector && !action) return "Name a connector action. The step does not take a secret.";
    return `${connector || "Connector"} · ${action || "choose an action"}`;
  }
  if (k === "ai") {
    const key = n.ai?.keyId ? (names.key?.(n.ai.keyId) ?? n.ai.keyId) : "";
    const back = n.ai?.backupKeyId ? (names.key?.(n.ai.backupKeyId) ?? n.ai.backupKeyId) : "";
    if (!key) return "Pick a key for this step";
    return back ? `${key}, then ${back}` : key;
  }
  const bits: string[] = [];
  for (const [name, v] of Object.entries(inp)) {
    const s = str(v);
    if (!s) continue;
    bits.push(`${name} ${s}`);
    if (bits.length === 2) break;
  }
  return bits.join(" · ") || titleOfKey(n.key);
}

export function cardTitle(n: DefNode): string {
  return n.title && n.title.trim() ? n.title : titleOfKey(n.key);
}

export function layout(def: Definition, opts: { issues?: readonly Issue[]; run?: Readonly<Record<string, RunState>>; keyName?: (id: string) => string; tested?: ReadonlySet<string> } = {}): Layout {
  const by = new Map(def.nodes.map((n) => [n.id, n] as const));
  const issues = opts.issues ?? [];
  const issuesFor = (id: string): Issue[] => issues.filter((i) => i.nodeId === id);
  const cards: CardNode[] = [];
  const segs: Seg[] = [];
  const chips: Chip[] = [];
  const frames: Frame[] = [];
  const order: string[] = ["trigger"];
  const placed = new Set<string>();
  const stateOf = (id: string): RunState | undefined => opts.run?.[id];
  const lit = (a: string, b: string): boolean => {
    const sa = a === "trigger" ? "done" : stateOf(a);
    const sb = stateOf(b);
    return (sa === "done" || sa === "failed" || sa === "waiting" || sa === "running") && sb !== undefined && sb !== "pending" && sb !== "skipped";
  };

  /** Width a lane starting at `start` takes, up to (not including) `stop`. */
  const measure = (start: string | null, stop: string | null, depth = 0): number => {
    if (depth > 24) return CARD_W;
    let w = CARD_W;
    const seen = new Set<string>();
    let cur = start;
    while (cur && cur !== stop && !seen.has(cur)) {
      seen.add(cur);
      const n = by.get(cur);
      if (!n) break;
      if (branching(n)) {
        const join = joinOf(by, n);
        const lanes = (n.branches ?? []).map((b) => measure(b.to === join ? null : b.to, join, depth + 1));
        w = Math.max(w, lanes.reduce((a, b) => a + b, 0) + LANE_GAP * (lanes.length - 1));
        cur = join;
        continue;
      }
      if (isLoop(n)) {
        const body = n.branches?.[0]?.to ?? null;
        w = Math.max(w, measure(body, null, depth + 1) + 40);
        cur = n.next?.[0] ?? null;
        continue;
      }
      cur = successors(n)[0] ?? null;
    }
    return w;
  };

  const put = (n: DefNode, cx: number, y: number): CardNode => {
    const k = kindOfKey(n.key);
    const names = opts.keyName ? { key: opts.keyName } : {};
    const card: CardNode = {
      id: n.id, type: "step", x: cx - CARD_W / 2, y, w: CARD_W, h: CARD_H, node: n, kind: k, icon: iconOfKey(n.key),
      title: cardTitle(n), sub: subtitleOf(n, names), issues: issuesFor(n.id),
    };
    const st = stateOf(n.id);
    if (st) card.state = st;
    const chip = stepStatusChip(n.id, card.issues, st, opts.tested);
    if (chip) card.chip = chip;
    cards.push(card);
    order.push(n.id);
    placed.add(n.id);
    return card;
  };

  /** Lay a lane out with its centre at cx, starting at y; returns the y under its last card and the id of its last card (null when it has none). */
  const lane = (start: string | null, stop: string | null, cx: number, y: number, prev: { id: string; y: number } | null, depth = 0): { y: number; last: string | null; ends: boolean } => {
    let cur = start;
    let top = y;
    let last: string | null = prev?.id ?? null;
    let lastBottom = prev?.y ?? y;
    let ends = false;
    while (cur && cur !== stop && !placed.has(cur) && depth < 24) {
      const n = by.get(cur);
      if (!n) break;
      if (last) segs.push({ x1: cx, y1: lastBottom, x2: cx, y2: top, lit: lit(last, n.id) });
      const card = put(n, cx, top);
      last = n.id;
      lastBottom = top + card.h;
      top = lastBottom + GAP_Y;
      if (branching(n)) {
        const join = joinOf(by, n);
        const bs = n.branches ?? [];
        const widths = bs.map((b) => measure(b.to === join ? null : b.to, join));
        const total = widths.reduce((a, b) => a + b, 0) + LANE_GAP * (bs.length - 1);
        let x = cx - total / 2;
        const barY = lastBottom + 14;
        const chipY = barY + 8;
        const laneTop = chipY + CHIP_H + 10;
        const ends2: { x: number; y: number; id: string | null; ended: boolean }[] = [];
        const centres: number[] = [];
        let deepest = laneTop;
        bs.forEach((b, i) => {
          const w = widths[i]!;
          const lcx = x + w / 2;
          x += w + LANE_GAP;
          centres.push(lcx);
          const isOther = b.when === undefined;
          const litB = (stateOf(b.to) ?? "pending") !== "pending" && (stateOf(b.to) ?? "") !== "skipped";
          chips.push({
            x: lcx, y: chipY, text: kindOfKey(n.key) === "parallel" ? parallelLaneMark(b.label) : isOther ? "Otherwise" : `If ${b.when}`, mono: !isOther && kindOfKey(n.key) !== "parallel",
            kind: kindOfKey(n.key) === "parallel" ? "lane" : isOther ? "otherwise" : "if", lit: litB,
          });
          segs.push({ x1: lcx, y1: barY, x2: lcx, y2: chipY, lit: litB });
          if (b.to === join || !b.to) {
            segs.push({ x1: lcx, y1: chipY + CHIP_H, x2: lcx, y2: laneTop, lit: litB });
            ends2.push({ x: lcx, y: laneTop - 0, id: null, ended: false });
            deepest = Math.max(deepest, laneTop);
            return;
          }
          segs.push({ x1: lcx, y1: chipY + CHIP_H, x2: lcx, y2: laneTop, lit: litB });
          const r = lane(b.to, join, lcx, laneTop, null, depth + 1);
          ends2.push({ x: lcx, y: r.y - GAP_Y, id: r.last, ended: r.ends });
          deepest = Math.max(deepest, r.y);
        });
        if (centres.length > 1) segs.push({ x1: centres[0]!, y1: barY, x2: centres[centres.length - 1]!, y2: barY, lit: false });
        segs.push({ x1: cx, y1: lastBottom, x2: cx, y2: barY, lit: lit(n.id, bs[0]?.to ?? "") });
        if (join) {
          const mergeY = deepest + 14;
          const open = ends2.filter((e) => !e.ended);
          for (const e of open) segs.push({ x1: e.x, y1: e.y, x2: e.x, y2: mergeY, lit: e.id ? stateOf(e.id) === "done" : false });
          if (open.length > 1) segs.push({ x1: Math.min(...open.map((e) => e.x)), y1: mergeY, x2: Math.max(...open.map((e) => e.x)), y2: mergeY });
          if (kindOfKey(n.key) === "parallel") chips.push({ x: cx, y: mergeY, text: PARALLEL_JOIN, kind: "join" });
          // the merge bar feeds the join step, which the next turn of the loop places
          last = open.length > 0 ? "merge" : null;
          lastBottom = mergeY;
          top = mergeY + GAP_Y - 8;
          cur = join;
          continue;
        }
        // every lane ends on its own: nothing after this step
        ends = true;
        top = deepest;
        cur = null;
        break;
      }
      if (isLoop(n)) {
        const body = n.branches?.[0]?.to ?? null;
        const bw = measure(body, null);
        const fx = cx - bw / 2 - 20;
        const fy = lastBottom + 14;
        chips.push({ x: cx, y: fy, text: "For each item", kind: "each" });
        segs.push({ x1: cx, y1: lastBottom, x2: cx, y2: fy + CHIP_H });
        const r = body ? lane(body, null, cx, fy + CHIP_H + 12, null, depth + 1) : { y: fy + CHIP_H + 12, last: null, ends: false };
        frames.push({ x: fx, y: fy + CHIP_H - 6, w: bw + 40, h: Math.max(CARD_H, r.y - GAP_Y - (fy + CHIP_H - 6) + 12), label: "" });
        last = r.last ?? n.id;
        lastBottom = r.y - GAP_Y + 12;
        top = lastBottom + GAP_Y;
        cur = n.next?.[0] ?? null;
        continue;
      }
      if (kindOfKey(n.key) === "stop") { ends = true; cur = null; break; }
      cur = successors(n)[0] ?? null;
    }
    return { y: top, last, ends };
  };

  const trigCount = def.triggers.length;
  const trigH = triggerCardHeight(trigCount);
  const starts = def.start && def.start.length > 0 ? def.start : (() => {
    const targeted = new Set<string>();
    for (const n of def.nodes) { for (const s of successors(n)) targeted.add(s); if (n.branches) for (const b of n.branches) targeted.add(b.to); }
    return def.nodes.filter((n) => !targeted.has(n.id)).map((n) => n.id).slice(0, 1);
  })();
  const total = Math.max(CARD_W, measure(starts[0] ?? null, null));
  const cx = total / 2 + 40;
  const trig: CardNode = {
    id: "trigger", type: "trigger", x: cx - CARD_W / 2, y: 0, w: CARD_W, h: trigH, title: "Trigger", sub: "Any one starts a run", issues: issuesFor("trigger"),
  };
  cards.push(trig);
  const r = starts[0] ? lane(starts[0], null, cx, trigH + GAP_Y, { id: "trigger", y: trigH }) : { y: trigH + GAP_Y };
  // anything not reached from the start stays visible, off to the side, so nothing a person built is lost
  let sideY = 0;
  for (const n of def.nodes) {
    if (placed.has(n.id)) continue;
    put(n, cx + total / 2 + 80 + CARD_W / 2, sideY);
    sideY += CARD_H + 16;
  }
  const maxX = Math.max(...cards.map((c) => c.x + c.w), ...frames.map((f) => f.x + f.w));
  const maxY = Math.max(...cards.map((c) => c.y + c.h), r.y);
  const minX = Math.min(...cards.map((c) => c.x), ...frames.map((f) => f.x));
  const shift = minX < 40 ? 40 - minX : 0;
  if (shift) {
    for (const c of cards) c.x += shift;
    for (const s of segs) { s.x1 += shift; s.x2 += shift; }
    for (const c of chips) c.x += shift;
    for (const f of frames) f.x += shift;
  }
  return { cards, segs, chips, frames, width: maxX + shift + 40, height: maxY + 60, order };
}

// ---------------------------------------------------------------- the lane a run took

/** Run steps (runs.get) as a per-step state, so the canvas lights the lane taken. */
export function runStates(steps: readonly { nodeId: string; status: string }[]): Record<string, RunState> {
  const out: Record<string, RunState> = {};
  for (const s of steps) {
    const st: RunState = s.status === "done" || s.status === "succeeded" ? "done" : s.status === "failed" ? "failed" : s.status === "waiting" ? "waiting" : s.status === "running" || s.status === "started" ? "running" : s.status === "skipped" ? "skipped" : "pending";
    out[s.nodeId] = st;
  }
  return out;
}

// ---------------------------------------------------------------- the local check (mirrors automations.validate)

/** Missing inputs by step key, named the way a person reads them. */
const REQUIRED: Readonly<Record<string, readonly { field: string; label: string }[]>> = {
  "records.find": [{ field: "type", label: "the record type" }],
  "records.create": [{ field: "type", label: "the record type" }],
  "records.update": [{ field: "recordId", label: "which record" }],
  send_email: [{ field: "to", label: "who to send to" }, { field: "mailboxId", label: "a mailbox" }],
  send_sms: [{ field: "to", label: "who to text" }, { field: "numberId", label: "a number" }],
  connector_request: [{ field: "connector", label: "a connector" }, { field: "action", label: "an action" }, { field: "connectionId", label: "a connection" }],
  post_message: [{ field: "channelId", label: "where to post" }],
  create_task: [{ field: "title", label: "a title" }],
  "records.relate": [{ field: "recordId", label: "which record" }, { field: "toId", label: "the record to link" }],
  "calendar.create_event": [{ field: "title", label: "a title" }, { field: "calendarId", label: "a calendar" }],
  "files.create": [{ field: "name", label: "a file name" }, { field: "folderId", label: "a folder" }],
  "files.move": [{ field: "fileId", label: "a file" }, { field: "toFolderId", label: "a folder" }],
  "github.issue.create": [{ field: "repo", label: "a repository" }, { field: "title", label: "a title" }],
  "forms.create": [{ field: "name", label: "a name" }, { field: "recordType", label: "a record type" }],
  "forms.publish": [{ field: "formId", label: "a form" }],
  loop: [{ field: "items", label: "the list to go through" }],
  approval: [{ field: "title", label: "what needs approval" }, { field: "approver", label: "who approves" }],
};

const blank = (v: unknown): boolean => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

export function check(def: Definition, kind: "personal" | "space" = "space"): Issue[] {
  const out: Issue[] = [];
  const by = new Map(def.nodes.map((n) => [n.id, n] as const));
  if (def.triggers.length === 0) out.push({ severity: "error", message: "Add a trigger so something starts this Automation" });
  for (const t of def.triggers) if (kind === "personal" && t.key === "webhook") out.push({ nodeId: "trigger", severity: "error", message: "A webhook needs a Team Space; a Personal Automation cannot use it" });
  if (def.nodes.length === 0) out.push({ severity: "warning", message: "Add a first step" });
  const reachable = new Set<string>();
  for (const s of def.start ?? def.nodes.slice(0, 1).map((n) => n.id)) for (const id of reach(by, s)) reachable.add(id);
  for (const n of def.nodes) {
    const label = cardTitle(n);
    for (const to of [...(n.next ?? []), ...(n.branches?.map((b) => b.to) ?? [])]) if (to !== "" && !by.has(to)) out.push({ nodeId: n.id, severity: "error", message: `${label} leads to a step that no longer exists` });
    for (const req of REQUIRED[n.key] ?? []) if (blank(n.input?.[req.field])) out.push({ nodeId: n.id, severity: "error", message: `${label} needs ${req.label}` });
    if ((n.key.startsWith("google.") || n.key.startsWith("ms.")) && blank(n.input?.["connectionId"])) out.push({ nodeId: n.id, severity: "error", message: `${label} needs a connection` });
    const k = kindOfKey(n.key);
    if (k === "paths") {
      if (!n.branches || n.branches.length === 0) out.push({ nodeId: n.id, severity: "error", message: `${label} has no paths` });
      else {
        n.branches.forEach((b, i) => { if (b.when === undefined && i !== n.branches!.length - 1) out.push({ nodeId: n.id, severity: "error", message: `${label}: only the last path can be Otherwise` }); });
        n.branches.forEach((b) => { if (b.when !== undefined && blank(b.when)) out.push({ nodeId: n.id, severity: "error", message: `${label}: a path needs its condition` }); });
      }
    }
    if (k === "parallel" && (n.branches?.length ?? 0) < 2) out.push({ nodeId: n.id, severity: "error", message: `${label} needs at least two lanes` });
    if (k === "loop" && !n.branches?.[0]) out.push({ nodeId: n.id, severity: "warning", message: `${label} has nothing inside it` });
    if (k === "ai" && !n.ai?.keyId) out.push({ nodeId: n.id, severity: "warning", message: `${label}: pick the key this step runs on` });
    if (k === "ai" && n.ai?.keyId && !n.ai.backupKeyId) out.push({ nodeId: n.id, severity: "warning", message: `${label}: add a backup key so a lost key never stops the run` });
    if (n.onError?.mode === "route" && !(n.onError.route && by.has(n.onError.route))) out.push({ nodeId: n.id, severity: "error", message: `${label}: choose the step an error goes to` });
    if (!reachable.has(n.id)) out.push({ nodeId: n.id, severity: "warning", message: `${label} is not connected to the start` });
  }
  // a step that leads back to one before it would run forever
  const state = new Map<string, 1 | 2>();
  const dfs = (id: string): boolean => {
    const s = state.get(id);
    if (s === 1) return true;
    if (s === 2) return false;
    state.set(id, 1);
    const n = by.get(id);
    if (n) for (const to of successors(n)) if (by.has(to) && dfs(to)) { return true; }
    state.set(id, 2);
    return false;
  };
  for (const n of def.nodes) if (dfs(n.id)) { out.push({ nodeId: n.id, severity: "error", message: `${cardTitle(n)} leads back to an earlier step, so the run would never end` }); break; }
  return out;
}

/** The step that blocks turning the Automation on. A trigger blocker uses "trigger". */
export function liveBlockerStep(issues: readonly Issue[]): string | null {
  const error = issues.find((issue) => issue.severity === "error");
  if (!error) return null;
  return error.nodeId && error.nodeId.length > 0 ? error.nodeId : "trigger";
}

/** Errors first, then warnings, one per step id and text. */
export function sortedIssues(issues: readonly Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((i) => { const k = `${i.nodeId ?? ""}|${i.message}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
}

// ---------------------------------------------------------------- the builder's edits (new definition out, never changed in place)

function clone(def: Definition): Definition {
  return JSON.parse(JSON.stringify(def)) as Definition;
}

export function newId(def: Definition, key: string): string {
  const base = key.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  const have = new Set(def.nodes.map((n) => n.id));
  let i = def.nodes.length + 1;
  while (have.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

/** A new step with the shape its kind needs: Paths get an if and an Otherwise, Parallel two lanes, Loop a body. */
export function blankStep(def: Definition, key: string): DefNode[] {
  const id = newId(def, key);
  const k = kindOfKey(key);
  if (k === "paths") return [{ id, key, input: {}, branches: [{ label: "Path 1", to: "", when: "" }, { label: "Otherwise", to: "" }] }];
  if (k === "parallel") return [{ id, key, input: { waitFor: "all" }, branches: [{ label: "Lane 1", to: "" }, { label: "Lane 2", to: "" }] }];
  return [{ id, key, input: {} }];
}

/** Insert a new step after `afterId` (or first, after the trigger, when null). The step that came next now follows the new one. */
export function addAfter(def: Definition, afterId: string | null, key: string): { def: Definition; id: string } {
  const d = clone(def);
  const [fresh] = blankStep(d, key);
  const step = fresh!;
  if (afterId === null) {
    const old = d.start && d.start.length > 0 ? d.start[0] : d.nodes[0]?.id;
    if (old && !step.branches) step.next = [old];
    else if (old && step.branches?.[0]) step.branches[0].to = old;
    d.nodes.unshift(step);
    d.start = [step.id];
    return { def: d, id: step.id };
  }
  const prev = d.nodes.find((n) => n.id === afterId);
  if (!prev) throw new Error("no such step");
  const idx = d.nodes.indexOf(prev);
  const follow = isLoop(prev) ? (prev.next?.[0]) : prev.branches && prev.branches.length > 0 ? undefined : prev.next?.[0];
  if (follow && !step.branches) step.next = [follow];
  // a new Paths or Parallel step takes what followed into its first lane, so nothing is left unconnected
  else if (follow && step.branches?.[0]) step.branches[0].to = follow;
  if (isLoop(prev)) prev.next = [step.id];
  else if (prev.branches && prev.branches.length > 0) prev.next = [step.id];
  else prev.next = [step.id];
  d.nodes.splice(idx + 1, 0, step);
  return { def: d, id: step.id };
}

/** Add a step at the end of a lane (the first empty `to` of a Paths or Parallel step, or inside a Loop). */
export function addInto(def: Definition, hostId: string, key: string, laneIndex = 0): { def: Definition; id: string } {
  const d = clone(def);
  const host = d.nodes.find((n) => n.id === hostId);
  if (!host) throw new Error("no such step");
  const [fresh] = blankStep(d, key);
  const step = fresh!;
  if (!host.branches) host.branches = [];
  const b = host.branches[laneIndex];
  if (b) { if (b.to && !step.branches) step.next = [b.to]; b.to = step.id; } else host.branches.push({ label: `Lane ${laneIndex + 1}`, to: step.id });
  d.nodes.push(step);
  return { def: d, id: step.id };
}

/** Remove a step; whatever pointed at it now points at what it led to. */
export function removeStep(def: Definition, id: string): Definition {
  const d = clone(def);
  const gone = d.nodes.find((n) => n.id === id);
  if (!gone) throw new Error("no such step");
  const after = successors(gone)[0] ?? "";
  const swap = (to: string): string => (to === id ? after : to);
  for (const n of d.nodes) {
    if (n.id === id) continue;
    if (n.next) n.next = n.next.map(swap).filter((x) => x !== "");
    if (n.branches) n.branches = n.branches.map((b) => ({ ...b, to: swap(b.to) }));
    if (n.onError?.route === id) delete n.onError.route;
  }
  if (d.start) d.start = d.start.map(swap).filter((x) => x !== "");
  d.nodes = d.nodes.filter((n) => n.id !== id);
  return d;
}

/** Move a step one place earlier (-1) or later (+1) along its lane. */
export function moveStep(def: Definition, id: string, by: -1 | 1): Definition {
  const d = clone(def);
  const step = d.nodes.find((n) => n.id === id);
  if (!step || branching(step) || isLoop(step)) return d;
  const parent = d.nodes.find((n) => !isLoop(n) && (n.next ?? []).includes(id) && !(n.branches && n.branches.length > 0));
  if (by === -1) {
    if (!parent) return d;
    const grand = d.nodes.find((n) => (n.next ?? []).includes(parent.id) || (n.branches ?? []).some((b) => b.to === parent.id));
    const stepNext = step.next?.[0];
    parent.next = stepNext ? [stepNext] : [];
    step.next = [parent.id];
    if (grand) { if (grand.next?.includes(parent.id)) grand.next = grand.next.map((x) => (x === parent.id ? id : x)); if (grand.branches) grand.branches = grand.branches.map((b) => (b.to === parent.id ? { ...b, to: id } : b)); }
    else if (d.start) d.start = d.start.map((x) => (x === parent.id ? id : x));
    return d;
  }
  const child = d.nodes.find((n) => n.id === step.next?.[0]);
  if (!child || branching(child) || isLoop(child)) return d;
  const grandChild = child.next?.[0];
  if (parent) parent.next = [child.id];
  else if (d.start) d.start = d.start.map((x) => (x === id ? child.id : x));
  for (const n of d.nodes) if (n.branches) n.branches = n.branches.map((b) => (b.to === id ? { ...b, to: child.id } : b));
  child.next = [id];
  step.next = grandChild ? [grandChild] : [];
  return d;
}

export function updateStep(def: Definition, id: string, patch: Partial<Pick<DefNode, "title" | "input" | "onError" | "ai" | "branches">>): Definition {
  const d = clone(def);
  const n = d.nodes.find((x) => x.id === id);
  if (!n) throw new Error("no such step");
  if (patch.title !== undefined) { if (patch.title.trim()) n.title = patch.title; else delete n.title; }
  if (patch.input !== undefined) n.input = patch.input;
  if (patch.onError !== undefined) n.onError = patch.onError;
  if (patch.ai !== undefined) n.ai = patch.ai;
  if (patch.branches !== undefined) n.branches = patch.branches;
  return d;
}

export function duplicateStep(def: Definition, id: string): { def: Definition; id: string } {
  const src = def.nodes.find((n) => n.id === id);
  if (!src) throw new Error("no such step");
  const copy = addAfter(def, id, src.key);
  const d = copy.def;
  const n = d.nodes.find((x) => x.id === copy.id)!;
  n.input = JSON.parse(JSON.stringify(src.input ?? {})) as Record<string, unknown>;
  if (src.title) n.title = `${src.title} copy`;
  if (src.ai) n.ai = JSON.parse(JSON.stringify(src.ai)) as NonNullable<DefNode["ai"]>;
  if (src.onError) n.onError = { ...src.onError };
  return { def: d, id: copy.id };
}

export function addTrigger(def: Definition, key: string): Definition {
  const d = clone(def);
  d.triggers.push({ key });
  return d;
}

export function removeTrigger(def: Definition, index: number): Definition {
  const d = clone(def);
  d.triggers.splice(index, 1);
  return d;
}

/** The next card in arrow-key order: down and up go along `order`, left and right to the card beside it in the same row. */
export function neighbour(l: Layout, from: string, dir: "up" | "down" | "left" | "right"): string | null {
  const cur = l.cards.find((c) => c.id === from);
  if (!cur) return l.order[0] ?? null;
  if (dir === "down" || dir === "up") {
    const i = l.order.indexOf(from);
    return l.order[i + (dir === "down" ? 1 : -1)] ?? null;
  }
  const row = l.cards.filter((c) => c.id !== from && Math.abs(c.y - cur.y) < CARD_H);
  const side = row.filter((c) => (dir === "right" ? c.x > cur.x : c.x < cur.x)).sort((a, b) => Math.abs(a.x - cur.x) - Math.abs(b.x - cur.x));
  return side[0]?.id ?? null;
}

export function fitScale(l: Layout, viewW: number, viewH: number): number {
  const s = Math.min(viewW / l.width, viewH / l.height, 1);
  return Math.max(0.3, Math.round(s * 100) / 100);
}
export const clampZoom = (z: number): number => Math.max(0.3, Math.min(2, Math.round(z * 100) / 100));

// ---------------------------------------------------------------- menu and text helpers (kept here so the screens hold no list maps)

export function messages(issues: readonly Issue[]): string[] {
  const out: string[] = [];
  for (const i of issues) out.push(i.message);
  return out;
}

export interface Choice { label: string; checked?: boolean; run(): void }

export function keyChoices(keys: readonly KeyChoice[], none: string, set: (id: string | undefined) => void): { label: string; run(): void; separator?: boolean }[] {
  const out: { label: string; run(): void; separator?: boolean }[] = [{ label: none, run: () => set(undefined) }];
  for (const k of keys) out.push({ label: `${k.name}${k.kind === "subscription" ? " (sign-in)" : " (API key)"}`, run: () => set(k.id) });
  return out;
}

export const ERROR_MODES = [
  { mode: "fail", label: "Stop the run" },
  { mode: "continue", label: "Carry on" },
  { mode: "retry", label: "Try again" },
  { mode: "skip", label: "Skip this step" },
  { mode: "substitute", label: "Use another result" },
  { mode: "route", label: "Go to another step" },
] as const;

export function setBranch(n: DefNode, index: number, patch: Partial<NonNullable<DefNode["branches"]>[number]>): NonNullable<DefNode["branches"]> {
  const out: NonNullable<DefNode["branches"]> = [];
  (n.branches ?? []).forEach((b, i) => out.push(i === index ? { ...b, ...patch } : b));
  return out;
}

export function setTriggerConfig(def: Definition, index: number, key: string, value: unknown): Definition {
  const triggers: Definition["triggers"] = [];
  def.triggers.forEach((t, i) => triggers.push(i === index ? { ...t, config: { ...(t.config ?? {}), [key]: value } } : t));
  return { ...def, triggers };
}

export function palette(): { head: string; items: { key: string; title: string }[] }[] {
  const out: { head: string; items: { key: string; title: string }[] }[] = [];
  for (const p of STEP_PALETTE) {
    let g = out.find((x) => x.head === p.group);
    if (!g) { g = { head: p.group, items: [] }; out.push(g); }
    g.items.push({ key: p.key, title: p.title });
  }
  return out;
}

export function describeTrigger(t: DefTrigger): string {
  const cfg = t.config ?? {};
  if (t.filter && typeof t.filter === "object") {
    const where = (t.filter as Record<string, unknown>)["where"];
    if (typeof where === "string" && where) return `Only when ${where}`;
  }
  const parts: string[] = [];
  for (const [k, v] of Object.entries(cfg)) if (k !== "label" && (typeof v === "string" || typeof v === "number")) parts.push(`${k} ${String(v)}`);
  return parts.length ? parts.join(" · ") : "Every time";
}
