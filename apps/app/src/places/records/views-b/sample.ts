// The sample Spaces behind the part B tests and screenshots: part A's Northwind and Harbor Studio with a Tasks type (dates, a project, a plan that cascades), a Locations type (latitude and
// longitude) and the capabilities the timeline calls: projects.reschedule, projects.cascade and projects.apply_cascade work on the fake replica the way the real ones do.
import type { Row } from "../../../../../../client/src/index.ts";
import type { RecordsData } from "../sidebar/data.tsx";
import type { FieldDef, RecordRow, TypeDef } from "../table/model.ts";
import { SAMPLE_NOW, createViewsSample, harborRich, northRich } from "../views-a/sample.ts";
import type { SampleSpace, ViewsSample } from "../views-a/sample.ts";

export { SAMPLE_NOW, harborRich, northRich };
export type { SampleSpace, ViewsSample };

const DAY = 86_400_000;
export const TODAY = Math.floor(SAMPLE_NOW / DAY) * DAY;

const f = (key: string, type: string, title: string, options?: Record<string, unknown>): FieldDef => ({ key, type, title, ...(options ? { options } : {}) });
const stages = (...c: [string, string][]): Record<string, unknown> => ({ stages: c.map(([key, title]) => ({ key, title })) });
const choices = (...c: [string, string, string?][]): Record<string, unknown> => ({ choices: c.map(([key, title, color]) => ({ key, title, ...(color ? { color } : {}) })) });
const def = (key: string, title: string, plural: string, icon: string, titleField: string, fields: FieldDef[], o: Partial<TypeDef> = {}): TypeDef => ({
  key, title, plural, icon, label: "internal", system: false, titleField, fields, version: 1, ...o,
});

export const TASKS_DEF = def("tasks", "Task", "Tasks", "table", "name", [
  f("name", "text", "Name"), f("project", "relation", "Project"), f("status", "status", "Status", stages(["todo", "To do"], ["doing", "Doing"], ["done", "Done"])),
  f("assignee", "person", "Assignee"), f("start", "date", "Start"), f("due", "date", "Due"), f("effort", "number", "Hours"),
]);
export const LOCATIONS_DEF = def("locations", "Location", "Locations", "globe", "name", [
  f("name", "text", "Name"), f("kind", "choice", "Kind", choices(["office", "Office", "210"], ["clinic", "Clinic", "150"], ["partner", "Partner", "40"])), f("lat", "number", "Latitude"), f("lng", "number", "Longitude"),
  f("visits", "number", "Visits"), f("opened", "date", "Opened"),
]);

/** Six tasks of project 0, a chain: each starts the day the one before it is due. */
const PLAN = [["Intake call", "done", 0, 2], ["Collect documents", "doing", 2, 4], ["Draft engagement letter", "todo", 6, 3], ["Review with Maya", "todo", 9, 2], ["Send for signature", "todo", 11, 1], ["Open the matter", "todo", 12, 2]] as const;

export function task(i: number): RecordRow {
  const [name, status, offset, len] = PLAN[i % PLAN.length]!;
  const start = TODAY + (offset - 3) * DAY;
  return {
    id: `tasks_${i}`, type: "tasks", version: 1, label: 1, createdAt: SAMPLE_NOW, updatedAt: SAMPLE_NOW, holds: 0,
    fields: { name, project: ["projects_0"], status, assignee: ["usr_maya", "usr_omar", "usr_lena"][i % 3], start, due: start + len * DAY, effort: len * 3 },
  };
}

export const PLACES = [["San Francisco office", "office", 37.7749, -122.4194, 840], ["Oakland clinic", "clinic", 37.8044, -122.2712, 410], ["San Jose partner", "partner", 37.3382, -121.8863, 120], ["Berkeley clinic", "clinic", 37.8715, -122.273, 260],
  ["Palo Alto office", "office", 37.4419, -122.143, 530], ["Sacramento partner", "partner", 38.5816, -121.4944, 90], ["Santa Rosa clinic", "clinic", 38.4405, -122.7141, 175], ["Fremont office", "office", 37.5485, -121.9886, 320]] as const;

export function location(i: number): RecordRow {
  const [name, kind, lat, lng, visits] = PLACES[i % PLACES.length]!;
  return { id: `locations_${i}`, type: "locations", version: 1, label: 1, createdAt: SAMPLE_NOW, updatedAt: SAMPLE_NOW, holds: 0, fields: { name, kind, lat, lng, visits, opened: TODAY - (i + 1) * 40 * DAY } };
}

function withB(space: SampleSpace): SampleSpace {
  if (space.types.some((t) => t.key === "tasks")) return space;
  return {
    ...space, types: [...space.types, TASKS_DEF, LOCATIONS_DEF], counts: { ...space.counts, tasks: PLAN.length, locations: PLACES.length },
    views: space.id === "northwind"
      ? [...space.views, { viewId: "vw_charts", type: "projects", kind: "charts", title: "Budget by status", shared: true, ownerId: "usr_maya", config: { group: "status", measure: "budget" }, updatedAt: SAMPLE_NOW }]
      : space.views,
  };
}

export interface BSample extends ViewsSample {
  /** the cascade proposals that were applied or kept, in order */
  decisions: { proposalId: string; decision: string; moved: number }[];
}

type Pending = { moves: { taskId: string; toStart: number; toDue: number }[] };

export function createBSample(space: SampleSpace = northRich, o: { online?: boolean; bulk?: number; fail?: string } = {}): BSample {
  const base = createViewsSample(withB(space), o);
  base.replica.put("records:tasks", Array.from({ length: PLAN.length }, (_, i) => task(i) as unknown as Row));
  base.replica.put("records:locations", Array.from({ length: PLACES.length }, (_, i) => location(i) as unknown as Row));
  const decisions: BSample["decisions"] = [];
  const pending = new Map<string, Pending>();
  /** the moves a reschedule found, kept for the cascade call that follows it */
  const lastMoves = new Map<string, Pending["moves"]>();
  let n = 0;
  const rows = (): RecordRow[] => base.replica.rows("records:tasks") as unknown as RecordRow[];
  const put = (r: RecordRow, patch: Record<string, unknown>): void => {
    base.replica.put("records:tasks", [{ ...r, version: r.version + 1, fields: { ...r.fields, ...patch } } as unknown as Row]);
  };
  /** the tasks after the moved one in its project that start on or after its old due date shift by as much as it slipped */
  const dependents = (id: string, slip: number): Pending["moves"] => {
    const all = rows();
    const me = all.find((r) => r.id === id);
    if (!me || slip <= 0) return [];
    const oldDue = me.fields["due"] as number;
    return all.filter((r) => r.id !== id && (r.fields["start"] as number) >= oldDue).map((r) => ({ taskId: r.id, toStart: (r.fields["start"] as number) + slip, toDue: (r.fields["due"] as number) + slip }));
  };
  const data: RecordsData = {
    ...base.data,
    async call(cap, input) {
      if (cap === "projects.reschedule") {
        base.calls.push({ cap, input });
        if (o.fail) throw new Error(o.fail);
        const i = input as { projectId: string; taskId: string; start?: number; due?: number };
        const r = rows().find((x) => x.id === i.taskId);
        if (!r) throw new Error("task not found");
        const slip = i.due !== undefined ? i.due - (r.fields["due"] as number) : 0;
        const moves = dependents(i.taskId, slip);
        lastMoves.set(i.taskId, moves);
        put(r, { ...(i.start !== undefined ? { start: i.start } : {}), ...(i.due !== undefined ? { due: i.due } : {}) });
        return { taskId: i.taskId, ...(i.start !== undefined ? { start: i.start } : {}), ...(i.due !== undefined ? { due: i.due } : {}), ...(moves.length ? { proposalId: `prop_${++n}` } : {}) };
      }
      if (cap === "projects.cascade") {
        base.calls.push({ cap, input });
        const i = input as { projectId: string; taskId: string };
        const list = lastMoves.get(i.taskId) ?? [];
        const id = `cascade_${++n}`;
        pending.set(id, { moves: list });
        return { proposalId: id, moves: list.map((m) => ({ taskId: m.taskId, toStart: m.toStart, toDue: m.toDue })), holds: [], summary: list.length ? `${list.length} later ${list.length === 1 ? "task moves" : "tasks move"}, the consult on Friday still holds` : "" };
      }
      if (cap === "projects.apply_cascade") {
        base.calls.push({ cap, input });
        const i = input as { projectId: string; proposalId: string; decision: "apply" | "keep" };
        const p = pending.get(i.proposalId);
        if (!p) throw new Error("proposal not found");
        let moved = 0;
        if (i.decision === "apply") for (const m of p.moves) { const r = rows().find((x) => x.id === m.taskId); if (r) { put(r, { start: m.toStart, due: m.toDue }); moved++; } }
        decisions.push({ proposalId: i.proposalId, decision: i.decision, moved });
        return { moved };
      }
      return base.data.call(cap, input);
    },
  };
  return { ...base, data, decisions };
}

/** The prototype's Northwind (the shared fixtures' counts and rows: Clients 1,240, Projects 270, Meetings 652 ...) with the Records views' own writes. */
export async function createProtoSample(o: { online?: boolean; fail?: string } = {}): Promise<BSample> {
  const { protoRows, protoViewsSpace } = await import("./proto.ts");
  const sample = createBSample(protoViewsSpace(), o);
  const rows = protoRows();
  sample.replica.put("records:projects", rows.projects);
  sample.replica.put("records:meetings", rows.meetings);
  return sample;
}
