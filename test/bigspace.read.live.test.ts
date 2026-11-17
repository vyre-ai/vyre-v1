// A paged read of a big table does not fail while a sync is writing records into it (17 Nov 2026: 422 "Access changed while reading" on the firm's server). A writer upserts new matters in batches while a
// reader pages the table through the relay; every page answers 200.
import test from "node:test";
import assert from "node:assert/strict";
import { cap, request, rig, seed, seededDir } from "./support/bigspace-kit.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const log = (m: string) => process.stderr.write(`[read ${new Date().toISOString().slice(11, 23)}] ${m}\n`);

test(
  "paged reads of a big table all answer while a sync writes new records into it",
  { timeout: 300_000 },
  async () => {
    const r = await rig(seededDir());
    try {
      await seed(r.d, { matters: 1200, fields: 100, contacts: 200, orgs: 50 }, log);
      const { ch } = await r.channel();
      const rcall = async (c: string, body: Record<string, unknown>): Promise<{ status: number; text: string }> => {
        const res = await request(
          ch,
          {
            method: "POST",
            path: `/v1/${c.replaceAll(".", "/")}`,
            headers: { "content-type": "application/json", authorization: `Bearer ${r.d.token}` },
          },
          new TextEncoder().encode(JSON.stringify({ idempotencyKey: `rd-${Math.random()}`, ...body })),
        );
        return { status: res.status, text: await res.text() };
      };
      let writing = true;
      let written = 0;
      const writer = (async () => {
        for (let b = 0; writing; b++) {
          const rows = Array.from({ length: 100 }, (_, i) => ({
            name: `Sync ${b}-${i}`,
            ...Object.fromEntries(Array.from({ length: 100 }, (_, f) => [`f${f}`, `v ${b} ${i} ${f}`])),
          }));
          await cap(r.d, "records.bulk_upsert", {
            type: "rt_matter",
            match: ["name"],
            rows,
            createOnly: true,
            runAutomations: false,
          });
          written += 100;
        }
      })();
      const bad: string[] = [];
      let pages = 0;
      const until = Date.now() + 20_000;
      while (Date.now() < until) {
        let cursor: string | undefined;
        for (let p = 0; p < 12; p++) {
          const res = await rcall("records.query", { type: "rt_matter", limit: 100, ...(cursor ? { cursor } : {}) });
          pages++;
          if (res.status !== 200) {
            bad.push(`${res.status} ${res.text.slice(0, 160)}`);
            break;
          }
          cursor = (JSON.parse(res.text).data as Any).next;
          if (!cursor) break;
        }
      }
      writing = false;
      await writer;
      log(
        `${pages} pages read while ${written} records were written; ${bad.length} refused ${JSON.stringify(bad.slice(0, 2))}`,
      );
      assert.deepEqual(bad, [], "no page was refused");
    } finally {
      await r.stop();
    }
  },
);
