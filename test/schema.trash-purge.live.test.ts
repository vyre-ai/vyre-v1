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
