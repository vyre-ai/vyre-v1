// The Space the firm's is tonight (nobody signed in, the Vault never unlocked): what the real Vault does with a sealed value in a pull, what the Sync page says, and when the value is filled.
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
test("the Space the firm's is tonight: the Vault never unlocked. What the real Vault does with a sealed write", async () => {
  const w = await world(false);
  const outcome: Record<string, unknown> = { folder: w.folder.status, item: w.item.status };
  try {
    if (w.item.status !== 200) {
      outcome["note"] = `the shared Vault refused the app's key: ${JSON.stringify(w.item.data).slice(0, 200)}`;
      console.log(`UNCLAIMED-SPACE ${JSON.stringify(outcome)}`);
      return;
    }
    const applied = await call(w.d, "sync_specs.apply", { spec: spec("people"), idempotencyKey: "apply-2" });
    outcome["apply"] = applied.status;
    assert.equal(applied.status, 200, JSON.stringify(applied.data));
    await pulled(w.d, ["person"]);
    // the pass ends with the record sealed, or with the count of values waiting for the Vault: wait for whichever it is
    const settled = await waitFor(
      async () => {
        await pump(w.d);
        const p = (await rowsOf(w.d, "person")).find((x) => JSON.stringify(x).includes("Imran"));
        const st = (await call(w.d, "sync_types.status", { type: "person" })).data;
        return p && ((p.fields["ssn"] as { present?: boolean } | undefined)?.present === true || st.sealedWaiting)
          ? { p, st }
          : null;
      },
      115_000,
      () => hostLog(w.d),
    );
    const imran = settled.p;
    const status = settled.st;
    outcome["ssnField"] = imran.fields["ssn"] ?? null;
    outcome["status"] = { state: status.state, sealedWaiting: status.sealedWaiting ?? null };
    outcome["firstWhy"] = (
      (await call(w.d, "sync_types.log", { type: "person" })).data.entries as Array<{ kind: string; summary: string }>
    )
      .filter((e) => e.kind === "error")
      .map((e) => e.summary);
    assert.deepEqual(
      scan(w.dir, [DASHED, DIGITS, SPACED], w.printed()),
      [],
      "whatever the Vault does, nothing plain is stored",
    );
    // does the Vault seal with nobody signed in and no unlock, once the record can be seen? (the pass looks again after 10 seconds)
    const filledAlone = await waitFor(async () => {
      await pump(w.d);
      const p = (await rowsOf(w.d, "person")).find((x) => JSON.stringify(x).includes("Imran"));
      return (p?.fields["ssn"] as { present?: boolean } | undefined)?.present === true ? { yes: true } : null;
    }, 50_000).catch(() => ({ yes: false }));
    outcome["sealedWithoutUnlock"] = filledAlone.yes;
    if (!filledAlone.yes) {
      assert.ok(
        (await call(w.d, "sync_types.status", { type: "person" })).data.sealedWaiting,
        "still waiting, and it says so",
      );
      const r = await fetch(`${w.d.url}/local/vault/key/unlock`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${w.d.token}` },
        body: JSON.stringify({
          key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64"),
        }),
      });
      assert.equal(r.status, 204);
      await call(w.d, "connectors.sync_now", { type: "person", idempotencyKey: "again-1" });
      await waitFor(
        async () => {
          await pump(w.d);
          const p = (await rowsOf(w.d, "person")).find((x) => JSON.stringify(x).includes("Imran"));
          return (p?.fields["ssn"] as { present?: boolean } | undefined)?.present === true ? true : null;
        },
        115_000,
        () => hostLog(w.d),
      );
    }
    console.log(`UNCLAIMED-SPACE ${JSON.stringify(outcome)}`);
    assert.deepEqual(scan(w.dir, [DASHED, DIGITS, SPACED], w.printed()), []);
  } finally {
    await w.close();
  }
});
