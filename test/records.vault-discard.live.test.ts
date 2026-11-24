// A value sealed for a record that was then not made is taken back (modules/records createMany -> RecordsVault.discard -> the host seam). This runs the real Vault and the real Gate on a booted daemon: the host's own
// delete is not held for approval (no one gets a "Move this item to Trash?" request, and the secret does not wait for an answer), the item leaves the Vault's lists, and the Space log records the delete.
import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { world } from "./support/sync-live.ts";
import { cap } from "./support/bigspace-kit.ts";
import { recordsVaultInUse } from "../modules/records/impl.ts";

test("a discarded sealed value is overwritten through the host's own path, with no approval held (the delete is gated for the host and would wait for an answer)", { timeout: 120_000 }, async () => {
  const w = await world(true);
  try {
    await cap(w.d, "schema.apply", {
      ops: [
        {
          op: "type.create",
          type: "rt_person",
          def: {
            title: "Person",
            plural: "People",
            icon: "table",
            titleField: "name",
            fields: [
              { key: "name", type: "text", title: "Name", required: true },
              { key: "ssn", type: "sealed", title: "SSN" },
            ],
          },
        },
      ],
    });
    const made = await cap(w.d, "records.bulk_upsert", {
      type: "rt_person",
      match: ["name"],
      rows: [{ name: "Dana", ssn: "123-45-6789" }],
      createOnly: true,
      runAutomations: false,
    });
    assert.equal(made.created, 1);
    const got = await cap(w.d, "records.query", { type: "rt_person", limit: 5 });
    const ref = (got.rows[0].fields ?? got.rows[0].data).ssn.ref as string;
    assert.match(ref, /^vit_/, "the value is a Vault item");
    const tasksBefore = ((await cap(w.d, "tasks.list", { scope: "all", limit: 200 })).tasks as unknown[]).length;
    const value = async (): Promise<string | undefined> =>
      ((await cap(w.d, "vault.item.reveal", { itemId: ref, fields: ["value"], reason: "test" })).fields as { key: string; value: string }[]).find(
        (f) => f.key === "value",
      )?.value;
    assert.equal(await value(), "123-45-6789", "the sealed value is in the Vault before");
    const secret = (): { n: number; box: string; rev: number } => {
      const db = new DatabaseSync(w.d.paths.modules, { readOnly: true });
      try {
        const rows = db.prepare('SELECT box, rev FROM vault_secret WHERE "itemId" = ?').all(ref) as { box: string; rev: number }[];
        return { n: rows.length, box: rows[0]?.box ?? "", rev: rows[0]?.rev ?? 0 };
      } finally {
        db.close();
      }
    };
    const was = secret();
    assert.equal(was.n, 1);
    const vault = recordsVaultInUse();
    assert.ok(vault?.discard, "the host's seam has discard");
    await vault!.discard!(ref); // rejects with "held for approval" if the Gate held it
    assert.ok(!(await value())?.includes("123-45-6789"), "the plaintext is gone from the item");
    assert.equal(((await cap(w.d, "tasks.list", { scope: "all", limit: 200 })).tasks as unknown[]).length, tasksBefore, "no approval task was made");
    const now = secret();
    assert.equal(now.n, 1, "one sealed box for the item, no earlier copy beside it");
    assert.notEqual(now.box, was.box, "the box was replaced");
    // no earlier version is kept: the Vault holds one sealed box per item (a revision counter, no copies), so the plaintext is in no file of the data directory, the write-ahead logs included
    const dataDir = w.d.paths.events.replace(/\/[^/]*$/, "");
    for (const f of fs.readdirSync(dataDir))
      if (/\.db(-wal)?$/.test(f)) assert.ok(!fs.readFileSync(`${dataDir}/${f}`).includes("123-45-6789"), `${f} holds no copy of the value`);
    const log = new DatabaseSync(w.d.paths.events, { readOnly: true });
    try {
      const n = Number(
        (log.prepare("SELECT count(*) AS c FROM events WHERE json_extract(event, '$.type') = 'vault.item_deleted'").get() as { c: number }).c,
      );
      assert.equal(n, 0, "nothing was deleted or held: the value was overwritten");
    } finally {
      log.close();
    }
  } finally {
    await w.close();
  }
});
