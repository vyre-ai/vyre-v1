// A real sync pull on a booted daemon seals the secret from the firm's four places, and no byte the server wrote (every database with its WAL, every file, stdout, stderr) holds it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { call, hostLog, waitFor } from "./support/eco-live.ts";
import {
  APP_KEY,
  DASHED,
  DIGITS,
  SPACED,
  pulled,
  pump,
  rowsOf,
  scan,
  spec,
  world,
  dumpDb,
} from "./support/sync-live.ts";
test("a real pull seals the secret from all four places, and no byte the server wrote holds it", async () => {
  const w = await world(true);
  try {
    assert.equal(w.item.status, 200, JSON.stringify(w.item.data));
    const applied = await call(w.d, "sync_specs.apply", { spec: spec(), idempotencyKey: "apply-1" });
    assert.equal(applied.status, 200, JSON.stringify(applied.data));
    await pulled(w.d, ["person", "matter", "note"]);
    await waitFor(
      async () => {
        await pump(w.d);
        const p = (await rowsOf(w.d, "person")).find((x) => JSON.stringify(x).includes("Imran"));
        return (p?.fields["ssn"] as { present?: boolean } | undefined)?.present === true ? true : null;
      },
      100_000,
      () => hostLog(w.d),
    );
    const people = await rowsOf(w.d, "person");
    assert.equal(people.length, 2);
    const imran = people.find((p) => JSON.stringify(p).includes("Imran"))!;
    assert.deepEqual(
      [
        (imran.fields["ssn"] as { present?: boolean }).present,
        (imran.fields["custom_ssn"] as { present?: boolean }).present,
      ],
      [true, true],
      "both sealed fields hold a reference",
    );
    const got = await call(w.d, "records.get", { type: "person", recordId: imran.id });
    for (const form of [DASHED, DIGITS, SPACED])
      assert.ok(!JSON.stringify(got.data).includes(form), "records.get holds a reference only");
    // the connector's own outputs for any caller: the secret is masked
    const conn = (await call(w.d, "connectors.list", {})).data;
    assert.ok(!JSON.stringify(conn).includes(DASHED));
    await w.d.sink.flush?.();
    const hits = scan(w.dir, [DASHED, DIGITS, SPACED], w.printed());
    assert.deepEqual(hits, [], "while the daemon runs (databases and their WAL files)");
    for (const f of fs.readdirSync(w.dir).filter((x) => x.endsWith(".db"))) {
      const text = dumpDb(path.join(w.dir, f));
      for (const form of [DASHED, DIGITS]) assert.ok(!text.includes(form), `${f} holds ${form}`);
    }
  } finally {
    await w.close();
  }
  // and after it stopped (every WAL folded in)
});
