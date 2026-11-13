// vault.use and vault.fill resolve a handle that names two items the same way every other reader does (secretPort.read, the host's resolver): the asker's own Mine item first, then a Shared
// one, never table order (lead 12 Nov, found by f-auto).
import test from "node:test";
import assert from "node:assert/strict";
import * as v from "../handlers/index.ts";
import * as u from "../handlers/use.ts";
import { MAYA, SECRET, harness } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;
let seq = 0;
const key = (): string => `r-${++seq}`;

test("a handle that names both a Shared item and the asker's own Mine item resolves to the Mine one, whichever was made first", async () => {
  const h = harness();
  try {
    h.actAs("person", MAYA);
    const shared = String(
      out(out(await v.foldersCreate(h.ctx, { name: "Team", scope: "shared", idempotencyKey: key() })).folder).id,
    );
    const mine = String(
      out(out(await v.foldersCreate(h.ctx, { name: "Mine", scope: "mine", idempotencyKey: key() })).folder).id,
    );
    const put = async (folderId: string): Promise<string> =>
      String(
        out(
          out(
            await v.itemPut(h.ctx, {
              folderId,
              name: "Bank",
              kind: "api_key",
              fields: [{ key: "api_key", value: SECRET }],
              idempotencyKey: key(),
            } as Parameters<typeof v.itemPut>[1]),
          ).item,
        ).id,
      );
    await put(shared); // made first, so first in table order
    const own = await put(mine);
    // two rows that carry one handle (a host save of a Mine item, a row from a peer): the Vault gives new items distinct handles, so the test makes the collision itself
    h.ctx.db.run(`UPDATE vault_meta SET "handle" = ? WHERE "id" = ?`, "#Bank", own);
    const used = out(await u.use(h.ctx, { item: "#Bank", purpose: "test" }));
    assert.equal(used.itemId, own, "Mine first for the asker");
  } finally {
    h.cleanup();
  }
});
