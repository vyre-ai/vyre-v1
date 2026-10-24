// Handles in tool arguments (ARCH 6.11): the model writes #Dana_Lawmatics.api_key, never the value. Where a tool really uses a secret (a terminal, a browser fill, a deployment),
// the executing process substitutes the value at the last moment. Everywhere else the literal text stays.
export const HANDLE = /#[A-Za-z0-9_]+(?:\.[A-Za-z][A-Za-z0-9_]*)?/g;
/** Sealed record fields use the same filler: rec_<table>_<id>_<Field>. */
export const SEALED = /\brec_[a-z][a-z0-9]*_[a-z0-9]+_[A-Za-z][A-Za-z0-9]*\b/g;

export type Place = "terminal" | "http" | "browser" | "file" | "chat";

/** Tools whose executor may receive a value, and where that is. Anything not listed never sees one. */
export const FILL_TOOLS: Readonly<Record<string, Place>> = {
  terminal_run: "terminal", terminal_open: "terminal",
  chrome_fill: "browser", chrome_type: "browser", chrome_act: "browser", screen_type: "browser",
  sites_deploy: "http", sites_env_set: "http",
};
/** Deployments only receive items that allow it. */
export const DEPLOY_TOOLS: ReadonlySet<string> = new Set(["sites_deploy", "sites_env_set"]);

export function handlesIn(text: string): string[] {
  return [...new Set([...text.matchAll(HANDLE), ...text.matchAll(SEALED)].map((m) => m[0]))];
}

/** Every handle named anywhere in a JSON-like value, including object keys. */
export function handlesInArgs(args: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === "string") for (const h of handlesIn(v)) found.add(h);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { walk(k); walk(x); }
  };
  walk(args);
  return [...found];
}

/** Copy `args`, replacing each handle text by its value (longest handle first, so #A.b_c is not eaten by #A.b). */
export function substitute(args: unknown, values: ReadonlyMap<string, string>): unknown {
  const order = [...values.keys()].sort((a, b) => b.length - a.length);
  const one = (s: string): string => {
    let out = s;
    for (const h of order) out = out.split(h).join(values.get(h) ?? h);
    return out;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return one(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [one(k), walk(x)]));
    return v;
  };
  return walk(args);
}
