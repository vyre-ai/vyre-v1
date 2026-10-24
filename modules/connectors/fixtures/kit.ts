// A connectors handle wired to fakes: a clock, a Vault, an app that answers what the test says, and every event, log line and call written down.
import { openConnectors } from "../impl.ts";
import { resetRateLimits } from "../projections.ts";
import type { BuiltinRow, ConnectorDef, ConnectorsCtx } from "../projections.ts";

export const NOW = 1_800_000_000_000;
export interface Sent { url: string; method: string; headers: Record<string, string>; body?: string }
export type Reply = { status: number; body?: unknown } | Error;

export function kit(o: { builtins?: BuiltinRow[] } = {}) {
  resetRateLimits();
  const clock = { t: NOW };
  const vault: Record<string, string> = { "#AcmeKey": "sk_live_SECRET123", "#AcmeHook": "whsec_HOOKVALUE9" };
  const stored: { name: string; value: string }[] = [];
  const folders: { key: string; files: { path: string; content: string }[] }[] = [];
  const bound: Record<string, string[]> = {};
  const h = openConnectors({
    now: () => clock.t,
    ...(o.builtins ? { builtins: o.builtins } : {}),
    resolveSecret: async (handle) => vault[handle],
    storeSecret: async (name, value) => { const handle = `#${name.replace(/[^A-Za-z0-9_]/g, "_")}`; vault[handle] = value; stored.push({ name, value }); return handle; },
    writeFolder: async (key, files) => { folders.push({ key, files }); return `fld_${key.replace(/[^a-z0-9]/g, "")}${folders.length}`; },
    boundSyncedTypes: async (key) => bound[key] ?? [],
    publicBase: "https://acme.vyre.run",
  });
  const sent: Sent[] = [];
  const state: { reply: (req: Sent) => Reply } = { reply: () => ({ status: 200, body: { ok: true } }) };
  const events: { name: string; subject: string; payload: Record<string, any> }[] = [];
  const logs: string[] = [];
  const calls: { cap: string; input: unknown }[] = [];
  const mk = (actor: string): ConnectorsCtx => ({
    trace: { traceId: "0123456789abcdef0123456789abcdef" }, actor,
    emit: (name, subject, payload) => { events.push({ name, subject, payload }); },
    call: async (cap, input) => { calls.push({ cap, input }); if (cap === "runs.start") return { runId: "run_abc123" }; throw new Error(`no ${cap}`); },
    http: async (url, init) => {
      const req: Sent = { url, method: init?.method ?? "GET", headers: init?.headers ?? {}, ...(init?.body !== undefined ? { body: init.body } : {}) };
      sent.push(req);
      const r = state.reply(req);
      if (r instanceof Error) throw r;
      const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? null);
      return { status: r.status, text: async () => text };
    },
    log: { info: (m, a) => logs.push(`${m} ${JSON.stringify(a ?? {})}`), warn: (m, a) => logs.push(`${m} ${JSON.stringify(a ?? {})}`), error: (m, a) => logs.push(`${m} ${JSON.stringify(a ?? {})}`) },
  });
  const ctx = mk("usr_dana");
  /** Put a definition in as a published connector, the way a publish leaves it. */
  const install = (def: ConnectorDef, state2: "live" | "draft" = "live"): void => {
    h.tx.run("INSERT OR REPLACE INTO cn_connectors (key, title, mode, scope, builtin, version, state, def, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)", def.key, def.title, def.mode, def.scope, def.version, state2, JSON.stringify(def), NOW, NOW);
  };
  const events2 = (name: string) => events.filter((e) => e.name === name).map((e) => e.payload);
  return { h, hs: h.handlers, tx: h.tx, deps: h.deps, clock, vault, stored, folders, bound, sent, state, events, events2, logs, calls, mk, ctx, install };
}
export type Kit = ReturnType<typeof kit>;
