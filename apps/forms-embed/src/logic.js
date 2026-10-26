// @ts-check
// Conditional logic (spec 2.11): which fields show, which are required, and where Next jumps, from the answers so far. Pure functions over a parsed definition (definition.js).
// A field named by a `show` action is hidden until a matching rule shows it; a `hide` action hides it while its rule matches; `require` makes it required while its rule matches.

/** @typedef {import("./definition.js").Cond} Cond @typedef {import("./definition.js").FormDefinition} FormDefinition */

const empty = (/** @type {unknown} */ v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);

/** Numbers compare as numbers when both sides read as numbers, otherwise as text. */
function cmp(/** @type {unknown} */ a, /** @type {unknown} */ b) {
  const x = typeof a === "number" ? a : Number(a), y = typeof b === "number" ? b : Number(b);
  if (a !== "" && b !== "" && Number.isFinite(x) && Number.isFinite(y)) return x - y;
  const s = String(a ?? ""), t = String(b ?? "");
  return s < t ? -1 : s > t ? 1 : 0;
}

/** @param {Cond} c @param {Record<string, unknown>} answers */
export function evaluate(c, answers) {
  if ("all" in c) return c.all.every(x => evaluate(x, answers));
  if ("any" in c) return c.any.some(x => evaluate(x, answers));
  if ("not" in c) return !evaluate(c.not, answers);
  const v = answers[c.field];
  switch (c.op) {
    case "empty": return empty(v);
    case "notempty": return !empty(v);
    case "eq": return Array.isArray(v) ? v.length === 1 && String(v[0]) === String(c.value) : v === c.value || (!empty(v) && String(v) === String(c.value));
    case "ne": return !evaluate({ field: c.field, op: "eq", value: c.value }, answers);
    case "in": return Array.isArray(c.value) && (Array.isArray(v) ? v.some(x => c.value.map(String).includes(String(x))) : !empty(v) && c.value.map(String).includes(String(v)));
    case "contains": return Array.isArray(v) ? v.map(String).includes(String(c.value)) : typeof v === "string" && String(c.value) !== "" && v.toLowerCase().includes(String(c.value).toLowerCase());
    case "gt": return !empty(v) && cmp(v, c.value) > 0;
    case "gte": return !empty(v) && cmp(v, c.value) >= 0;
    case "lt": return !empty(v) && cmp(v, c.value) < 0;
    case "lte": return !empty(v) && cmp(v, c.value) <= 0;
    default: return false;
  }
}

/**
 * What the answers so far say about the form.
 * @param {FormDefinition} def @param {Record<string, unknown>} answers
 * @returns {{ visible: Set<string>, required: Set<string>, skips: number[] }}
 */
export function resolve(def, answers) {
  const shownBy = new Set(), hiddenBy = new Set(), required = new Set(), skips = [];
  const gated = new Set();
  for (const rule of def.logic.rules) for (const a of rule.then) for (const n of a.show ?? []) gated.add(n);
  for (const rule of def.logic.rules) {
    if (!evaluate(rule.if, answers)) continue;
    for (const a of rule.then) {
      for (const n of a.show ?? []) shownBy.add(n);
      for (const n of a.hide ?? []) hiddenBy.add(n);
      for (const n of a.require ?? []) required.add(n);
      if (a.skipToStep !== undefined) skips.push(a.skipToStep);
    }
  }
  const visible = new Set();
  for (const f of def.fields) {
    if (f.mode === "hide") continue;
    if (gated.has(f.field) && !shownBy.has(f.field)) continue;
    if (hiddenBy.has(f.field)) continue;
    visible.add(f.field);
  }
  for (const f of def.fields) if (f.required && f.mode === "ask") required.add(f.field);
  return { visible, required, skips };
}
