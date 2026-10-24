// from vyre 0.6.9 kernel/core/canonical.js@d8eba9e57 (canonical() only; sha256 and hmac stay in kernel with @noble)
// One canonical JSON so a commitment, an event hash and a presence payload hash are the same bytes on every node.
// Keys sorted, no whitespace, undefined dropped, numbers finite.

export function canonical(v: unknown): string {
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new TypeError("canonical: number must be finite");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return "[" + v.map((x) => (x === undefined ? "null" : canonical(x))).join(",") + "]";
  if (typeof v === "object") {
    // Date, Map, Set and class instances would encode as {} and let different data share a hash: refuse them.
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) throw new TypeError("canonical: only plain objects and arrays");
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
  }
  throw new TypeError(`canonical: cannot encode ${typeof v}`);
}
