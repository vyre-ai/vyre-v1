// Test harness for the mcp module: a real in-memory SQLite behind the host's ctx.db guard (mcp_* tables only), a recording ctx, a clock the tests move, and checks against the frozen contract.
import { ProjectionHost } from "../../../kernel/src/store/projection.ts";
import { registry } from "../../../generated/registry.ts";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import type { RawDb } from "../../../host/src/ctx/db.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { McpCtx } from "../projections.ts";

export const NOW = 1_760_000_000_000;
export const TRACE = "0123456789abcdef0123456789abcdef";
export const SPACE = "spc_mcptest";

export interface Emitted { name: string; subject: string; payload: Record<string, unknown> }

export interface HarnessOptions {
  raw?: RawDb;
  principal?: McpCtx["principal"];
  actingFor?: string;
  /** Permissions the caller holds, by "perm" or "perm:level". Default: everything. */
  allow?: (action: { perm: string | null; level: string }) => boolean;
  clock?: { t: number };
}

/** A real in-memory SQLite, opened through the kernel's projection host (modules never import node:sqlite, boundary B2). */
export function openRaw(): RawDb {
  const host = ProjectionHost.open({ path: ":memory:", space: SPACE, projections: [] });
  return {
    all: (sql, ...args) => host.tx.all(sql, ...args),
    run: (sql, ...args) => ({ changes: host.tx.run(sql, ...args).changes }),
  };
}

export function harness(o: HarnessOptions = {}) {
  const raw = o.raw ?? openRaw();
  const clock = o.clock ?? { t: NOW };
  const emitted: Emitted[] = [];
  let allow = o.allow ?? (() => true);
  const db = scopedDb("mcp", raw, TRACE);
  const ctx: McpCtx = {
    space: SPACE,
    principal: o.principal ?? { kind: "person", id: "usr_dana" },
    ...(o.actingFor === undefined ? {} : { actingFor: o.actingFor }),
    trace: { traceId: TRACE },
    now: () => clock.t,
    db,
    emit(name, subject, payload) { emitted.push({ name, subject, payload: payload as Record<string, unknown> }); return null; },
    authorize: (action) => ({ effect: allow(action) ? "allow" : "deny" }),
    log: { warn() {} },
  };
  return {
    ctx, raw, db, emitted, clock,
    advance(ms: number) { clock.t += ms; },
    allowOnly(f: (action: { perm: string | null; level: string }) => boolean) { allow = f; },
    rows(sql: string, ...args: unknown[]): Record<string, unknown>[] { return db.all(sql, ...args) as Record<string, unknown>[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    /** The same database as another principal (two hosts, or the outside tool calling in). */
    as(principal: McpCtx["principal"], actingFor?: string): McpCtx { return { ...ctx, principal, ...(actingFor === undefined ? {} : { actingFor }) }; },
  };
}

export type Harness = ReturnType<typeof harness>;

export function eventErrors(name: string, payload: unknown): string[] {
  const def = registry.events.find((e) => e.name === name);
  if (!def) return [`${name} is not in the registry`];
  return validate(def.payload, payload, "", registry.$defs);
}

/** Errors of a value against the frozen input or output of a capability. */
export function contractErrors(cap: string, side: "in" | "out", value: unknown): string[] {
  const def = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
  if (!def) return [`${cap} is not in the registry`];
  return validate(side === "in" ? def.input : def.output, value, "", registry.$defs);
}

export function assertEventsConform(h: Harness): string[] {
  return h.emitted.flatMap((e) => eventErrors(e.name, e.payload).map((m) => `${e.name}: ${m}`));
}

export function codeOf(err: unknown): string {
  const e = err as { error?: { code?: string }; code?: string };
  return e?.error?.code ?? e?.code ?? "unknown";
}
