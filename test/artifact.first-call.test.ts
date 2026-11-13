// An agent's FIRST artifact_publish, written the way a model writes it from the description (13 Nov 2026), through the tool layer, the real input validators and the real sites handler: no key from the model, and it
// publishes first time. The handler runs with a stand-in store for the page's files (the module's own world), not a mock of the handler.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { configureRoutes } from "../modules/sites/handlers/route.ts";
import { handlers } from "../modules/sites/impl.ts";
import { harness as base } from "../modules/sites/fixtures/world.ts";
import { createToolSession } from "../agent/src/tools/index.ts";
import { loadGenerated } from "../agent/src/tools/harness.ts";
import { validateInput } from "../generated/validators.ts";
import { HostError, makeError } from "../host/src/routes/errors.ts";

const h = handlers as unknown as Record<string, (ctx: unknown, input: unknown) => Promise<any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

test("a model's first artifact_publish, with no key, publishes on the real handler", async () => {
  const w = base();
  const db = new DatabaseSync(":memory:");
  for (const f of ["0001_sites_core.sql", "0002_promote_tables.sql", "0003_routes.sql"])
    db.exec(fs.readFileSync(new URL(`../modules/sites/migrations/${f}`, import.meta.url), "utf8"));
  const ctx = {
    ...w.ctx,
    thread: "thr_1",
    db: {
      all: (sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as never[])),
      run: (sql: string, ...a: unknown[]) => ({ changes: Number(db.prepare(sql).run(...(a as never[])).changes) }),
    },
    call: async () => ({}),
  };
  const put: string[] = [];
  configureRoutes({
    origin: () => ({ origin: "https://harbor.vyre.run", relay: true }),
    probe: async () => ({ answering: true }),
    artifacts: { folder: async () => "fld_a", put: async (_f: string, name: string) => void put.push(name) },
  } as never);
  try {
    const loaded = loadGenerated();
    const seen: unknown[] = [];
    const s = createToolSession({
      catalog: loaded.catalog,
      defaults: loaded.defaults,
      levelFor: () => "manage",
      canEngineer: () => false,
      invoke: async (cap, input, seed) => {
        const traceId = seed.trace?.traceId ?? "trace";
        const problems = validateInput(cap, 1, input);
        if (problems.length) throw new HostError(makeError("validation.bad_input", traceId, { details: { errors: problems, cap } }));
        seen.push(input);
        return { status: "ok", output: await h[cap]!(ctx, input), traceId };
      },
    });
    s.preload("thr_1", ["artifact_publish"]);
    const out = await s.call(
      { space: "spc_1", agentId: "agt_dex", asker: "usr_dana", thread: { threadId: "thr_1", kind: "chat", planMode: false }, turnId: "trn_1", callId: "toolu_1" },
      "artifact_publish",
      { title: "Q3 plan", html: "<h1>Q3 plan</h1>" },
    );
    assert.equal(out.kind, "result", JSON.stringify(out.kind === "error" ? out.result.content : ""));
    const data = (out.kind === "result" ? out.result.content : {}) as { data?: { artifactId?: string; updated?: boolean } };
    assert.match(data.data?.artifactId ?? "", /^sit_/);
    assert.equal(data.data?.updated, false);
    assert.deepEqual(put, ["index.html"]);
    assert.equal((seen[0] as { idempotencyKey?: string }).idempotencyKey, "ag:trn_1:toolu_1");
  } finally {
    configureRoutes(null);
  }
});
