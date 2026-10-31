// The New Journey type sheet, the pure part: which record types a Journey can follow, the stage templates, the words for what is wrong, and the two writes (a plain type made in place, and the
// Journey itself). Backend refusals are turned into plain words here; the sheet never shows a raw error. No React.
import type { CapMap } from "../../../../../../generated/types.ts";
import { addStage, moveStage, removeStage, renameStage } from "./model.ts";
import type { Stage } from "./model.ts";
import { typeHue } from "../../records/sidebar/parts.tsx";

const hueOfKey = typeHue;

type TypeRow = CapMap["schema.types.list"]["out"]["types"][number];
export type Call = (cap: string, input: unknown) => Promise<unknown>;

/** A record type a Journey can follow, as the picker draws it: its name and icon, and a hue taken from its key so the colour stays the same between visits. */
export interface TypeChoice { key: string; title: string; plural: string; icon: string; hue: number }

export const JOURNEYS_GROUP = "Journeys";

/** The Space's real record types a person can follow through a Journey: not the system's, not an agent, not a site table, not another Journey's own type. */
export function typeChoices(rows: readonly TypeRow[]): TypeChoice[] {
  const out: TypeChoice[] = [];
  for (const t of rows) {
    if (t.system || t.key === "agent" || t.group === JOURNEYS_GROUP || (t.scope !== undefined && t.scope.startsWith("site"))) continue;
    out.push({ key: t.key, title: t.title, plural: t.plural, icon: t.icon, hue: hueOfKey(t.key) });
  }
  return out;
}

export const STAGE_TEMPLATES: readonly { key: string; label: string; stages: readonly string[] }[] = [
  { key: "sales", label: "Sales", stages: ["New", "Qualified", "Proposal", "Won", "Lost"] },
  { key: "delivery", label: "Delivery", stages: ["Kickoff", "In progress", "Review", "Done"] },
  { key: "hiring", label: "Hiring", stages: ["Applied", "Screen", "Interview", "Offer", "Hired"] },
];
export const DEFAULT_STAGES: readonly string[] = ["Start", "In progress", "Done"];

/** A list of stage names as stages, in order, each with the default exit rule and its own key. */
export function stagesFrom(titles: readonly string[]): Stage[] {
  let list: Stage[] = [];
  for (const t of titles) list = addStage(list, t);
  return list;
}
export { addStage, moveStage, removeStage, renameStage };

/** The stages as they are made: unnamed ones left out. */
export const namedStages = (stages: readonly Stage[]): Stage[] => stages.filter((s) => s.title.trim() !== "").map((s, order) => ({ ...s, title: s.title.trim(), order }));

export interface Issues { name?: string; subject?: string; stages?: string }

/** What is missing, in plain words, one line per field. */
export function issuesOf(name: string, subject: string | null, stages: readonly Stage[]): Issues {
  const out: Issues = {};
  if (!name.trim()) out.name = "Give it a name";
  if (!subject) out.subject = "Pick who goes through it";
  const named = namedStages(stages);
  if (named.length === 0) out.stages = "Add at least one stage";
  else {
    const seen = new Set<string>();
    for (const s of named) { const k = s.title.toLowerCase(); if (seen.has(k)) { out.stages = `Two stages are named ${s.title}`; break; } seen.add(k); }
  }
  return out;
}
export const hasIssues = (i: Issues): boolean => i.name !== undefined || i.subject !== undefined || i.stages !== undefined;

/** The words for a refusal. Anything not recognised becomes a plain retry line; the backend text never reaches the screen. */
export function plainError(e: unknown): string {
  const code = typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string" ? (e as { code: string }).code : "";
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const text = `${code} ${msg}`.toLowerCase();
  if (/not a record type|relation target|unknown type|no such type/.test(text)) return "Pick who goes through it again. That type is not available.";
  if (/journey with that name|journey_name|already exists|duplicate/.test(text)) return "That name is taken. Try another.";
  if (/needs a name|name_required/.test(text)) return "Give it a name";
  if (/at least one stage|no_stages/.test(text)) return "Add at least one stage";
  if (/permission|denied|forbidden|not allowed|unauthori/.test(text)) return "You do not have permission to make Journeys here.";
  if (/offline|network|unavailable|timeout|fetch/.test(text)) return "Could not reach your Space. Check the connection and try again.";
  return "That did not work. Try again.";
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "type";
export function typeKeyFor(name: string, taken: readonly string[]): string {
  const base = slug(name);
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

/** Makes a plain record type (a name field and nothing else) from a name, and returns it as a choice. */
export async function createPlainType(call: Call, name: string, taken: readonly string[]): Promise<TypeChoice> {
  const title = name.trim();
  const key = typeKeyFor(title, taken);
  const plural = /s$/i.test(title) ? title : `${title}s`;
  await call("schema.apply", {
    ops: [{ op: "type.create", type: key, def: { key, title, plural, icon: "records", label: "internal", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }] } }],
    reason: `New type ${title}`,
    idempotencyKey: `type-${key}`,
  });
  return { key, title, plural, icon: "records", hue: hueOfKey(key) };
}

/** Makes the Journey. Resolves with its id; rejects with plain words. */
export async function makeJourney(call: Call, input: { name: string; subject: string; stages: readonly Stage[] }): Promise<string> {
  const stages = namedStages(input.stages);
  try {
    const out = (await call("journeys.create", { name: input.name.trim(), subjectType: input.subject, stages, idempotencyKey: `journey-${input.name.trim().toLowerCase()}-${input.subject}-${stages.length}` })) as { journey: { id: string } };
    return out.journey.id;
  } catch (e) { throw new Error(plainError(e)); }
}

/** The line under the stage list: what the board will have. */
export function boardLine(stages: readonly Stage[]): string {
  const n = namedStages(stages).length;
  return n === 0 ? "No columns yet" : `${n} ${n === 1 ? "column" : "columns"} on the board`;
}
