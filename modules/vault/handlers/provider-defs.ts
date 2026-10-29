// Provider definitions are data (spec 2.17, 4.14): one JSON file per built-in provider in modules/vault/providers/, loaded and validated once, plus the custom endpoints a Space registers (a row in
// vault_provider_def). Nothing about a provider lives in code except the engine driver its `engine` names. A bad built-in file stops the module at first use with the file named; a bad custom
// definition is refused when it is added.
//
// A definition: key, name, connections (subscription | api_key | local_model), modelsSource ("static", an address, or "{address}/v1/models"), engine (the driver), and optionally order, logo,
// models (what a static list offers), instruction (sign-in text), base (the address the driver talks to when the provider has its own) and keyless (no key at all).
import { readdirSync, readFileSync } from "node:fs";

export type Connection = "subscription" | "api_key" | "local_model";
export interface CatalogEntry {
  key: string; name: string; logo?: string; connections: Connection[]; modelsSource: string; engine: string; models?: string[]; instruction?: string;
  base?: string; keyless?: boolean; order?: number;
  /** True for a definition a Space registered (it can be removed). */
  custom?: boolean;
}

const CONNECTIONS: readonly string[] = ["subscription", "api_key", "local_model"];
const KEY = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** The definition a parsed JSON value describes, or the reason it is not one. */
export function validateDef(raw: unknown, where: string): CatalogEntry {
  const bad = (why: string): never => { throw new Error(`Provider definition ${where}: ${why}`); };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return bad("not an object");
  const o = raw as Record<string, unknown>;
  const str = (k: string, need: boolean): string | undefined => {
    const v = o[k];
    if (v === undefined) return need ? bad(`${k} is missing`) : undefined;
    if (typeof v !== "string" || v.trim() === "") return bad(`${k} must be a non-empty text`);
    return v;
  };
  const key = str("key", true)!;
  if (!KEY.test(key)) bad("key must be lowercase letters, digits and dashes");
  const connections = o["connections"];
  if (!Array.isArray(connections) || connections.length === 0 || connections.some((c) => typeof c !== "string" || !CONNECTIONS.includes(c))) bad("connections must list subscription, api_key or local_model");
  const models = o["models"];
  if (models !== undefined && (!Array.isArray(models) || models.some((m) => typeof m !== "string" || m === ""))) bad("models must be a list of text");
  const base = str("base", false);
  if (base !== undefined && !/^https?:\/\/\S+$/.test(base)) bad("base must be an http or https address");
  if (o["keyless"] !== undefined && typeof o["keyless"] !== "boolean") bad("keyless must be yes or no");
  if (o["order"] !== undefined && (typeof o["order"] !== "number" || !Number.isFinite(o["order"]))) bad("order must be a number");
  const logo = str("logo", false), instruction = str("instruction", false);
  return {
    key, name: str("name", true)!, connections: connections as Connection[], modelsSource: str("modelsSource", true)!, engine: str("engine", true)!,
    ...(logo ? { logo } : {}), ...(models ? { models: models as string[] } : {}), ...(instruction ? { instruction } : {}), ...(base ? { base } : {}),
    ...(o["keyless"] === true ? { keyless: true } : {}), ...(typeof o["order"] === "number" ? { order: o["order"] } : {}),
  };
}

/** Load every *.json in a folder; a duplicate key or a bad file throws with its name. */
export function loadDefs(dir: URL): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    const d = validateDef(JSON.parse(readFileSync(new URL(f, dir), "utf8")), f);
    if (f !== `${d.key}.json`) throw new Error(`Provider definition ${f}: the file must be named ${d.key}.json`);
    if (out.some((x) => x.key === d.key)) throw new Error(`Provider definition ${f}: ${d.key} is defined twice`);
    out.push(d);
  }
  return out.sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000) || a.key.localeCompare(b.key));
}

let builtin: readonly CatalogEntry[] | null = null;
/** The built-in providers, from modules/vault/providers/*.json, read once. */
export function builtinDefs(): readonly CatalogEntry[] {
  return (builtin ??= Object.freeze(loadDefs(new URL("../providers/", import.meta.url))));
}

/** A key may be sent only to https, or to plain http on this machine. A keyless endpoint carries no key, so any http or https address is fine (the network guard still decides which hosts a request reaches). */
export function addressProblem(address: string, hasKey: boolean): string | null {
  let u: URL;
  try { u = new URL(address); } catch { return "That is not an address."; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "The address must start with http:// or https://.";
  if (u.username !== "" || u.password !== "") return "Put the key in the key field, not in the address.";
  if (hasKey && u.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) return "A key is sent only over https (or to this computer). Use an https address.";
  return null;
}
