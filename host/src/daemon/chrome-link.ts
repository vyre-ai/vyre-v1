// The Vyre app's side of Vyre for Chrome on one computer (V1-SPEC 3.12, ARCH 7.12): what answers the extension's requests that lib/chrome-bridge.ts hands to `invoke` and `op`, the place a vault fill is pushed
// to the page, and the one door an agent's Chrome tool call goes through.
//
// Who it acts as: the person this daemon belongs to (the owner of the Space it hosts, the same person the local admin token acts as). Every capability goes through the Space's own invoke pipeline as
// that person, so the extension can do exactly what the person can do in the app and no more; a Mine item opens only when the person's vault key is held here, and a locked vault reads as `locked`.
// A Team Space on a server is reached the other way round: the app hands this daemon the person's own signed-in session for that Space (linkRemote, in memory only), and each call goes to the Space over HTTPS with that
// session, so it is the person's own grants that answer, never the owner's. A vault fill there asks the Space for the value to be returned to this computer, which puts it in the field and passes nothing on.
// What the extension may call is the list below and nothing else (the extension refuses anything outside it before sending; this checks again). A daemon that hosts no Space has nothing to answer with, and says so.
import { fail } from "../routes/errors.ts";
import type { Invoke } from "../invoke.ts";
import type { AgentRef, ChromeBridgeDeps } from "../bridge/chrome.ts";

/** The capabilities the extension calls: apps/chrome/src/worker/protocol.js CAPABILITIES lists the same names (a test holds the two together). */
export const EXTENSION_CAPABILITIES: readonly string[] = [
  "vault.items.match", "vault.use", "vault.fill", "vault.item.put", "vault.item.update", "vault.folders.list", "vault.site_rules.list", "vault.site_rules.set", "vault.share",
];

/** The ones among them that need an idempotency key (the manifest says `idem: key`). The extension does not send one, so each call gets its own; a test compares this list with the manifest. */
export const KEYED: readonly string[] = ["vault.item.put", "vault.share"];

export interface LinkedSpace { id: string; name: string; webUrl: string }
/** A Team Space this computer is signed in to: its address and the person's session token for it. Held in memory; the app hands it over again at every start. */
export interface RemoteSpace { id: string; name: string; address: string; token: string }

export interface ChromeLinkDeps {
  version: string;
  /** HTTP to a Space server; the global fetch when omitted. */
  fetch?: typeof fetch;
  /** The Space this daemon hosts; null on a device-only daemon. */
  space(): LinkedSpace | null;
  /** The person whose computer this is: who the extension acts as. */
  person(): string | null;
  /** Does this node hold the person's vault key right now? */
  unlocked(person: string): boolean;
  /** Push one message to every connected extension; returns how many got it. */
  push(message: unknown): number;
  /** Which Spaces' agents may drive this Chrome, kept across restarts (a person's choice, per Space). */
  optedIn: { read(): string[]; write(spaces: string[]): void };
  /** Tell every connected extension (and every one that connects later) which Spaces' agents may drive it. */
  announce(spaces: string[]): void;
  /** Run one chrome_* tool in the extension that owns the tab (the bridge's callTool). */
  callTool(call: { tool: string; input?: Record<string, unknown>; agent: AgentRef; space: string; timeoutMs?: number }): Promise<unknown>;
}

/** An error the extension can turn into words: its code is one of apps/chrome/src/worker/protocol.js WORDS (locked, offline, ...) or a plain message. */
function coded(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function createChromeLink(d: ChromeLinkDeps) {
  let invoke: Invoke | null = null;
  let active: string | null = null;
  const remotes = new Map<string, RemoteSpace>();
  const http: typeof fetch = d.fetch ?? ((...a) => fetch(...a));

  const here = (): LinkedSpace | null => {
    const s = d.space();
    if (s && (active === null || !s.id)) active = s.id;
    return s;
  };

  /** One capability as the person, in the Space this daemon hosts. */
  /** The `browser` place of the Vault's filler: the value goes to the extension, which puts it in the one field it handed a ref for. Nobody listening means nothing was filled, and the call says so. */
  function placeInBrowser(f: { value: string; ref: string }, execution?: { traceId: string }): void {
    if (d.push({ type: "fill", ref: f.ref, value: f.value }) === 0) throw fail("provider.unavailable", execution?.traceId ?? "0".repeat(32), { message: "Vyre for Chrome is not connected on this computer." });
  }

  /** One capability as the person on a Team Space server, with the session they are signed in with there. */
  async function viaRemote(r: RemoteSpace, capability: string, input: Record<string, unknown>): Promise<unknown> {
    const keyed = KEYED.includes(capability) && typeof input["idempotencyKey"] !== "string" ? { ...input, idempotencyKey: `chrome_${crypto.randomUUID()}` } : input;
    // a fill into the person's own browser: the Space returns the value to this computer, which hands it to the extension and drops it from the reply
    const target = isObject(keyed["target"]) ? keyed["target"] : null;
    const intoBrowser = capability === "vault.fill" && target?.["kind"] === "browser" && typeof target["ref"] === "string";
    const body = intoBrowser ? { ...keyed, returnValue: true } : keyed;
    let res: Response;
    try {
      res = await http(`${r.address}/v1/${capability.replaceAll(".", "/")}`, { method: "POST", headers: { authorization: `Bearer ${r.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    } catch { throw coded("offline", `${r.name} did not answer. Check your connection.`); }
    const json = (await res.json().catch(() => null)) as { data?: unknown; error?: { code?: unknown; message?: unknown } } | null;
    if (res.status === 401) throw coded("signed_out", `Sign in to ${r.name} again in the Vyre app.`);
    if (!res.ok || !json || !("data" in json)) throw Object.assign(new Error(typeof json?.error?.message === "string" ? json.error.message : "The Space refused that."), { error: json?.error ?? {} });
    if (!intoBrowser) return json.data;
    const out = isObject(json.data) ? { ...json.data } : {};
    const value = out["value"];
    delete out["value"];
    if (typeof value !== "string") throw coded("not_available", "The Space did not give a value to fill.");
    placeInBrowser({ value, ref: String((target as Record<string, unknown>)["ref"]) });
    out["filled"] = true;
    return out;
  }

  async function asPerson(capability: string, input: Record<string, unknown>, space?: string): Promise<unknown> {
    const wanted = space ?? active ?? undefined;
    const remote = wanted ? remotes.get(wanted) : undefined;
    if (remote) return viaRemote(remote, capability, input);
    const s = here();
    if (!s) throw coded("not_available", "This computer does not host a Space. Open your Space in the web app instead.");
    if (space && space !== s.id) throw coded("not_available", "That Space is not on this computer. Open it in the web app instead.");
    const person = d.person();
    if (!person) throw coded("not_available", "The Space has no signed-in person on this computer yet.");
    if (!invoke) throw coded("offline", "The Vyre app is still starting. Try again in a moment.");
    try {
      const keyed = KEYED.includes(capability) && typeof input["idempotencyKey"] !== "string" ? { ...input, idempotencyKey: `chrome_${crypto.randomUUID()}` } : input;
      const r = await invoke(capability, keyed, { space: s.id, principal: { kind: "person", id: person }, origin: "chrome" });
      if (r.status !== "ok") throw coded("held", "That needs an approval first. Open the Vyre app.");
      return r.output;
    } catch (e) {
      const err = e as { error?: { code?: unknown; message?: unknown }; code?: unknown; message?: unknown };
      // a vault that is locked on this computer reads as such; everything else keeps the code and words the pipeline gave
      if (err.error?.code === "auth.unauthenticated" && /vault key is locked/i.test(text(err.error.message))) throw coded("locked", "Your vault is locked. Unlock it in the Vyre app.");
      throw e;
    }
  }

  /** Whether a typed password is the one the Vault already holds for this site and username. Reads only items the person may read; says known, changed or new and nothing else. */
  async function loginCheck(input: Record<string, unknown>): Promise<{ state: "known" | "changed" | "new"; name?: string; itemId?: string }> {
    const origin = text(input["origin"]);
    const username = text(input["username"]);
    const password = text(input["password"]);
    if (!origin || !password) throw coded("bad_request", "A login check names the site and has a password.");
    const matched = await asPerson("vault.items.match", { url: origin });
    const rows = isObject(matched) && Array.isArray(matched["items"]) ? matched["items"] : [];
    let changed: { name: string; itemId: string } | null = null;
    for (const row of rows) {
      if (!isObject(row) || !isObject(row["item"])) continue;
      const meta = row["item"];
      const itemId = text(meta["id"]);
      if (!itemId) continue;
      const usernameField = text(row["usernameField"]) || "username";
      // returnValue brings the value back to this function only. The daemon registers a sink for the browser and for connector headers and for no other place, so an `env` target reaches
      // nothing and the page never receives the value (a test holds that: the events stream stays silent during a check)
      const used = await asPerson("vault.use", { item: itemId, purpose: "login check" }).catch(() => null);
      const handle = isObject(used) ? text(used["handle"]) : "";
      if (!handle) continue;
      const read = async (field: string): Promise<string | null> => {
        const out = await asPerson("vault.fill", { handle: `${handle}.${field}`, target: { kind: "env", ref: "login.check" }, returnValue: true }).catch(() => null);
        return isObject(out) && typeof out["value"] === "string" ? out["value"] : null;
      };
      if ((await read(usernameField)) !== username) continue;
      const saved = await read("password");
      if (saved === null) continue;
      if (saved === password) return { state: "known", name: text(meta["name"]), itemId };
      changed = { name: text(meta["name"]) || origin, itemId };
    }
    return changed ? { state: "changed", ...changed } : { state: "new" };
  }

  /** Every Space this computer can answer for: the one it hosts and the Team Spaces the person is signed in to. */
  const allSpaces = (): LinkedSpace[] => {
    const s = here();
    return [...(s ? [s] : []), ...[...remotes.values()].map((r) => ({ id: r.id, name: r.name, webUrl: r.address }))];
  };
  const spacesMessage = (): { type: "spaces"; spaces: LinkedSpace[]; active: string | null } => ({ type: "spaces", spaces: allSpaces(), active });

  const link = {
    /** The invoke pipeline exists only after the Space has booted; the daemon hands it over then. */
    bind(i: Invoke): void { invoke = i; },

    invoke: (async (capability, input, extra) => {
      if (!EXTENSION_CAPABILITIES.includes(capability)) throw coded("not_allowed", `The extension may not call ${capability}.`);
      // The extension in an agent's own computer is a different door (agentd); on this computer it is always the person's Chrome.
      if (extra.agent) throw coded("not_allowed", "An agent does not use the person's Chrome this way. It drives it through the Chrome tools.");
      return asPerson(capability, input, extra.space);
    }) satisfies NonNullable<ChromeBridgeDeps["invoke"]>,

    op: (async (op, input) => {
      switch (op) {
        case "hello": {
          const s = here();
          const person = d.person();
          const onLocal = s !== null && active === s.id;
          return { version: d.version, spaces: allSpaces(), active, locked: onLocal && person ? !d.unlocked(person) : false };
        }
        case "space.select": {
          const id = text(input["id"]);
          if (!allSpaces().some((x) => x.id === id)) throw coded("not_available", "That Space is not on this computer.");
          active = id;
          d.push(spacesMessage());
          return { active };
        }
        case "agents.list": {
          const out = await asPerson("agents.list", {});
          const rows = isObject(out) && Array.isArray(out["agents"]) ? out["agents"] : [];
          const agents = rows.filter(isObject).map((a) => ({ id: text(a["agentId"]), name: text(a["name"]), face: text(a["face"]) })).filter((a) => a.id && a.name);
          return { agents, suggested: agents[0] ?? null };
        }
        case "login.check": return loginCheck(input);
        default: throw coded("not_available", op === "ask.page" ? "Ask about this page is not connected to this app yet." : "The Vyre app cannot open itself from the extension yet.");
      }
    }) satisfies NonNullable<ChromeBridgeDeps["op"]>,

    fillSink: placeInBrowser,

    /** The Spaces whose agents may drive this Chrome: the person's choice, kept across restarts and announced to the extension. */
    optedIn: (): string[] => d.optedIn.read(),
    setOptedIn(spaces: string[]): void {
      const known = d.space();
      const kept = [...new Set(spaces)].filter((id) => known !== null && id === known.id);
      d.optedIn.write(kept);
      d.announce(kept);
    },

    /** An agent's Chrome tool call for this person's Chrome: refused unless the person opted this Space in and can see the agent (agents.get goes through authorize as the person); the person's own tab does the work. */
    async drive(call: { tool: string; input?: Record<string, unknown>; agent: AgentRef; timeoutMs?: number }): Promise<unknown> {
      const s = here();
      if (!s) throw coded("not_available", "This computer does not host a Space.");
      if (!d.optedIn.read().includes(s.id)) throw coded("not_allowed", "The person has not let this Space's agents use their Chrome.");
      await asPerson("agents.get", { agentId: call.agent.id });
      return d.callTool({ ...call, space: s.id });
    },

    /** The app hands over (or refreshes) the person's session for a Team Space; the extension is told the list changed. */
    linkRemote(r: RemoteSpace): void {
      remotes.set(r.id, r);
      here();
      if (active === null) active = r.id;
      d.push(spacesMessage());
    },
    /** The person signed out of the Space (or the session ended). */
    unlinkRemote(id: string): void {
      remotes.delete(id);
      if (active === id) active = here()?.id ?? remotes.keys().next().value ?? null;
      d.push(spacesMessage());
    },

    spacesMessage,
  };
  return link;
}

export type ChromeLink = ReturnType<typeof createChromeLink>;
