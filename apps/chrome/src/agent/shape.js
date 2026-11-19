// @ts-check
// The shape of a JSON answer: its keys and the type of each, never a value. What chrome_sources tells an agent about a site's backend, so it can write a call without pulling bodies.
// Nothing here keeps or returns a string, a number or any other value from the page; a key that is a value in disguise (an id used as a key) is folded into one entry.

const MAX_DEPTH = 4;
const MAX_KEYS = 40;
/** Keys that are really data: all digits, a uuid, a long hex or base64 token, an email. */
const DATA_KEY =
  /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|[A-Za-z0-9_-]{24,}|[^@\s]+@[^@\s]+)$/i;

/**
 * @param {unknown} v @param {number} [depth]
 * @returns {unknown} a type name, an object of key -> shape, or a one-element array holding the shape of the items
 */
export function shapeOf(v, depth = 0) {
  if (v === null) return "null";
  if (Array.isArray(v)) {
    if (v.length === 0) return [];
    if (depth >= MAX_DEPTH) return ["..."];
    // the items' shapes, merged: a key seen in any item is listed once
    return [mergeShapes(v.slice(0, 5).map((x) => shapeOf(x, depth + 1)))];
  }
  const t = typeof v;
  if (t === "object") {
    if (depth >= MAX_DEPTH) return "object";
    const keys = Object.keys(/** @type {object} */ (v));
    /** @type {Record<string, unknown>} */
    const out = {};
    let folded = false;
    for (const k of keys.slice(0, 400)) {
      const val = /** @type {any} */ (v)[k];
      if (DATA_KEY.test(k)) {
        if (!folded) {
          out["<key>"] = shapeOf(val, depth + 1);
          folded = true;
        }
        continue;
      }
      if (Object.keys(out).length >= MAX_KEYS) break;
      out[k.slice(0, 60)] = shapeOf(val, depth + 1);
    }
    return out;
  }
  return t === "string" || t === "number" || t === "boolean" ? t : "unknown";
}

/** @param {unknown[]} shapes */
function mergeShapes(shapes) {
  const objects = shapes.filter((s) => s && typeof s === "object" && !Array.isArray(s));
  if (objects.length === shapes.length && objects.length > 0) {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const o of objects)
      for (const [k, s] of Object.entries(/** @type {Record<string, unknown>} */ (o)))
        if (!(k in out) && Object.keys(out).length < MAX_KEYS) out[k] = s;
    return out;
  }
  const names = [...new Set(shapes.map((s) => (typeof s === "string" ? s : Array.isArray(s) ? "array" : "object")))];
  return names.length === 1 ? shapes[0] : names.join("|");
}
