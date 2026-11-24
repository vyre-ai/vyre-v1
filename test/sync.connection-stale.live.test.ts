// A first pull of several types on one connection, while a bulk writer fills another type (17 Nov 2026: a firm's first sync, 7 tables at once, about 100,000 records written; passes of two types failed
// again and again with "There is no such connection." while the connection was there and the other types pulled fine). No pass may say the connection is missing while it exists. This walk does not reproduce the 17 Nov defect at this scale, not even on its own pre-fix tree (that needed about 100,000 records over 7 tables); the retry is covered by modules/connectors/tests/syncrun.test.ts, and what this walk proves is the overlap and the absence of "no such connection" under writers. The writers write until every pass has finished and a batch must be in flight during each pass, so the walk proves the overlap on any runner.
import test from "node:test";
import assert from "node:assert/strict";
import { call, hostLog, waitFor } from "./support/eco-live.ts";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { pump, spec, world } from "./support/sync-live.ts";

const BIG = 600;
const TYPES: Record<string, number> = { person: 600 + 2, matter: BIG, contact: BIG, company: BIG, note: 5 };
const FIELDS = 40;

const log = (m: string) => process.stderr.write(`[stale ${new Date().toISOString().slice(11, 23)}] ${m}\n`);
test("passes of several types on one connection never report it missing while a bulk writer fills another type", async () => {
  const PEOPLE: Record<string, string> = { member: "usr_noah" };
  const w = await world(
    true,
    { bulk: 600, big: BIG },
    {
      session: (headers: Record<string, unknown>) => {
        const who = PEOPLE[String(headers["authorization"] ?? "").replace(/^Bearer /, "")] ?? "usr_olivia";
        return who ? { space: CORE_SPACE, principal: { kind: "person", id: who }, device: "fixture" } : null;
      },
    },
  );
  try {
    assert.equal(w.item.status, 200, JSON.stringify(w.item.data));
    log("world up");
    const s = spec();
    for (const o of s.objects) o.list.cursor.size = 100;
    const applied = await call(w.d, "sync_specs.apply", { spec: s, idempotencyKey: "apply-stale" });
    assert.equal(applied.status, 200, JSON.stringify(applied.data));
    log("applied");
    const asMember = async (cap: string, input: unknown): Promise<{ status: number; data: any }> => {
      const r = await fetch(`${w.d.url}/v1/${cap.replaceAll(".", "/")}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer member" },
        body: JSON.stringify(input),
      });
      const body = (await r.json()) as { data?: unknown };
      return { status: r.status, data: body.data ?? body };
    };
    const conns = await call(w.d, "connections.list", {});
    log(`connections ${JSON.stringify(conns.data).slice(0, 300)}`);
    const passStart = Date.now(); // the passes are asked for here
    for (const type of Object.keys(TYPES)) {
      const r = await asMember("connectors.sync_now", { idempotencyKey: `m-${type}`, type, mode: "incremental" });
      log(`member sync_now ${type}: ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    }
    const made = await call(w.d, "schema.apply", {
      idempotencyKey: "bulkw-type",
      ops: [
        {
          op: "type.create",
          type: "rt_bulkw",
          def: {
            title: "Bulk",
            plural: "Bulks",
            icon: "table",
            titleField: "name",
            fields: [
              { key: "name", type: "text", title: "Name", required: true },
              ...Array.from({ length: FIELDS }, (_, f) => ({ key: `f${f}`, type: "text", title: `F${f}` })),
            ],
          },
        },
      ],
    });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    log("type made");
    // The writers keep writing 100-row batches of the same 41 fields until every type's pass has finished, then stop: the walk controls the OVERLAP of the writers with the passes, not the volume, so it proves
    // the same on a fast runner and a slow one and its time does not scale with the load. Each batch's start and commit time is kept to check that a batch was in flight during every pass.
    const EARLY_STOP = process.env["STALE_WRITERS_STOP_EARLY"] === "1"; // the red proof: writers that stop after one batch each must fail the overlap check
    const WRITER_PAUSE_MS = 1000; // a writer that never pauses starves the passes on the one loop: this is a firm bulk-loading beside a sync, not a flood
    const BURST = 3; // batches each writer makes with no pause: the early pressure of the 17 Nov defect
    const MAX_BATCHES = 400; // a guard against a runaway writer; the wait below fails the walk long before it
    let writing = true;
    let written = 0;
    const batches: { start: number; end: number }[] = [];
    const writers = [0, 1].map((k) =>
      (async () => {
        for (let b = 0; writing && b < (EARLY_STOP ? 1 : MAX_BATCHES); b++) {
          const start = Date.now();
          const r = await call(w.d, "records.bulk_upsert", {
            idempotencyKey: `bw-${k}-${b}`,
            type: "rt_bulkw",
            match: ["name"],
            rows: Array.from({ length: 100 }, (_, i) => ({
              name: `W${k} ${b}-${i}`,
              ...Object.fromEntries(
                Array.from({ length: FIELDS }, (_, f) => [`f${f}`, `v ${b} ${i} ${f} lorem ipsum`]),
              ),
            })),
            createOnly: true,
            runAutomations: false,
          });
          assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
          written += 100;
          batches.push({ start, end: Date.now() });
          if (b >= BURST) await new Promise<void>((done) => setTimeout(done, WRITER_PAUSE_MS)); // the first batches go back to back, as the old walk did, then one a second
        }
      })(),
    );
    const missing = new Set<string>();
    const passEnd = new Map<string, number>();
    let pumping: Promise<void> | null = null;
    try {
      await waitFor(
        async () => {
          // the hook pass runs until no event is new, which never happens while the writers write: it is started, not waited for
          if (!pumping) pumping = pump(w.d).finally(() => (pumping = null));
          await new Promise<void>((done) => setTimeout(done, 100));
          log(`polled, written ${written}`);
          for (const [type, total] of Object.entries(TYPES)) {
            const st = (await call(w.d, "sync_types.status", { type })).data;
            for (const f of st.failures ?? [])
              if (/no such connection/i.test(JSON.stringify(f)))
                missing.add(`${type}: ${JSON.stringify(f).slice(0, 160)}`);
            // a pass is finished when the type holds every record; "catching up" stays true for as long as the writers add events, so it is checked once they have stopped
            if (st.records >= total && !passEnd.has(type)) passEnd.set(type, Date.now());
          }
          return passEnd.size === Object.keys(TYPES).length ? true : null;
        },
        100_000,
        () => `${hostLog(w.d)} written ${written}; finished ${[...passEnd.keys()].join(",")}`,
      );
    } finally {
      writing = false;
      await Promise.all(writers);
    }
    await waitFor(
      async () => {
        await pump(w.d);
        for (const type of Object.keys(TYPES)) {
          const st = (await call(w.d, "sync_types.status", { type })).data;
          for (const f of st.failures ?? [])
            if (/no such connection/i.test(JSON.stringify(f)))
              missing.add(`${type}: ${JSON.stringify(f).slice(0, 160)}`);
          if (st.catchingUp) return null;
        }
        return true;
      },
      100_000,
      () => `${hostLog(w.d)} written ${written}`,
    );
    // a writer batch was in flight during the second half of every type's pass (so the writers were still writing when the pass finished, not before it began)
    for (const [type, end] of passEnd) {
      const mid = passStart + (end - passStart) / 2;
      assert.ok(
        batches.some((b) => b.start < end && b.end > mid),
        `no writer batch overlapped the second half of the ${type} pass (${batches.length} batches, pass ${end - passStart} ms)`,
      );
    }
    process.stderr.write(
      `[stale] ${written} records written while the pull ran; ${missing.size} passes said no such connection\n`,
    );
    assert.deepEqual([...missing], [], "no pass reported an existing connection as missing");
  } finally {
    await w.close();
  }
});
