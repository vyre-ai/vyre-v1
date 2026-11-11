// Vault fill on the computer (ARCH 6.11). No secret is ever written here, not even to a tmpfs. When a tool is given `#Handle.field`, agentd asks the host for that one field, at that moment, over
// the host's authenticated channel: POST <fillUrl> with `Authorization: Bearer <fillToken>` and {handle, field, computerId}. The host checks that the agent may use the item, logs the use and
// answers {value, itemId}, or refuses ({code:"forbidden"} 403, {code:"not_found"} 404). agentd fills, reports what it used, scrubs its answer, and keeps nothing: the value lives in the arguments
// of the one call. The host gives agentd the address and token with `configure` (fillUrl, fillToken); they are held in memory only. Without them a handle is refused and nothing is typed.
import { AgentError, badInput, notFound, unavailable } from "./errors.ts";

const GLOBAL = /#([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z0-9_]+)/g;

export interface Used { handle: string; itemId: string; value: string }
export interface Filler { url: string; token: string; computerId: string }

/** A channel that one tool call brings and takes away again: the Vault as the person whose call it is, for that call only. */
export interface CallChannel {
  fillArgs<T>(args: T): Promise<{ args: T; used: Used[] }>;
  leave(): void;
}

/** One Vault channel, held in memory. An agent computer has one (the module-level functions below). The Space browser has one per profile, so a profile fills only as its own agent (createVault). */
export interface Vault {
  setFiller(url: string | null, token: string | null, computerId: string): void;
  /**
   * The channel of one tool call (the Space browser: the host sends one with each call, as the person whose turn it is). While calls are in, Vyre for Chrome in the profile asks the Vault through the
   * one channel they share; calls of two people at once share none, so the extension fills nothing rather than as the wrong person. When the last call leaves, nothing is left to fill with.
   */
  enter(url: string, token: string, computerId: string): CallChannel;
  fillArgs<T>(args: T): Promise<{ args: T; used: Used[] }>;
  hasChannel(): boolean;
  /** One value, for a `#Handle.field` the extension's vault.fill names (the filler pushes it to the page and drops it). */
  value(handleText: string): Promise<{ value: string; itemId: string }>;
  /** A Vault capability for Vyre for Chrome as this profile's agent (which items fit a page, a handle to one). The host allows two (FILL_INVOKE in modules/computers/handlers/fill.ts). */
  invoke(capability: string, input: Record<string, unknown>): Promise<unknown>;
}

const checked = (url: string, token: string, computerId: string): Filler => {
  if (!/^https?:\/\//.test(url) || token.length < 16) throw badInput("The Vault channel needs an http(s) address and a token of at least 16 characters.");
  return { url, token, computerId };
};

export function createVault(): Vault {
  let filler: Filler | null = null;
  const calls = new Map<symbol, Filler>();
  /** What the extension fills with: the channel every call now in shares, else none while calls are in; with no call in, only a channel set for the whole profile (setFiller). */
  const live = (): Filler | null => {
    if (calls.size === 0) return filler;
    const all = [...calls.values()];
    return all.every((f) => f.token === all[0]!.token) ? all[0]! : null;
  };
  return {
    setFiller(url, token, computerId) {
      if (url === null || token === null) { filler = null; return; }
      filler = checked(url, token, computerId);
    },
    enter(url, token, computerId) {
      const f = checked(url, token, computerId);
      const key = Symbol("call");
      calls.set(key, f);
      return { fillArgs: (args) => fillWith(f, args), leave() { calls.delete(key); } };
    },
    hasChannel: () => live() !== null,
    async fillArgs<T>(args: T) { return fillWith(live(), args); },
    async value(handleText) {
      const m = /^#([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z0-9_]+)$/.exec(handleText);
      if (!m) throw badInput("A handle is written #Handle.field.");
      const filler = live();
      if (!filler) throw unavailable("This profile has no channel to the Vault.");
      return ask(filler, m[1]!, m[2]!);
    },
    async invoke(capability, input) {
      const filler = live();
      if (!filler) throw unavailable("This profile has no channel to the Vault.");
      let res: Response;
      try {
        res = await fetch(filler.url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${filler.token}` }, body: JSON.stringify({ op: "invoke", capability, input, computerId: filler.computerId }), signal: AbortSignal.timeout(10_000) });
      } catch { throw unavailable("The Vault did not answer."); }
      if (res.status === 403) throw badInput("This agent may not ask the Vault that.");
      if (res.status === 404) throw notFound("The Vault has nothing for that.");
      if (!res.ok) throw unavailable(`The Vault refused (${res.status}).`);
      const j = (await res.json().catch(() => null)) as { output?: unknown } | null;
      return j?.output ?? null;
    },
  };
}

const own = createVault();
export const setFiller = own.setFiller;

async function ask(f: Filler, handle: string, field: string): Promise<{ value: string; itemId: string }> {
  let res: Response;
  try {
    res = await fetch(f.url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${f.token}` }, body: JSON.stringify({ handle, field, computerId: f.computerId }), signal: AbortSignal.timeout(10_000) });
  } catch { throw unavailable("The Vault did not answer. Nothing was typed."); }
  if (res.status === 403) throw badInput(`This agent may not use #${handle}.${field}. Nothing was typed.`);
  if (res.status === 404) throw notFound(`There is no value for #${handle}.${field}.`);
  if (!res.ok) throw unavailable(`The Vault refused (${res.status}). Nothing was typed.`);
  const j = (await res.json().catch(() => null)) as { value?: unknown; itemId?: unknown } | null;
  if (!j || typeof j.value !== "string") throw unavailable("The Vault answered with something that is not a value.");
  return { value: j.value, itemId: typeof j.itemId === "string" ? j.itemId : `#${handle}.${field}` };
}

export const fillArgs = own.fillArgs;

async function fillWith<T>(filler: Filler | null, args: T): Promise<{ args: T; used: Used[] }> {
  const found = [...JSON.stringify(args ?? null).matchAll(GLOBAL)];
  if (found.length === 0) return { args, used: [] };
  if (!filler) throw unavailable("This computer has no channel to the Vault, so it cannot fill a #Handle.field. Nothing was typed.");
  const f = filler;
  const got = new Map<string, Used>();
  for (const m of found) {
    const all = m[0];
    if (got.has(all)) continue;
    const v = await ask(f, m[1]!, m[2]!);
    got.set(all, { handle: all, itemId: v.itemId, value: v.value });
  }
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.replace(GLOBAL, (all) => got.get(all)?.value ?? all);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { args: walk(args) as T, used: [...got.values()] };
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

export { AgentError };
