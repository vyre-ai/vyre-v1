// "Ask for these" on a record page, the pure part: who the record can be asked of (its own email or phone, else a contact it links to) and what to do when there is nobody to ask.
import type { FieldDef, RecordRow, TypeDef } from "./model.ts";
import { isEmpty, relationIds, relationTarget } from "./model.ts";

export interface AskContact { contactId: string; name: string; email?: string; phone?: string }

/** What the page hands the shell: the record, the fields it still lacks and the person to ask. */
export interface AskForInput { type: string; recordId: string; title: string; missing: { field: string; title: string }[]; contact: AskContact }

const textOf = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

/** The first email and the first phone a record holds. */
export function channelsOf(def: Pick<TypeDef, "fields">, row: Pick<RecordRow, "fields">): { email?: string; phone?: string } {
  const email = def.fields.filter((f) => f.type === "email").map((f) => textOf(row.fields[f.key])).find((v) => v !== undefined);
  const phone = def.fields.filter((f) => f.type === "phone").map((f) => textOf(row.fields[f.key])).find((v) => v !== undefined);
  return { ...(email ? { email } : {}), ...(phone ? { phone } : {}) };
}

/** The record itself as a contact, when it holds an email or a phone. Its id is the contact id the Inbox keys a conversation on. */
export function ownContact(def: TypeDef, row: RecordRow): AskContact | null {
  const c = channelsOf(def, row);
  if (!c.email && !c.phone) return null;
  return { contactId: row.id, name: String(row.fields[def.titleField] ?? "") || "Contact", ...c };
}

type Call = (cap: string, input: unknown) => Promise<unknown>;

/** The record itself, else the first record it links to that holds an email or a phone (a company or a lead asks its contact). Null when nobody can be reached. */
export async function findContact(call: Call, def: TypeDef, row: RecordRow): Promise<AskContact | null> {
  const own = ownContact(def, row);
  if (own) return own;
  for (const f of def.fields) {
    const target = f.type === "relation" ? relationTarget(f) : null;
    if (!target) continue;
    for (const id of relationIds(f, row)) {
      try {
        const [got, desc] = await Promise.all([call("records.get", { type: target, recordId: id }), call("schema.describe", { type: target })]);
        const linkedRow = (got as { record?: RecordRow }).record;
        const linkedDef = (desc as { types: TypeDef[] }).types.find((t) => t.key === target);
        const hit = linkedRow && linkedDef ? ownContact(linkedDef, linkedRow) : null;
        if (hit) return hit;
      } catch { /* a linked record this person cannot read is not someone to ask */ }
    }
  }
  return null;
}

/** The empty field to open when there is nobody to ask: Email first, then Phone. Null when the type has neither. */
export function channelFieldToAdd(def: Pick<TypeDef, "fields">, row: Pick<RecordRow, "fields">): FieldDef | null {
  const empty = (type: string): FieldDef | undefined => def.fields.find((f) => f.type === type && isEmpty(row.fields[f.key]));
  return empty("email") ?? empty("phone") ?? null;
}
