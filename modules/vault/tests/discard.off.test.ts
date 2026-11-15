// vault.item.discard_new is part of the connect card, which is OFF by default (lib/connect-switch.ts, rc.28; review r-keyreach-9-b-connect, item C). With the switch off it refuses for every caller before it reads
// anything: the context is a trap that fails the test on any use but the trace id. This file never turns the switch on; it sets it to 0.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { CONNECT_OFF_CODE, CONNECT_OFF_MESSAGE } from "../../../lib/connect-switch.ts";

// the switch is on by default from rc.29; this file tests it OFF, so it turns it off for itself (VYRE_CONNECT_CARD=0)
process.env["VYRE_CONNECT_CARD"] = "0";

const trap = () => {
  const touched: string[] = [];
  const ctx = new Proxy({ trace: { traceId: "0123456789abcdef0123456789abcdef" } } as Record<string, unknown>, {
    get(t, k) {
      if (k === "trace") return t["trace"];
      touched.push(String(k));
      return undefined;
    },
  });
  return { ctx: ctx as never, touched };
};

for (const who of ["a person", "an agent", "an agent acting for a person", "a guest"])
  test(`vault.item.discard_new refuses ${who} with the one plain message and touches nothing`, async () => {
    const t = trap();
    await assert.rejects(
      async () => handlers["vault.item.discard_new"]!(t.ctx, { itemId: "vit_x" } as never),
      (e: { error?: { code?: string; message?: string } }) => {
        assert.equal(e.error?.code, CONNECT_OFF_CODE);
        assert.equal(e.error?.message, CONNECT_OFF_MESSAGE);
        return true;
      },
    );
    assert.deepEqual(t.touched, [], "nothing was read, written or emitted");
  });
