// A dropped field is restorable for 30 days; when that window ends its values leave every copy. The data folder's database files (the Space log, the records store, the modules database, with their journals) are
// searched for the value as raw bytes: found before the purge, 0 hits after. A field still inside its window is untouched, and a field that came back is not cleaned.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { bootHour } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";

let h: Hour;
before(async () => {
  h = await bootHour("trashpurge");
});
after(async () => {
  await h?.stop();
});

const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.db(-wal|-shm)?$/.test(e.name) ? [p] : [];
  });
/** Hits of a literal in the raw bytes of every database file of the data folder, by file name. */
function hits(value: string): Record<string, number> {
  const out: Record<string, number> = {};
  const needle = Buffer.from(value);
  for (const f of files(h.dir)) {
    const buf = fs.readFileSync(f);
    let n = 0;
    for (let at = buf.indexOf(needle); at >= 0; at = buf.indexOf(needle, at + 1)) n++;
    if (n) out[path.relative(h.dir, f)] = n;
  }
  return out;
}
const total = (r: Record<string, number>): number => Object.values(r).reduce((a, b) => a + b, 0);

async function makeType(type: string): Promise<void> {
  await h.owner.call("schema.apply", {
    idempotencyKey: `tp-${type}`,
    ops: [
      {
        op: "type.create",
        type,
        def: {
          title: "T",
          plural: "Ts",
          icon: "table",
          titleField: "name",
          fields: ["name", "note"].map((key) => ({ key, type: "text", title: key })),
        },
      },
    ],
  });
}
async function drop(type: string, field: string): Promise<void> {
  const ops = [{ op: "field.drop", type, field }];
  const diff = (await h.owner.call("schema.diff", { ops })) as {
    previewToken: string;
    items: Array<{ itemKey: string; destructive: boolean }>;
  };
  await h.owner.call("schema.apply", {
    idempotencyKey: `tpd-${type}-${field}`,
    ops,
    previewToken: diff.previewToken,
    confirm: diff.items.filter((i) => i.destructive).map((i) => i.itemKey),
  });
}
/** The window of the Trash entries of a field ends now (the clock is the machine's, so the entry is aged in its table). */
function expire(type: string, field: string): void {
  const db = new DatabaseSync(path.join(h.dir, "space.db"));
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.prepare("UPDATE sc_trash SET expires_at = 1 WHERE type = ? AND field = ?").run(type, field);
  } finally {
    db.close();
  }
}
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) {
    await h.d.hooks?.pump?.();
    await new Promise((r) => setTimeout(r, 250));
  }
};

test("when the window of a dropped field ends, its values are in no database file of the Space; a field inside its window is left alone", async () => {
  await makeType("tp_gone");
  await makeType("tp_kept");
  const GONE = "zqpurgeGONE7731",
    KEPT = "zqpurgeKEPT4410";
  for (const [type, v] of [
    ["tp_gone", GONE],
    ["tp_kept", KEPT],
  ] as const) {
    const id = (
      (await h.owner.call("records.create", { type, fields: { name: `${type} one`, note: v } })).record as {
        id: string;
      }
    ).id;
    await h.owner.call("records.update", { type, recordId: id, patch: { note: `${v}b` } });
  }
  await settle();
  await drop("tp_gone", "note");
  await drop("tp_kept", "note");
  await settle();
  const before = hits(GONE);
  assert.ok(
    total(before) > 0,
    `control: the dropped value is still in the files while the field can be restored: ${JSON.stringify(before)}`,
  );
  // inside its window nothing is purged
  await h.d.hooks!.runPeriodic("schema.trash_purge");
  assert.ok(total(hits(GONE)) > 0, "a field inside its window is not purged");
  // the window of one ends
  expire("tp_gone", "note");
  await h.d.hooks!.runPeriodic("schema.trash_purge");
  await settle();
  const left = hits(GONE);
  assert.equal(total(left), 0, `the dropped value is in no database file after the purge: ${JSON.stringify(left)}`);
  assert.ok(total(hits(KEPT)) > 0, "the other field, still inside its window, is untouched");
  // the record itself still reads, without the field
  const rows = (await h.owner.call("records.query", { type: "tp_gone", limit: 5 })).rows as Array<{
    fields: Record<string, unknown>;
  }>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.fields["name"], "tp_gone one");
  const trash = (await h.owner.call("schema.trash.list", {})) as {
    items?: Array<{ type: string }>;
    entries?: Array<{ type: string }>;
  };
  assert.ok(!JSON.stringify(trash).includes("tp_gone"), "its Trash entry is gone");
  assert.ok(JSON.stringify(trash).includes("tp_kept"), "the other Trash entry stays");
});

test("a purge of one field leaves no value of another field in the rebased rows an earlier purge wrote", async () => {
  const type = "tp_reb";
  await h.owner.call("schema.apply", {
    idempotencyKey: "tp-reb",
    ops: [
      {
        op: "type.create",
        type,
        def: {
          title: "R",
          plural: "Rs",
          icon: "table",
          titleField: "name",
          fields: ["name", "fa", "fb"].map((key) => ({ key, type: "text", title: key })),
        },
      },
    ],
  });
  const A = "zqrebAAA5521",
    B = "zqrebBBB5522";
  const id = (
    (await h.owner.call("records.create", { type, fields: { name: "reb one", fa: A, fb: B } })).record as { id: string }
  ).id;
  await h.owner.call("records.update", { type, recordId: id, patch: { fb: `${B}x` } });
  await settle();
  // B goes first: its purge writes the row again (record.rebased) while A is still a live field, so that event holds A's value
  await drop(type, "fb");
  await settle();
  expire(type, "fb");
  await h.d.hooks!.runPeriodic("schema.trash_purge");
  await settle();
  assert.equal(total(hits(B)), 0, `B is gone: ${JSON.stringify(hits(B))}`);
  assert.ok(total(hits(A)) > 0, "control: A, still a live field, is in the files");
  await drop(type, "fa");
  await settle();
  expire(type, "fa");
  await h.d.hooks!.runPeriodic("schema.trash_purge");
  await settle();
  // the journal of the search index is folded in a moment after the purge (an idle writer): look for up to 20 s
  let left = hits(A);
  for (let i = 0; i < 40 && total(left) > 0; i++) {
    await new Promise((r) => setTimeout(r, 500));
    left = hits(A);
  }
  assert.equal(
    total(left),
    0,
    `A is in no database file or journal, the rebased row of the first purge included: ${JSON.stringify(left)}`,
  );
});

/** The longest time the loop went without running a 2 ms timer. */
function watchLoop(): { stop(): Promise<number> } {
  let last = performance.now(),
    max = 0;
  const t = setInterval(() => {
    const at = performance.now();
    max = Math.max(max, at - last - 2);
    last = at;
  }, 2);
  return {
    stop: async () => {
      await new Promise<void>((r) => setTimeout(r, 10));
      clearInterval(t);
      return Math.round(max);
    },
  };
}

test("the purge of a dropped type of 5,000 records and eight fields never holds the loop for 100 ms and leaves none of its values in the Space log or the modules database", async () => {
  const type = "tp_big";
  const keys = ["name", ...Array.from({ length: 7 }, (_, i) => `f${i}`)];
  await h.owner.call("schema.apply", {
    idempotencyKey: "tp-big",
    ops: [
      {
        op: "type.create",
        type,
        def: {
          title: "Big",
          plural: "Bigs",
          icon: "table",
          titleField: "name",
          fields: keys.map((key) => ({ key, type: "text", title: key })),
        },
      },
    ],
  });
  for (let at = 0; at < 5_000; at += 500)
    await h.owner.call("records.bulk_upsert", {
      idempotencyKey: `tp-big-${at}`,
      type,
      match: ["name"],
      createOnly: true,
      runAutomations: false,
      rows: Array.from({ length: 500 }, (_, i) =>
        Object.fromEntries(keys.map((k) => [k, k === "name" ? `Big ${at + i}` : `zqbig${k}v${at + i}`])),
      ),
    });
  await settle();
  const probe = "zqbigf3v4321";
  assert.ok(total(hits(probe)) > 0, "control: the value is in the files before the drop");
  const ops = [{ op: "type.drop", type }];
  const diff = (await h.owner.call("schema.diff", { ops })) as {
    previewToken: string;
    items: Array<{ itemKey: string; destructive: boolean }>;
  };
  await h.owner.call("schema.apply", {
    idempotencyKey: "tp-big-drop",
    ops,
    previewToken: diff.previewToken,
    confirm: diff.items.filter((i) => i.destructive).map((i) => i.itemKey),
  });
  await settle();
  const db = new DatabaseSync(path.join(h.dir, "space.db"));
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.prepare("UPDATE sc_trash SET expires_at = 1 WHERE type = ?").run(type);
  } finally {
    db.close();
  }
  const watch = watchLoop();
  const t0 = performance.now();
  let ticks = 0;
  for (; ticks < 60; ticks++) {
    await h.d.hooks!.runPeriodic("schema.trash_purge");
    const left = new DatabaseSync(path.join(h.dir, "space.db"), { readOnly: true });
    const n = Number((left.prepare("SELECT count(*) AS c FROM sc_trash WHERE type = ?").get(type) as { c: number }).c);
    left.close();
    if (n === 0) break;
  }
  const longest = await watch.stop();
  await settle();
  const leftHits = hits(probe);
  console.log(
    `purge of a type of 5,000 records and 8 fields: ${Math.round(performance.now() - t0)} ms in ${ticks + 1} ticks, longest loop block ${longest} ms, hits left ${JSON.stringify(leftHits)}`,
  );
  assert.ok(longest < 100, `the longest stretch the loop was held during the purge was ${longest} ms (limit 100)`);
  for (const f of Object.keys(leftHits))
    assert.ok(
      !/events\.db|modules\.db/.test(f),
      `the dropped type's values are not in ${f}: ${JSON.stringify(leftHits)}`,
    );
});
