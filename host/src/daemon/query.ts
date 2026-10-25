// A GET carries its input in the query string, where everything is text. The gateway hands the query to the validator as it is, so the HTTP layer types each value by the capability's input
// schema first: integers and numbers become numbers, booleans become booleans, arrays, objects and "any JSON" values are parsed from JSON. Text that does not parse is left as text and the validator says why.
export interface PropSchema { type?: string | string[] }

const typesOf = (p: PropSchema | undefined): string[] => (p?.type === undefined ? [] : Array.isArray(p.type) ? p.type : [p.type]);

export function coerceQuery(query: Readonly<Record<string, string>>, props: Readonly<Record<string, PropSchema>> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(query)) {
    const p = props?.[k];
    const t = typesOf(p);
    if (t.length === 0 && p === undefined) { out[k] = v; continue; }   // not a known field: pass it through for the validator to refuse
    if (t.includes("string") && t.length === 1) { out[k] = v; continue; }
    if ((t.includes("integer") || t.includes("number")) && v.trim() !== "" && Number.isFinite(Number(v))) { out[k] = Number(v); continue; }
    if (t.includes("boolean") && (v === "true" || v === "false")) { out[k] = v === "true"; continue; }
    if (t.length === 0 || t.includes("array") || t.includes("object") || t.includes("null")) {
      try { out[k] = JSON.parse(v) as unknown; continue; } catch { /* leave as text */ }
    }
    out[k] = v;
  }
  return out;
}
