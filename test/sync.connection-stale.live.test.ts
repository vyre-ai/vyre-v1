// A first pull of several types on one connection, while a bulk writer fills another type (17 Nov 2026: a firm's first sync, 7 tables at once, about 100,000 records written; passes of two types failed
// again and again with "There is no such connection." while the connection was there and the other types pulled fine). No pass may say the connection is missing while it exists.
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
    let writing = true;
    let written = 0;
    const writers = [0, 1].map((k) =>
      (async () => {
        for (let b = 0; writing && b < 12; b++) {
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
        }
      })(),
    );
    const missing = new Set<string>();
    try {
      await waitFor(
        async () => {
          await pump(w.d);
          log(`pumped, written ${written}`);
          let all = true;
          for (const [type, total] of Object.entries(TYPES)) {
            const st = (await call(w.d, "sync_types.status", { type })).data;
            for (const f of st.failures ?? [])
              if (/no such connection/i.test(JSON.stringify(f)))
                missing.add(`${type}: ${JSON.stringify(f).slice(0, 160)}`);
            if (!(st.records >= total && !st.catchingUp)) all = false;
          }
          return all ? true : null;
        },
        100_000,
        () => `${hostLog(w.d)} written ${written}`,
      );
    } finally {
      writing = false;
      await Promise.all(writers);
    }
    process.stderr.write(
      `[stale] ${written} records written while the pull ran; ${missing.size} passes said no such connection\n`,
    );
    assert.deepEqual([...missing], [], "no pass reported an existing connection as missing");
  } finally {
    await w.close();
  }
});
