// Records sharing (DESIGN-records-sharing): the shares of a record type or a record as the Share sheet's rows, and the calls its choices make. Pure: no runtime, no React.
import type { CapMap } from "../../../../../../generated/types.ts";
import type { Audience, Exporters, RowFlag, ShareLevel, ShareRow, ShareSubject } from "../../../../../../ui/src/ShareSheet/index.tsx";

export type SharesOut = CapMap["access.shares_of"]["out"];
export type MarksOut = CapMap["access.record_marks"]["out"];
export type Rights = { manage: boolean; share: boolean; export: boolean };

/** The levels a record offers: Can view, Can edit, Full access. */
export const RECORD_LEVELS: readonly ShareLevel[] = ["view", "edit", "manage"];

export const NO_RIGHTS: Rights = { manage: false, share: false, export: false };

/** A row of the table that differs from its type: set apart (Only people added, Only me) or given to people by name. */
export type RowMark = "private" | "shared";

export interface SheetModel {
  rows: ShareRow[];
  owner: { id: string; name: string } | null;
  audience: Audience;
  exporters: Exporters;
  outside: boolean;
  /** The type this record follows, when it does. */
  follows: string | null;
  can: Rights;
}

const KINDS = new Set(["person", "group", "role", "agent", "link"]);

/**
 * The grants the contract returns as sheet rows. The owner has their own line; the grants an audience choice made for itself (the admins who keep a type) are not the person's to
 * edit and stay out; a grant on the type is shown on a record as coming from the type.
 */
export function sheetModel(out: SharesOut, name: (id: string) => string): SheetModel {
  const rows: ShareRow[] = [];
  let owner: SheetModel["owner"] = null;
  for (const s of out.shares) {
    const g = s.grant;
    if (s.through === "owner") { owner = { id: g.subject.id, name: name(g.subject.id) }; continue; }
    if (g.source === "audience") continue;
    const kind = KINDS.has(g.subject.kind) ? (g.subject.kind as ShareRow["subjectKind"]) : "person";
    rows.push({
      subjectKind: kind, subjectId: g.subject.id, name: name(g.subject.id), level: g.level,
      via: s.through === "folder" ? "folder" : "grant", fromFolderId: s.through === "folder" ? g.resource.id : null,
      ...(g.conditions.export === true ? { canExport: true } : {}), ...(g.conditions.reshare === true ? { canShare: true } : {}),
    });
  }
  return { rows, owner, audience: out.audience ?? "space", exporters: out.exporters ?? "admins", outside: out.outside === true, follows: out.inherits ?? null, can: out.can ?? NO_RIGHTS };
}

export const resourceOf = (t: { type: "record_type" | "record"; id: string }): { type: string; id: string } => ({ type: t.type, id: t.id });

/** access.share for a level change or a new person: the grant keeps its switches because none are sent. */
export function shareCall(t: { type: "record_type" | "record"; id: string }, subject: ShareSubject, level: ShareLevel): CapMap["access.share"]["in"] {
  return { resource: resourceOf(t), subject: { kind: subject.kind, id: subject.id }, level } as CapMap["access.share"]["in"];
}

/** access.share for one of the two switches: the row's own level, the switch set. */
export function flagCall(t: { type: "record_type" | "record"; id: string }, row: Pick<ShareRow, "subjectKind" | "subjectId" | "level">, flag: RowFlag, on: boolean): CapMap["access.share"]["in"] {
  return { ...shareCall(t, { kind: row.subjectKind, id: row.subjectId }, row.level), ...(flag === "export" ? { export: on } : { reshare: on }) } as CapMap["access.share"]["in"];
}

export const audienceCall = (t: { type: "record_type" | "record"; id: string }, audience: Audience): CapMap["access.audience_set"]["in"] => ({ resource: resourceOf(t), audience }) as CapMap["access.audience_set"]["in"];
export const outsideCall = (t: { type: "record_type" | "record"; id: string }, outside: boolean): CapMap["access.audience_set"]["in"] => ({ resource: resourceOf(t), outside }) as CapMap["access.audience_set"]["in"];
export const exportersCall = (t: { type: "record_type" | "record"; id: string }, exporters: Exporters): CapMap["access.audience_set"]["in"] => ({ resource: resourceOf(t), exporters }) as CapMap["access.audience_set"]["in"];

/** The line under the sheet's title. */
export function subtitleOf(t: { type: "record_type" | "record" }): string {
  return t.type === "record_type" ? "Every record of this type" : "This record";
}

/** What the table draws on a row: a lock when it is set apart, two people when it was given to people by name, nothing when it follows its type. */
export function marksOf(out: MarksOut | null): ReadonlyMap<string, RowMark> {
  const m = new Map<string, RowMark>();
  if (!out) return m;
  for (const r of out.rows) {
    if (r.audience !== "space") m.set(r.id, "private");
    else if (r.direct > 0) m.set(r.id, "shared");
  }
  return m;
}

/** The ids "Shared with me" keeps, or null when it keeps every row (the whole type was given to the viewer by name). */
export function sharedWithMe(out: MarksOut | null): readonly string[] | null {
  if (!out || out.typeShared) return null;
  return out.rows.filter((r) => r.mine).map((r) => r.id);
}

/** Is there anything to filter by? A viewer given nothing by name is not offered the filter. */
export function hasShared(out: MarksOut | null): boolean {
  return !!out && (out.typeShared || out.rows.some((r) => r.mine));
}
