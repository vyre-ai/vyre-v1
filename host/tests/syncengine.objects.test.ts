// The connector's object names are read again when the first read failed and when a minute has passed (rc.26: a read that failed once kept the default names until the server restarted).
import test from "node:test";
import assert from "node:assert/strict";
import { objectNamesOf } from "../src/daemon/syncengine.ts";

test("a failed read of the connector is not kept, and a good one is read again after a minute", async () => {
  let t = 1_000;
  let reads = 0;
  let broken = true;
  const names = objectNamesOf(() => t);
  const ctx = {
    call: async (): Promise<unknown> => {
      reads++;
      if (broken) throw new Error("the connector was not there yet");
      return { connector: { objects: { deals: { list: "list_deals_v" + reads } } } };
    },
  };
  assert.equal(await names(ctx as never, "crm"), undefined);
  broken = false;
  assert.deepEqual(await names(ctx as never, "crm"), { deals: { list: "list_deals_v2" } }, "tried again at once");
  assert.equal(reads, 2);
  await names(ctx as never, "crm");
  assert.equal(reads, 2, "a good answer is kept");
  t += 61_000;
  assert.deepEqual(await names(ctx as never, "crm"), { deals: { list: "list_deals_v3" } }, "read again after a minute");
});
