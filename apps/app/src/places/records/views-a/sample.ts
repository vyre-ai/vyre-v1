// The sample Spaces behind the part A tests and screenshots: the table's Northwind and Harbor Studio with richer Projects (twelve of them, spread over the lanes, with budgets and covers) and the
// write the board makes. records.update changes the row in the fake replica the way the real replica does (the version moves, the live queries answer again), or refuses when `fail` is set.
import type { Row } from "../../../../../../client/src/index.ts";
import type { RecordsData } from "../sidebar/data.tsx";
import { SAMPLE_NOW, createSampleRecords, harbor, northwind } from "../table/sample.ts";
import type { SampleRecords, SampleSpace } from "../table/sample.ts";
import type { FieldDef, RecordRow, TypeDef } from "../table/model.ts";

export { SAMPLE_NOW, harbor, northwind };
export type { SampleRecords, SampleSpace };

const DAY = 86_400_000;
const NAMES = ["Rivera engagement", "Pruitt estate plan", "Nair trademark", "Whitfield lease review", "Berg shipping contract", "Cole practice sale", "Zhang import licence", "Mbeki brand refresh", "Keller bakery lease", "Alvarez settlement", "Okafor will", "Costa partnership"] as const;
const STATUS = ["planning", "active", "active", "done", "planning", "active", "done", "active", "planning", "active", "done", "active"] as const;
const LEADS = ["usr_maya", "usr_omar", "usr_lena", "usr_sam", "usr_irfad"] as const;

/** A flat colour picture, as a data URL, so a cover needs no network. */
export function coverUrl(hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="96"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,70%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},70%,62%)"/></linearGradient></defs><rect width="320" height="96" fill="url(#g)"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const f = (key: string, type: string, title: string): FieldDef => ({ key, type, title });

function enrich(space: SampleSpace): SampleSpace {
  return {
    ...space,
    types: space.types.map((t): TypeDef => (t.key === "projects" && !t.fields.some((x) => x.key === "budget") ? { ...t, fields: [...t.fields, f("budget", "money", "Budget"), f("cover", "files", "Cover")] } : t)),
    counts: { ...space.counts, projects: space.id === "northwind" ? NAMES.length : space.counts["projects"] ?? 3 },
    views: space.id === "northwind" && !space.views.some((v) => v.viewId === "vw_board")
      ? [
        ...space.views,
        { viewId: "vw_board", type: "projects", kind: "board", title: "By status", shared: true, ownerId: "usr_maya", config: { lane: "status" }, updatedAt: SAMPLE_NOW },
        { viewId: "vw_gallery", type: "projects", kind: "gallery", title: "Project gallery", shared: false, ownerId: "usr_irfad", updatedAt: SAMPLE_NOW },
        { viewId: "vw_open", type: "projects", kind: "list", title: "Open projects", shared: false, ownerId: "usr_irfad", filter: { field: "status", op: "ne", value: "done" }, updatedAt: SAMPLE_NOW },
      ]
      : space.views,
  };
}

export function project(i: number, withLead: boolean): RecordRow {
  const fields: Record<string, unknown> = {
    name: NAMES[i % NAMES.length]!, status: STATUS[i % STATUS.length], due: SAMPLE_NOW + (i * 5 - 12) * DAY, budget: { amount: 4000 + i * 1750, currency: "USD" },
    cover: i % 3 === 0 ? [{ name: `cover-${i}.svg`, url: coverUrl((i * 47) % 360), mime: "image/svg+xml" }] : [],
  };
  if (withLead) fields["lead"] = LEADS[i % LEADS.length];
  return { id: `projects_${i}`, type: "projects", version: 1, label: 1, createdAt: SAMPLE_NOW - i * DAY, updatedAt: SAMPLE_NOW - i * 3_600_000, holds: 0, fields };
}

/** The Spaces the views read: the table's two with the richer Projects. */
export const northRich = enrich(northwind);
export const harborRich = enrich(harbor);

export interface ViewsSample extends SampleRecords {
  /** the records.update calls that were refused or applied, in order */
  updates: { type: string; recordId: string; patch: Record<string, unknown> }[];
}

export function createViewsSample(space: SampleSpace = northwind, o: { online?: boolean; bulk?: number; fail?: string } = {}): ViewsSample {
  const rich = enrich(space);
  const base = createSampleRecords(rich, o);
  const withLead = rich.types.find((t) => t.key === "projects")?.fields.some((x) => x.key === "lead") ?? false;
  const n = rich.counts["projects"] ?? 0;
  base.replica.put("records:projects", Array.from({ length: n }, (_, i) => project(i, withLead) as unknown as Row));
  const updates: ViewsSample["updates"] = [];
  const data: RecordsData = {
    ...base.data,
    async call(cap, input) {
      if (cap !== "records.update") return base.data.call(cap, input);
      const i = input as { type: string; recordId: string; patch: Record<string, unknown>; baseVersion?: number };
      base.calls.push({ cap, input });
      if (o.fail) throw new Error(o.fail);
      const table = `records:${i.type}`;
      const row = base.replica.rows(table).find((r) => (r as unknown as RecordRow).id === i.recordId) as unknown as RecordRow | undefined;
      if (!row) throw new Error("record not found");
      if (i.baseVersion !== undefined && i.baseVersion !== row.version) throw new Error("changed by someone else");
      updates.push({ type: i.type, recordId: i.recordId, patch: i.patch });
      const next = { ...row, version: row.version + 1, updatedAt: SAMPLE_NOW, fields: { ...row.fields, ...i.patch } };
      base.replica.put(table, [next as unknown as Row]);
      return { record: next };
    },
  };
  return { ...base, data, updates };
}
