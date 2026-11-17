// A paged read of a big type stays correct while other records are being created (17 Nov 2026: a firm's server, 9,400 matters of ~100 fields, a sync writing: "Access changed while reading" 422 on
// pages of 200 to 500). Two writers run through the whole read: one creates records of ANOTHER type, one creates records of the SAME type (a sync does). Readers page by cursor, by offset and sorted. Every
// page answers 200, no row repeats inside one read, and every record that existed when the read began is in it.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, seededDir } from "./support/live.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0;
const BATCH = 60;
async function cap(d: Any, c: string, input: Record<string, unknown> = {}): Promise<Any> {
  const r = await call(d, c, { idempotencyKey: `pr-${c}-${++n}-${Math.random()}`, ...input });
  assert.equal(r.status, 200, `${c}: ${JSON.stringify(r.data).slice(0, 300)}`);
  return r.data;
}
const FIELDS = 40;
const body = (tag: string, i: number): Record<string, unknown> => ({
  name: `${tag} ${i}`,
  ...Object.fromEntries(
    Array.from({ length: FIELDS }, (_, f) => [`f${f}`, `${tag} ${i} field ${f} lorem ipsum dolor`]),
  ),
});
const def = (title: string) => ({
  title,
  plural: `${title}s`,
  icon: "table",
  titleField: "name",
  fields: [
    { key: "name", type: "text", title: "Name", required: true },
    ...Array.from({ length: FIELDS }, (_, f) => ({ key: `f${f}`, type: "text", title: `Field ${f}` })),
  ],
});

test(
  "paged reads of a big type answer and stay whole while records of another type and of the same type are created",
  { timeout: 400_000 },
  async () => {
    const d = await boot(seededDir(), null);
    try {
      await cap(d, "schema.apply", {
        ops: [
          { op: "type.create", type: "rt_matter", def: def("Matter") },
          { op: "type.create", type: "rt_other", def: def("Other") },
        ],
      });
      const SEED = 2000;
      for (let at = 0; at < SEED; at += 500)
        await cap(d, "records.bulk_upsert", {
          type: "rt_matter",
          match: ["name"],
          rows: Array.from({ length: 500 }, (_, i) => body("Seed", at + i)),
          createOnly: true,
          runAutomations: false,
        });
      const known = new Set<string>();
      for (let cursor: string | undefined; ; ) {
        const page = await cap(d, "records.query", { type: "rt_matter", limit: 500, ...(cursor ? { cursor } : {}) });
        for (const row of page.rows) known.add(row.id);
        cursor = page.next;
        if (!cursor) break;
      }
      assert.equal(known.size, SEED);

      let writing = true;
      let written = 0;
      const writers = [
        // another type, in batches
        (async () => {
          for (let b = 0; writing; b++) {
            await cap(d, "records.bulk_upsert", {
              type: "rt_other",
              match: ["name"],
              rows: Array.from({ length: BATCH }, (_, i) => body(`Other${b}`, i)),
              createOnly: true,
              runAutomations: false,
            });
            written += BATCH;
          }
        })(),
        ...Array.from({ length: 4 }, (_, w) =>
          (async () => {
            for (let b = 0; writing; b++) {
              await cap(d, "records.create", {
                type: w % 2 ? "rt_other" : "rt_matter",
                fields: body(`One${w}-${b}`, 0),
              });
              written++;
            }
          })(),
        ),
        // the same type, in batches (a sync)
        (async () => {
          for (let b = 0; writing; b++) {
            await cap(d, "records.bulk_upsert", {
              type: "rt_matter",
              match: ["name"],
              rows: Array.from({ length: BATCH }, (_, i) => body(`Sync${b}`, i)),
              createOnly: true,
              runAutomations: false,
            });
            written += BATCH;
          }
        })(),
        // the same type, a record made and removed again (a sync that drops what the source no longer has)
        (async () => {
          for (let b = 0; writing; b++) {
            const made = await cap(d, "records.create", { type: "rt_matter", fields: body(`Churn${b}`, 0) });
            const id = made.record?.id ?? made.id;
            await cap(d, "records.delete", { type: "rt_matter", recordId: id });
          }
        })(),
      ];
      const bad: string[] = [];
      let pages = 0;
      const readAll = async (mode: "cursor" | "offset" | "sorted", limit: number): Promise<void> => {
        const seen = new Set<string>();
        let cursor: string | undefined;
        let offset = 0;
        for (let p = 0; p < 40; p++) {
          const res = await call(d, "records.query", {
            type: "rt_matter",
            limit,
            ...(mode === "sorted" ? { sort: [{ field: "name", dir: "asc" }] } : {}),
            ...(mode === "offset" ? { offset } : cursor ? { cursor } : {}),
          });
          pages++;
          if (res.status !== 200) {
            bad.push(`${mode} ${limit}: ${res.status} ${JSON.stringify(res.data).slice(0, 160)}`);
            return;
          }
          const page = res.data as Any;
          for (const row of page.rows) {
            if (seen.has(row.id)) bad.push(`${mode} ${limit}: ${row.id} twice`);
            seen.add(row.id);
          }
          if (mode === "offset") {
            offset += page.rows.length;
            if (page.rows.length < limit) break;
          } else {
            cursor = page.next;
            if (!cursor) break;
          }
        }
        if (mode !== "offset")
          for (const id of known)
            if (!seen.has(id)) {
              bad.push(`${mode} ${limit}: ${id} missing`);
              break;
            }
      };
      const until = Date.now() + 15_000;
      while (Date.now() < until) {
        await Promise.all([
          readAll("cursor", 500),
          readAll("cursor", 200),
          readAll("sorted", 300),
          readAll("offset", 250),
        ]);
      }
      writing = false;
      await Promise.all(writers);
      process.stderr.write(
        `[paged] ${pages} pages while ${written} records were created; ${bad.length} wrong ${JSON.stringify(bad.slice(0, 3))}\n`,
      );
      assert.deepEqual(bad, [], "every page answered, nothing repeated, nothing existing was skipped");
    } finally {
      await d.stop();
    }
  },
);
