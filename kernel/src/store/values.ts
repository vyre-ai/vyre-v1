// The value kinds as validators (reused from 0.6 kernel/store/values.js). A store translates our kinds, so the RecordStore, the conformance suite and the gateway agree on what a valid value is.
// A sealed field never holds a value, only a reference.
import type { FieldDef } from "./types.ts";

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const strArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
export const isSealedRef = (v: unknown): boolean => isObj(v) && typeof v.sealed === "string" && typeof v.ref === "string" && typeof v.present === "boolean";
/** The most records one `many` link holds. */
export const MAX_LINKS = 500;
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

export function validZone(z: string): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone: z }); return /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(z) && z.length < 64; } catch { return false; }
}

/** An error string, `"sealed_value_refused"`, or null when `v` is valid for `def`. */
export function checkValue(def: FieldDef, v: unknown): string | null {
  if (v === null || v === undefined) return def.required ? `${def.name} is required` : null;
  const opts = def.options;
  switch (def.kind) {
    case "text":
      if (typeof v === "string" && def["format"] === "time_zone" && !validZone(v)) return `${def.name} must be a time zone such as America/Los_Angeles`;
      return typeof v === "string" ? null : `${def.name} must be text`;
    case "rich_text": return typeof v === "string" ? null : `${def.name} must be text`;
    case "number": return typeof v === "number" && Number.isFinite(v) ? null : `${def.name} must be a number`;
    case "money": return isObj(v) && Number.isFinite(v.amount) && typeof v.currency === "string" && /^[A-Z]{3}$/.test(v.currency) ? null : `${def.name} must be { amount, currency }`;
    case "boolean": return typeof v === "boolean" ? null : `${def.name} must be true or false`;
    case "date": case "datetime": return typeof v === "string" && ISO.test(v) ? null : `${def.name} must be an ISO date`;
    case "choice": case "stage": return typeof v === "string" && (!opts || opts.includes(v)) ? null : `${def.name} must be one of its options`;
    case "multi_choice": return strArr(v) && (!opts || v.every((x) => opts.includes(x))) ? null : `${def.name} must be a list of its options`;
    case "rating": return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5 ? null : `${def.name} must be 1 to 5`;
    case "url": return typeof v === "string" && /^https?:\/\//.test(v) ? null : `${def.name} must be a web address`;
    case "link": {
      const one = (x: unknown): boolean => isObj(x) && typeof x.urn === "string" && x.urn.startsWith("vyre://");
      if (def.many === true) {
        if (!Array.isArray(v) || !v.every(one)) return `${def.name} must be a list of references`;
        if (v.length > MAX_LINKS) return `${def.name} holds at most ${MAX_LINKS} links`;
        return new Set(v.map((x) => (x as { urn: string }).urn)).size === v.length ? null : `${def.name} names a record twice`;
      }
      return one(v) ? null : `${def.name} must be a reference`;
    }
    case "actor": return isObj(v) && isObj(v.actor) && typeof v.actor.id === "string" ? null : `${def.name} must be an actor`;
    case "file": return isObj(v) && typeof v.file === "string" && typeof v.name === "string" && Number.isFinite(v.bytes) ? null : `${def.name} must be a file`;
    case "address": return isObj(v) && Object.values(v).every((x) => typeof x === "string") ? null : `${def.name} must be an address`;
    case "phones": case "emails": case "urls": return strArr(v) ? null : `${def.name} must be a list of text`;
    case "sealed": return isSealedRef(v) ? null : "sealed_value_refused";
    default: return `${def.name} has an unknown kind`;
  }
}
