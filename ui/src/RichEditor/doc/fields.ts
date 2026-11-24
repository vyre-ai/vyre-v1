// Field chips of a Vyre document: the blanks of the fill engine drawn as chips. Pure helpers, no DOM, so the page, a test and the picker read the same words.
// A chip is stored as the tag it stands for ({client.name}, {sign:client}); what it shows depends on the record the page is bound to.

/** One field a template of this record type can name: `tag` is what is written between the braces. */
export interface FieldDef {
  tag: string;
  label: string;
  /** The heading the picker lists it under (the linked record it comes from, "Signing"). */
  group?: string;
  /** A short line on the right of the row (a sample value, or the kind). */
  detail?: string;
}

/**
 * What a chip reads from the record: a string is the value, `null` is "the record has no value for this" (the chip turns amber), `undefined` is "no record chosen" (the chip shows its name).
 */
export type FieldResolver = (raw: string) => string | null | undefined;

export type ChipState = "name" | "value" | "missing" | "sign";
export interface ChipLook {
  state: ChipState;
  text: string;
  title: string;
}

const cap = (s: string): string => (s === "" ? s : s.charAt(0).toUpperCase() + s.slice(1));
const words = (s: string): string => s.replace(/_/g, " ").trim();

/** The name a person reads for a tag: `client.name` is "Client name", `sign:client` is "Client signs", `date:client` is "Client signing date". */
export function fieldLabel(raw: string): string {
  const t = raw.trim();
  const mark = /^(sign|date):([A-Za-z0-9_]+)$/.exec(t);
  if (mark) return cap(`${words(mark[2] ?? "")} ${mark[1] === "sign" ? "signs" : "signing date"}`);
  const parts = t.split(".").filter((p) => p !== "");
  return cap(words(parts.slice(-2).join(" ")));
}

/** Whether a tag is a signing mark (a signature or its date) rather than a value. */
export const isSignMark = (raw: string): boolean => /^(sign|date):/.test(raw.trim());

/** What a chip shows and says, for the record it is read against. */
export function chipLook(raw: string, resolve?: FieldResolver): ChipLook {
  const name = fieldLabel(raw);
  if (isSignMark(raw)) return { state: "sign", text: name, title: `${name}: filled in when it is sent for signature` };
  const v = resolve ? resolve(raw) : undefined;
  if (v === undefined) return { state: "name", text: name, title: `{${raw.trim()}}` };
  if (v === null || v.trim() === "")
    return { state: "missing", text: name, title: `${name}: this record has no value yet` };
  return { state: "value", text: v, title: `${name}: ${v}` };
}

/** The tags a text names, in order, once each (value tags only; sections and signing marks are not fields to ask for). */
export function tagsIn(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(/\{\s*([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\s*\}/g)) seen.add(m[1] as string);
  return [...seen];
}

/** The chips of a document that the record cannot fill: the blanks the page marks amber. */
export function missingTags(text: string, resolve: FieldResolver): string[] {
  return tagsIn(text).filter((t) => {
    const v = resolve(t);
    return v === null || (typeof v === "string" && v.trim() === "");
  });
}

/** The chip as the picker inserts it: a ProseMirror node. */
export const chipNode = (tag: string): { type: "fieldChip"; attrs: { raw: string } } => ({
  type: "fieldChip",
  attrs: { raw: tag },
});

/** Picker rows for a query: the fields whose name or tag contains it, in the order the host gave them. */
export function matchFields(fields: readonly FieldDef[], query: string): FieldDef[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...fields];
  return fields.filter((f) => f.tag.toLowerCase().includes(q) || f.label.toLowerCase().includes(q));
}
