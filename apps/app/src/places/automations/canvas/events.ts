// The events a Wait can wait for, read from the event catalogue (events.types) and shown by the words of their summary; and the fields each event carries, for the "only when" rows. Pure.
export interface EventType {
  name: string;
  summary: string;
  payload?: unknown;
}
const words = (name: string): string => {
  const w = name.replace(/[._]+/g, " ").trim();
  return w.charAt(0).toUpperCase() + w.slice(1);
};
const plain = (s: string): string => s.trim().replace(/\.$/, "");
const rec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Every event in the catalogue by its summary, in alphabetical order; the one the step already holds stays in the list. */
export function eventChoices(types: readonly EventType[], current?: string): { name: string; label: string }[] {
  const out = types.map((t) => ({ name: t.name, label: plain(t.summary) !== "" ? plain(t.summary) : words(t.name) }));
  if (current && !out.some((o) => o.name === current)) out.push({ name: current, label: words(current) });
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

const fieldLabel = (key: string): string => {
  const w = key
    .replace(/Id$/, "")
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .trim()
    .toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/** The fields one event carries: its payload's names, an id read as the thing it is. */
export function payloadFields(types: readonly EventType[], event: string): { key: string; label: string }[] {
  const p = types.find((t) => t.name === event)?.payload;
  const props = rec(p) && rec(p["properties"]) ? p["properties"] : rec(p) ? p : {};
  return Object.keys(props).map((key) => ({ key, label: fieldLabel(key) }));
}
