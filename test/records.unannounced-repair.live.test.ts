// Meier, rc.42 (26 Nov 2026): dv_event had 4,267 records and the owner saw 986. Records an older build wrote without ever announcing them (a sync stopped by an update) are no resource, so no one sees them. A start
// announces them: the owner's walk holds every record. Real server-role daemon, stopped, its record file changed as the old build left it, and started again by Hour.restart().
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { bootHour } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";

let h: Hour;
before(async () => {
  h = await bootHour("announcerepair", { keepDir: true });
});
after(async () => {
  await h?.stop();
  if (h?.dir) fs.rmSync(h.dir, { recursive: true, force: true });
});

const spaceDb = (): string => {
  const walk = (d: string): string[] =>
    fs
      .readdirSync(d, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  return walk(h.dir).find((f) => /space\.db$/.test(f))!;
};
const walkCount = async (): Promise<number> => {
  let n = 0;
  for (let cursor: string | undefined; ; ) {
    const page = (await h.owner.call("records.query", {
      type: "contact",
      limit: 500,
      ...(cursor ? { cursor } : {}),
    })) as {
      rows: unknown[];
      next?: string;
    };
    n += page.rows.length;
    cursor = page.next;
    if (!cursor) return n;
  }
};

test(
  "records an old build left with no announcement are announced at the start and the owner sees all of them",
  { timeout: 240_000 },
  async () => {
    await h.owner.call("records.bulk_upsert", {
      type: "contact",
      match: ["email"],
      createOnly: true,
      idempotencyKey: "ar-1",
      rows: Array.from({ length: 50 }, (_, i) => ({ name: `Kept ${i}`, email: `k${i}@ar.test` })),
    });
    assert.equal(await walkCount(), 50);
    const LOST = 40;
    await h.restart(() => {
      // as the old build left it: rows in the record table, no event in either log, so no resource
      const db = new DatabaseSync(spaceDb());
      try {
        const at = Date.now() - 3_600_000;
        const one = db.prepare("SELECT data FROM rt_contact LIMIT 1").get() as { data: string };
        const ins = db.prepare(
          "INSERT INTO rt_contact (id, version, created_at, updated_at, deleted_at, data) VALUES (?, 1, ?, ?, NULL, ?)",
        );
        for (let i = 0; i < LOST; i++)
          ins.run(
            `rec_lost${String(i).padStart(4, "0")}`,
            at,
            at,
            one.data.replace(/Kept \d+/, `Lost ${i}`).replace(/k\d+@/, `l${i}@`),
          );
      } finally {
        db.close();
      }
    });
    let seen = 0;
    for (let t = 0; t < 15 && seen < 50 + LOST; t++) {
      seen = await walkCount();
      if (seen < 50 + LOST) await new Promise((r) => setTimeout(r, 1000));
    }
    assert.equal(seen, 50 + LOST, "the owner sees the records the old build left, and every other one");
  },
);
