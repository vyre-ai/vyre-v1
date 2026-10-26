// Test harness for the vault handlers: an in-memory database, a recording ctx, a scripted authorize (levels per principal and resource, role permissions per principal), the scripted access module and a
// key port that gives a person key only to that person. Every call to another capability is checked against its frozen input schema, every event against its payload schema.
import { registry } from "../../../generated/registry.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { Filler, setFiller, setKeyPort } from "../handlers/crypto.ts";
import { LADDER } from "../projections.ts";
import type { Level, VaultCtx } from "../projections.ts";
import { memoryDb } from "./memory-db.ts";

export const NOW = 1_760_000_000_000;
export const TRACE = "0123456789abcdef0123456789abcdef";
export const MAYA = "usr_maya0001";
export const ROB = "usr_rob00002";
export const ADMIN = "usr_admin003";
export const AGENT = "agt_intake01";
export const SECRET = "sk-live-9f3a-NEVER-IN-A-LOG";
export const FILLER_KEY = new Uint8Array(32).fill(7);
export const keyOfPerson = (id: string): Uint8Array => new Uint8Array(32).fill(id.length * 3 + id.charCodeAt(id.length - 1));

export interface Emitted { name: string; subject: string; payload: Record<string, unknown>; vis?: string | undefined }
export interface Called { cap: string; input: Record<string, unknown> }
export interface Logged { level: string; msg: string; attrs: unknown }

export function harness() {
  const emitted: Emitted[] = [];
  const called: Called[] = [];
  const logs: Logged[] = [];
  let clock = NOW;
  const levels = new Map<string, Level>();          // `${principal}|${resourceId}`
  const perms = new Set<string>();                  // `${principal}|${perm}`
  /** what the engine answers for engine.usage.query: by agent or by person, as `by:itemId` -> rows */
  const usageRows = new Map<string, Array<{ key: string; turns: number; tokensIn: number; tokensOut: number }>>();
  const usage = (body: Record<string, unknown>) => {
    const rows = (usageRows.get(`${String(body["by"])}:${String(body["itemId"])}`) ?? []).map((r) => ({ key: r.key, title: r.key, totals: { turns: r.turns, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costMicros: 0 } }));
    const totals = rows.reduce((a, r) => ({ turns: a.turns + r.totals.turns, tokensIn: a.tokensIn + r.totals.tokensIn, tokensOut: a.tokensOut + r.totals.tokensOut, costMicros: 0 }), { turns: 0, tokensIn: 0, tokensOut: 0, costMicros: 0 });
    return { rows, totals };
  };
  const locked = new Set<string>();                 // people whose person key the session did not unlock
  const filler = new Filler(FILLER_KEY);
  setFiller(filler);

  const ctx: VaultCtx = {
    space: "spc_vault",
    principal: { kind: "person", id: MAYA },
    trace: { traceId: TRACE },
    depth: 1,   // a call another capability made: the system halves refuse a direct call (P-SEC_10)
    now: () => clock,
    db: memoryDb(),
    emit(name, subject, payload, opts) {
      const e = registry.events.find((x) => x.name === name);
      if (e) {
        const misfit = validate(e.payload, payload, "", registry.$defs);
        if (misfit.length) throw new Error(`${name} was emitted with a payload its contract refuses: ${misfit.join("; ")}`);
      }
      emitted.push({ name, subject, payload: payload as Record<string, unknown>, vis: opts?.vis });
      return null;
    },
    async call(cap, input) {
      const body = (input ?? {}) as Record<string, unknown>;
      called.push({ cap, input: body });
      const d = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
      if (!d) throw new Error(`${cap} is not in the registry`);
      const misfit = validate(d.input, body, "", registry.$defs);
      if (misfit.length) throw new Error(`${cap} was called with input its contract refuses: ${misfit.join("; ")}`);
      if (cap === "access.share") return { grant: { id: "gnt_vault0001", subject: body["subject"], resource: body["resource"], level: body["level"], conditions: {}, by: ctx.principal.id, createdAt: clock } };
      if (cap === "access.unshare") return { revoked: 1 };
      if (cap === "engine.usage.query") return usage(body);
      throw new Error(`unscripted capability ${cap}`);
    },
    authorize(action, resource) {
      const id = resource.id ?? "";
      const have = levels.get(`${ctx.principal.id}|${id}`);
      const levelOk = have !== undefined && LADDER.indexOf(have) >= LADDER.indexOf(action.level);
      const permOk = action.perm === null || perms.has(`${ctx.principal.id}|${action.perm}`);
      return levelOk && permOk ? { effect: "allow", reason: "granted", decisionId: "dec_test" } : { effect: "deny", reason: "no_grant", decisionId: "dec_test" };
    },
    log: {
      info: (msg, attrs) => { logs.push({ level: "info", msg, attrs }); },
      warn: (msg, attrs) => { logs.push({ level: "warn", msg, attrs }); },
    },
  };

  // the signed-in person's key, only for them
  setKeyPort({ async personKey(personId) { return personId === ctx.principal.id && !locked.has(personId) ? keyOfPerson(personId) : null; } });

  return {
    ctx, emitted, called, logs, filler,
    grant(principal: string, resourceId: string, level: Level) { levels.set(`${principal}|${resourceId}`, level); },
    allow(principal: string, perm: string) { perms.add(`${principal}|${perm}`); },
    lock(personId: string) { locked.add(personId); },
    setUsage(by: "agent" | "person", itemId: string, rows: Array<{ key: string; turns: number; tokensIn: number; tokensOut: number }>) { usageRows.set(`${by}:${itemId}`, rows); },
    actAs(kind: "person" | "agent" | "service", id: string) { ctx.principal = { kind, id }; },
    advance(ms: number) { clock += ms; },
    rows(sql: string, ...args: unknown[]) { return ctx.db.all(sql, ...args) as Record<string, string | number | null>[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    calls(cap: string): Called[] { return called.filter((c) => c.cap === cap); },
    /** Everything the module could have written down or sent anywhere: the database, events, calls and logs. */
    everything(): string { return JSON.stringify([(ctx.db as unknown as { dump(): string }).dump(), emitted, called, logs]); },
    err: (code: string, message: string) => fail(code as never, TRACE, { message }),
    cleanup() { setFiller(null); setKeyPort(null); },
  };
}

export type Harness = ReturnType<typeof harness>;

/** Errors of a value against the frozen contract of a capability (its input or output schema); empty means it conforms. */
export function contractErrors(cap: string, side: "in" | "out", value: unknown): string[] {
  const d = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
  if (!d) return [`${cap} is not in the registry`];
  return validate(side === "in" ? d.input : d.output, value, "", registry.$defs);
}

export function codeOf(err: unknown): string {
  return (err as { error?: { code?: string } } | null)?.error?.code ?? "";
}

export async function refusedWith(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return codeOf(e);
  }
  throw new Error("expected a refusal");
}
