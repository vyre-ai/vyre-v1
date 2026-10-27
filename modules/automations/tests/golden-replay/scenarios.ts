// Recorded scenarios for the Automations golden replay (spec 2.12; ported from the 0.6 Flows safety net in kernel/flows/safety-net.js).
// 0.6 ran one scenario per step kind through its runner; in v1 the runner is the runs module and the step catalogue is steps-core, so this suite stays inside Automations:
// the definitions (the shapes the 0.6 decide, repeat, parallel and wait scenarios became), the trigger decisions for a recorded event sequence, the Runs they start and the events they say.
// Each scenario returns a ledger with the ids taken out. The same scenario twice gives the same ledger, and the ledger is the one in golden.json.
import { harness } from "../../fixtures/db.ts";
import type { Harness } from "../../fixtures/db.ts";
import { alice, create, goodDefinition, node } from "../../fixtures/seed.ts";
import { consumeEvent } from "../../impl.ts";
import type { LoggedEvent } from "../../handlers/triggers.ts";
import { findRunLink, serviceFor } from "../../projections.ts";
import type { Definition } from "../../projections.ts";

type Json = unknown;
export type Ledger = Record<string, Json>;
export interface Scenario { run(): Promise<Ledger> }

const SERVICE = { id: "svc_engine", kind: "service" as const };
const names = new Map<string, string>();

async function live(h: Harness, name: string, definition: Definition, enable = true): Promise<string> {
  const id = (await h.call("automations.create", create({ name, definition }), alice)).automation.id as string;
  names.set(id, name);
  if (enable) await h.call("automations.set_enabled", { automationId: id, enabled: true }, alice);
  return id;
}

/** Take every id this world minted out of a ledger: automations by name, their Service principals as svc:name. */
function scrub(v: Json): Json {
  if (typeof v === "string") {
    let s = v;
    for (const [id, name] of names) s = s.split(serviceFor(id)).join(`svc:${name}`).split(id).join(name);
    return s;
  }
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, scrub(x)]));
  return v;
}

/** One event through the consumer: what it did to each Automation, by name, in name order. */
async function feed(h: Harness, ev: LoggedEvent): Promise<{ event: string; results: string[] }> {
  const out = await h.consumer(SERVICE, (ctx) => consumeEvent(ctx, ev));
  const results = out.map((o) => `${names.get(o.automationId)} -> ${"runId" in o.result ? o.result.runId : `dropped:${o.result.dropped}`}`).sort();
  return { event: ev.id, results };
}

/** The Runs the world started, with what each was pinned to. */
function runsOf(h: Harness): Json[] {
  return h.runs.map((r) => {
    const l = findRunLink(h.db, r.id)!;
    return {
      run: r.id, kind: r.kind, automation: l.automationId, version: l.version, trigger: l.trigger, test: l.test, depth: l.depth, origin: l.origin ?? null,
      eventId: l.eventId ?? null, parentRun: l.parentRun ?? null, principal: `${l.principal.kind}:${l.principal.id}`, payload: l.payload,
    };
  });
}

/** What the world said about triggers, in a form that does not depend on the order Automations were visited. */
function said(h: Harness, sorted: boolean): string[] {
  const lines = h.allEvents.filter((e) => e.name === "automation.run_started" || e.name === "automation.trigger_dropped")
    .map((e) => `${e.name}:${String(e.payload.automationId)}${e.name === "automation.trigger_dropped" ? `:${String(e.payload.reason)}` : ""}`);
  return sorted ? lines.sort() : lines;
}

const finish = (h: Harness, decisions: unknown[], sorted = false): Ledger => ({ decisions, runs: runsOf(h), said: said(h, sorted) });
const upd = (recordId: string, type: string, fields: Record<string, unknown>, prev: Record<string, unknown>, version: number): Record<string, unknown> => ({ recordId, type, fields, prev, version });
const ok = { type: "contact", recordId: "rec_abc", patch: { status: "active" } };
const msg = (id: string, over: Partial<LoggedEvent> = {}): LoggedEvent => ({ id, type: "message.received", payload: { text: "hi" }, ...over });

const chat = [{ key: "chat_message" }];

export const SCENARIOS: Record<string, Scenario> = {
  "record changes: the filter picks type, operation and changed field": {
    async run() {
      names.clear();
      const h = harness();
      await live(h, "Won", goodDefinition({ triggers: [{ key: "record_change", filter: { type: "contact", op: "updated", fields: ["status"] } }] }));
      await live(h, "Deals", goodDefinition({ triggers: [{ key: "record_change", filter: { type: "deal" } }] }));
      const decisions = [
        await feed(h, { id: "evt_1", type: "record.updated", payload: upd("rec_1", "contact", { status: "won" }, { status: "new" }, 3), depth: 0 }),
        await feed(h, { id: "evt_2", type: "record.updated", payload: upd("rec_2", "contact", { email: "a@example.com" }, { email: "b@example.com" }, 2), depth: 0 }),
        await feed(h, { id: "evt_3", type: "record.created", payload: { recordId: "rec_3", type: "contact", fields: { status: "new" }, version: 1 }, depth: 0 }),
        await feed(h, { id: "evt_4", type: "record.updated", payload: upd("rec_4", "deal", { status: "won" }, { status: "open" }, 5), depth: 0 }),
      ];
      return scrub(finish(h, decisions)) as Ledger;
    },
  },
  "chain: self-trigger allowed, the ninth hop does not start": {
    async run() {
      names.clear();
      const h = harness();
      const id = await live(h, "Chain", goodDefinition({ triggers: chat, allowSelfTrigger: true }));
      const decisions = [];
      for (let i = 0; i <= 8; i++) {
        decisions.push(await feed(h, { id: `evt_chain${i}`, type: "message.received", payload: { n: i }, origin: i ? `automation:${id}` : "user", depth: i }));
      }
      return scrub(finish(h, decisions)) as Ledger;
    },
  },
  "self-trigger: dropped for the Automation that caused the event, not for another": {
    async run() {
      names.clear();
      const h = harness();
      const solo = await live(h, "Solo", goodDefinition({ triggers: chat }));
      await live(h, "Other", goodDefinition({ triggers: chat }));
      const decisions = [await feed(h, msg("evt_s1", { origin: `automation:${solo}`, depth: 1 }))];
      return scrub(finish(h, decisions, true)) as Ledger;
    },
  },
  "draft, off and paused: only an enabled Automation starts, a paused one says why": {
    async run() {
      names.clear();
      const h = harness();
      await live(h, "Draft", goodDefinition({ triggers: chat }), false);
      const off = await live(h, "Off", goodDefinition({ triggers: chat }));
      await h.call("automations.set_enabled", { automationId: off, enabled: false }, alice);
      await live(h, "Live", goodDefinition({ triggers: chat }));
      const halted = await live(h, "Halted", goodDefinition({ triggers: chat }));
      await h.call("automations.stop", { automationId: halted }, alice);
      const decisions = [await feed(h, msg("evt_p1", { payload: { text: "x" } }))];
      return scrub(finish(h, decisions, true)) as Ledger;
    },
  },
  "versions: a Run keeps the version it started on, replay picks same or current": {
    async run() {
      names.clear();
      const h = harness();
      const id = await live(h, "Versioned", goodDefinition({ triggers: [{ key: "record_change", filter: { type: "contact" } }] }));
      const decisions = [await feed(h, { id: "evt_v1", type: "record.updated", payload: upd("rec_1", "contact", { status: "won" }, { status: "new" }, 3), depth: 0 })];
      const grown = goodDefinition({ triggers: [{ key: "record_change", filter: { type: "contact" } }], nodes: [node("a", "records.update", ok, { next: ["b"] }), node("b", "records.update", ok)] });
      const v2 = (await h.call("automations.update", { automationId: id, definition: grown }, alice)).automation.version as number;
      decisions.push({ version: v2 });
      decisions.push(await feed(h, { id: "evt_v2", type: "record.updated", payload: upd("rec_2", "contact", { status: "lost" }, { status: "new" }, 1), depth: 0 }));
      await h.call("automations.replay", { automationId: id, runId: "run_t1", version: "same" }, alice);
      await h.call("automations.replay", { automationId: id, runId: "run_t1", version: "current" }, alice);
      return scrub(finish(h, decisions)) as Ledger;
    },
  },
  "definitions: the shapes the 0.6 decide, repeat, parallel and wait scenarios became": {
    async run() {
      names.clear();
      const h = harness();
      const mk = (id: string, next?: string[]) => node(id, "records.update", ok, next ? { next } : {});
      const mail = node("after", "send_email", { to: "a@example.com", subject: "Hello", body: "Hi", mailboxId: "mbx_main" });
      const cases: Record<string, Definition> = {
        decide: { triggers: [{ key: "manual" }], nodes: [node("d", "if", { condition: "trigger.n > 1" }, { branches: [{ label: "yes", to: "big" }, { label: "no", to: "small" }] }), mk("big", ["after"]), mk("small", ["after"]), mail] },
        repeat: { triggers: [{ key: "manual" }], nodes: [node("each", "loop", { items: "trigger.names" }, { next: ["mk"] }), mk("mk", ["each"])] },
        cycle: { triggers: [{ key: "manual" }], nodes: [mk("a", ["b"]), mk("b", ["a"])] },
        parallel: { triggers: [{ key: "manual" }], nodes: [node("p", "parallel", { branches: ["l", "r"] }, { next: ["l", "r"] }), mk("l", ["after"]), mk("r", ["after"]), mail] },
        orphan: { triggers: [{ key: "manual" }], nodes: [node("w", "wait", {}), mk("orphan")] },
        empty: { triggers: [{ key: "manual" }], nodes: [] },
        dangling: { triggers: [{ key: "manual" }], nodes: [node("i", "if", { condition: "x" }, { branches: [{ label: "yes", to: "gone" }] })] },
        missing: { triggers: [{ key: "manual" }], nodes: [node("a", "records.update", { type: "contact" })] },
      };
      const out: Record<string, Json> = {};
      for (const [k, definition] of Object.entries(cases)) {
        const r = (await h.call("automations.validate", { definition }, alice)) as { ok: boolean; issues: { nodeId?: string; severity: string; message: string }[] };
        out[k] = { ok: r.ok, issues: r.issues.map((i) => `${i.severity}:${i.nodeId ?? "-"}:${i.message}`) };
      }
      return out;
    },
  },
};
