// The host side of publisher-approved public choices (modules/forms/handlers/choices.ts): every lookup runs as the publisher, so what a form may offer is bounded by what that person can see now.
// A record is offered only at or below "internal" (label 0 or 1) and only by its type's title field (itself at or below internal); a person only by display name. Nothing else is read out.
import type { ChoiceInfo, ChoiceSource, FormSchemaField } from "../../../modules/forms/projections.ts";

export const PUBLIC_LABEL_CEILING = 1;
const MAX_LABEL = 120;

export interface ChoicePorts {
  /** Call a capability as this person, with their own authority (never the system principal). */
  as(person: string, cap: string, input: unknown): Promise<unknown>;
  /** The Space's people: active persons only (never agents, outside actors or services). */
  people(): { id: string; name: string }[];
}

type Level = "public" | "internal" | "confidential" | "restricted";
interface Detail { titleField: string; label?: Level; fields: { key: string; label?: Level }[] }
interface Row { id: string; label: number; fields: Record<string, unknown>; deletedAt?: number }

const LEVEL: Record<Level, number> = { public: 0, internal: 1, confidential: 2, restricted: 3 };
/** An unknown or missing label counts as the most sensitive, so a surprise never opens a door. */
const levelOf = (v: unknown): number => (v === undefined ? 0 : typeof v === "string" && v in LEVEL ? LEVEL[v as Level] : 3);
const clean = (v: unknown): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return s.length === 0 ? null : s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 1)}…` : s;
};

export function createChoiceSource(ports: ChoicePorts): ChoiceSource {
  const detail = async (person: string, type: string): Promise<Detail | null> => {
    try { return ((await ports.as(person, "schema.types.get", { type })) as { type: Detail }).type; } catch { return null; }
  };
  const labelOf = (d: Detail, row: Row): ChoiceInfo => {
    const f = d.fields.find((x) => x.key === d.titleField);
    if (row.deletedAt) return { ok: false, reason: "That record is in the Trash." };
    if (row.label > PUBLIC_LABEL_CEILING || levelOf(d.label) > PUBLIC_LABEL_CEILING) return { ok: false, reason: "That record is Confidential or Restricted, so it cannot be offered on a public form." };
    if (levelOf(f?.label) > PUBLIC_LABEL_CEILING) return { ok: false, reason: "That record's title is Confidential or Restricted, so it cannot be offered on a public form." };
    const label = clean(row.fields[d.titleField]);
    return label ? { ok: true, label } : { ok: false, reason: "That record has no title to show a visitor." };
  };
  const targetOf = (field: FormSchemaField): string | null => (typeof field.options?.["target"] === "string" ? (field.options["target"] as string) : null);
  return {
    async describe(publisherId, field, refId): Promise<ChoiceInfo> {
      if (field.type === "person") {
        const p = ports.people().find((x) => x.id === refId);
        const label = p ? clean(p.name) : null;
        return label ? { ok: true, label } : { ok: false, reason: "That person is not an active member of this Space." };
      }
      const type = targetOf(field);
      if (!type) return { ok: false, reason: "This question does not say which records it relates to." };
      const d = await detail(publisherId, type);
      if (!d) return { ok: false, reason: "You cannot see that kind of record." };
      let row: Row;
      try { row = ((await ports.as(publisherId, "records.get", { type, recordId: refId })) as { record: Row }).record; } catch { return { ok: false, reason: "You cannot see that record, or it no longer exists." }; }
      return labelOf(d, row);
    },
    async candidates(publisherId, field, q): Promise<{ refId: string; label: string }[]> {
      const needle = (q ?? "").trim().toLowerCase();
      if (field.type === "person") return ports.people().filter((p) => !needle || p.name.toLowerCase().includes(needle)).slice(0, 200).flatMap((p) => { const label = clean(p.name); return label ? [{ refId: p.id, label }] : []; });
      const type = targetOf(field);
      const d = type ? await detail(publisherId, type) : null;
      if (!type || !d) return [];
      const rows = (needle
        ? ((await ports.as(publisherId, "records.search", { type, q: needle, limit: 200 })) as { rows: Row[] }).rows
        : ((await ports.as(publisherId, "records.query", { type, limit: 200 })) as { rows: Row[] }).rows);
      return rows.flatMap((r) => { const info = labelOf(d, r); return info.ok ? [{ refId: r.id, label: info.label }] : []; }).slice(0, 200);
    },
  };
}
