// Pure list steps. They do not call another module.
import { stepError } from "../projections.ts";

function pathGet(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const part of path.split(".").filter(Boolean)) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function transformValue(value: unknown, mapping: unknown): Record<string, unknown> {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) throw stepError("validation.bad_input", "Transform needs a mapping.", false);
  const out: Record<string, unknown> = {};
  for (const [key, src] of Object.entries(mapping)) {
    if (typeof src !== "string" || !src) continue;
    const got = pathGet(value, src);
    if (got !== undefined) out[key] = got;
  }
  return out;
}

export function collectItems(items: unknown, fields?: unknown): { items: unknown[]; count: number } {
  if (!Array.isArray(items)) throw stepError("validation.bad_input", "Collect needs a list.", false);
  const pick = Array.isArray(fields) ? fields.filter((field): field is string => typeof field === "string" && field.length > 0) : [];
  const out = items.map((item) => {
    if (pick.length === 0 || !item || typeof item !== "object" || Array.isArray(item)) return item;
    const row: Record<string, unknown> = {};
    const rec = item as Record<string, unknown>;
    for (const field of pick) if (field in rec) row[field] = rec[field];
    return row;
  });
  return { items: out, count: out.length };
}

export function groupItems(items: unknown, by: string): { key: string; items: unknown[]; count: number }[] {
  if (!Array.isArray(items)) throw stepError("validation.bad_input", "Group by needs a list.", false);
  const order: string[] = [];
  const map = new Map<string, unknown[]>();
  for (const item of items) {
    let key = "";
    if (by && item && typeof item === "object" && !Array.isArray(item)) {
      const value = (item as Record<string, unknown>)[by];
      if (value !== undefined && value !== null) key = String(value);
    }
    const list = map.get(key);
    if (list) list.push(item);
    else { map.set(key, [item]); order.push(key); }
  }
  return order.map((key) => {
    const grouped = map.get(key) ?? [];
    return { key, items: grouped, count: grouped.length };
  });
}
