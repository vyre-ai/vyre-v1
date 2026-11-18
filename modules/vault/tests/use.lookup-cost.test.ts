// A handle is looked up by asking for access only on the items that carry that handle or name, never on every item of the Vault (r38: the firm's server spent 5 s of a 90 s profile checking
// every item on each connector fill); the answers are the ones the full check gave, including after a grant is taken away.
// @reads /modules/vault/handlers/use.ts
// @reads /modules/vault/projections.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as v from "../handlers/index.ts";
import * as u from "../handlers/use.ts";
import { MAYA, ROB, harness, refusedWith } from "../fixtures/harness.ts";
import { LADDER, levelOn } from "../projections.ts";

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;
let seq = 0;
const key = (): string => `lc-${++seq}`;

test("a lookup by handle asks for access on a handful of items out of two hundred, and gives the answers it always gave, before and after a grant is removed", async () => {
  const h = harness();
  const folder = String(
    out(out(await v.foldersCreate(h.ctx, { name: "Shared", scope: "shared", idempotencyKey: key() })).folder).id,
  );
  const ids: string[] = [];
  for (let i = 0; i < 200; i++)
    ids.push(
      String(
        out(
          out(
            await v.itemPut(h.ctx, {
              folderId: folder,
              name: `Service ${i}`,
              kind: "api_key",
              fields: [{ key: "api_key", value: `k-${i}` }],
              idempotencyKey: key(),
            } as Parameters<typeof v.itemPut>[1]),
          ).item,
        ).id,
      ),
    );
  // Rob holds Use on item 7 only, and the grant can be taken back
  let robMay = true;
  const base = h.ctx.authorize.bind(h.ctx);
  let asked = 0;
  h.ctx.authorize = (action, resource) => {
    asked += 1;
    if (h.ctx.principal.id === ROB) {
      const ok = robMay && resource.id === ids[7] && LADDER.indexOf(action.level) <= LADDER.indexOf("use");
      return { effect: ok ? "allow" : "deny", reason: ok ? "granted" : "no_grant", decisionId: "dec_test" };
    }
    return base(action, resource);
  };
  h.actAs("person", ROB);
  asked = 0;
  assert.equal(out(await u.use(h.ctx, { item: "#Service_7" })).itemId, ids[7]);
  assert.ok(asked <= 12, `a handle lookup asked for access ${asked} times`);
  asked = 0;
  assert.equal(out(await u.use(h.ctx, { item: "service 7" })).itemId, ids[7], "a name finds it in any case");
  assert.ok(asked <= 12, `a name lookup asked for access ${asked} times`);
  assert.equal(
    await refusedWith(u.use(h.ctx, { item: "#Service_8" })),
    "validation.not_found",
    "an item Rob holds nothing on is not there for him",
  );
  robMay = false;
  assert.equal(
    await refusedWith(u.use(h.ctx, { item: "#Service_7" })),
    "validation.not_found",
    "after the grant is removed it is gone at once",
  );
  h.actAs("person", MAYA);
  h.cleanup();
});

test("the highest level held is found from the top and is the same as asking at every level", () => {
  const held = (top: string | null) =>
    ({
      authorize: (a: { level: string }) => ({
        effect: top !== null && LADDER.indexOf(a.level as never) <= LADDER.indexOf(top as never) ? "allow" : "deny",
      }),
    }) as never;
  for (const top of [null, ...LADDER]) assert.equal(levelOn(held(top), "vault_item", "vit_x"), top);
  // a gap in the ladder (edit held, view not): the highest allowed level is still the answer
  const gap = { authorize: (a: { level: string }) => ({ effect: a.level === "edit" ? "allow" : "deny" }) } as never;
  assert.equal(levelOn(gap, "vault_item", "vit_x"), "edit");
});
