// Vault fill on the computer (ARCH 6.11: agent computer logins stay on that computer). The host puts the values a turn may use into a tmpfs folder, one file per handle field named
// `<Handle>.<field>` (content = the value, `<Handle>.<field>.item` = the item id), and removes them afterwards. agentd substitutes `#Handle.field` in a tool's arguments at the last moment,
// reports what it used, and scrubs those values from what it answers. No folder, or no file for a handle: the tool is refused and nothing is typed.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { notFound, unavailable } from "./errors.ts";

const DIR = process.env["VYRE_VAULT_DIR"] ?? "/tmp/vault";
const GLOBAL = /#([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z0-9_]+)/g;

export interface Used { handle: string; itemId: string; value: string }

export function fillArgs<T>(args: T): { args: T; used: Used[] } {
  const text = JSON.stringify(args ?? null);
  const found = [...text.matchAll(GLOBAL)];
  if (found.length === 0) return { args, used: [] };
  if (!existsSync(DIR)) throw unavailable("This computer has no Vault values loaded, so it cannot fill a #Handle.field. Nothing was typed.");
  const used = new Map<string, Used>();
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      return v.replace(GLOBAL, (all, h: string, f: string) => {
        const file = join(DIR, `${h}.${f}`);
        if (!existsSync(file)) throw notFound(`There is no value for #${h}.${f} on this computer.`);
        const value = readFileSync(file, "utf8");
        const itemFile = `${file}.item`;
        used.set(all, { handle: all, itemId: existsSync(itemFile) ? readFileSync(itemFile, "utf8").trim() : all, value });
        return value;
      });
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { args: walk(args) as T, used: [...used.values()] };
}

export function scrubUsed<T>(out: T, used: readonly Used[]): T {
  if (used.length === 0) return out;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") { let t = v; for (const u of used) if (u.value.length >= 3) t = t.split(u.value).join(u.handle); return t; }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(out) as T;
}
