// A connector made in one call is checked against the app's docs, never against the app. It says so ("untested") until one call to the app comes back with a success, and define refuses what it does not name
// (r43 meier-apps, 24 Nov 2026). Each test is red on the line before this change.
import test from "node:test";
import assert from "node:assert/strict";
import { kit } from "../fixtures/kit.ts";
import type { Kit } from "../fixtures/kit.ts";
import { untestedLine } from "../projections.ts";

const msg = (e: unknown): string => JSON.stringify(e);
const BASE = {
  domains: ["api.shop.test"],
  auth: { type: "bearer" as const, secret: "Shop_Key" },
  secrets: [{ name: "Shop_Key", description: "Shop key" }],
};
const ACTIONS = [{ name: "list", url: "https://api.shop.test/items" }];

async function define(k: Kit, key: string, extra: Record<string, unknown> = {}) {
  await k.hs["connectors.init"](k.ctx, { key, title: "Shop", mode: "api", source: false } as never);
  return k.hs["connectors.define"](k.ctx, { key, ...BASE, actions: ACTIONS, ...extra } as never);
}

test("a published connector no call has answered is untested: the publish says so in plain words, and list and get carry it", async () => {
  const k = kit();
  await define(k, "shop");
  const out = (await k.hs["connectors.publish"](k.ctx, { key: "shop" })) as unknown as Record<string, unknown>;
  assert.equal(out["published"], true);
  assert.equal(out["untested"], true);
  assert.equal(out["message"], untestedLine("Shop"));
  assert.match(String(out["message"]), /^Not tried yet\./);
  assert.equal((await k.hs["connectors.get"](k.ctx, { key: "shop" })).connector.untested, true);
  const listed = await k.hs["connectors.list"](k.ctx, {} as never);
  assert.equal(listed.connectors.find((c) => c.key === "shop")?.untested, true);
});

test("a built-in connector and a draft are never called untested", async () => {
  const k = kit();
  const listed = await k.hs["connectors.list"](k.ctx, {} as never);
  assert.ok(listed.connectors.some((c) => c.builtin));
  assert.equal(
    listed.connectors.filter((c) => c.builtin && c.untested !== undefined).length,
    0,
    "no built-in carries the flag",
  );
  await define(k, "draftonly");
  assert.equal((await k.hs["connectors.get"](k.ctx, { key: "draftonly" })).connector.untested, undefined);
});

test("one answered call clears it: the flag is gone from get and the next publish does not repeat it", async () => {
  const k = kit();
  k.vault["#ShopKey"] = "shop-key-value-1";
  await define(k, "shop");
  await k.hs["connectors.publish"](k.ctx, { key: "shop" });
  const conn = await k.hs["connections.create"](k.ctx, {
    connector: "shop",
    title: "Shop",
    ownerKind: "space",
    secrets: { Shop_Key: "#ShopKey" },
  } as never);
  k.state.reply = () => ({ status: 200, body: { items: [] } });
  await k.hs["connectors.run"](k.ctx, {
    key: "shop",
    action: "list",
    connectionId: conn.connection.connectionId,
    input: {},
  } as never);
  assert.equal((await k.hs["connectors.get"](k.ctx, { key: "shop" })).connector.untested, undefined);
});

test("a call the app refused does not clear it", async () => {
  const k = kit();
  k.vault["#ShopKey"] = "shop-key-value-1";
  await define(k, "shop");
  await k.hs["connectors.publish"](k.ctx, { key: "shop" });
  const conn = await k.hs["connections.create"](k.ctx, {
    connector: "shop",
    title: "Shop",
    ownerKind: "space",
    secrets: { Shop_Key: "#ShopKey" },
  } as never);
  k.state.reply = () => ({ status: 500, body: {} });
  await k.hs["connectors.run"](
    k.ctx,
    { key: "shop", action: "list", connectionId: conn.connection.connectionId, input: {} } as never,
  ).catch(() => undefined);
  assert.equal((await k.hs["connectors.get"](k.ctx, { key: "shop" })).connector.untested, true);
});

test("define refuses a key the contract does not name instead of storing it", async () => {
  const k = kit();
  await k.hs["connectors.init"](k.ctx, { key: "shop", title: "Shop", mode: "api", source: false } as never);
  const def = (o: Record<string, unknown>) =>
    k.hs["connectors.define"](k.ctx, { key: "shop", ...BASE, actions: ACTIONS, ...o } as never);
  await assert.rejects(
    def({ actions: [{ name: "add", method: "POST", write: true, url: "https://api.shop.test/x", bdoy: { a: 1 } }] }),
    (e) => /bdoy/.test(msg(e)),
    "a misspelt body",
  );
  await assert.rejects(def({ auth: { ...BASE.auth, scheme: "x" } }), (e) => /scheme/.test(msg(e)));
  await assert.rejects(def({ colour: "red" }), (e) => /colour/.test(msg(e)));
  await def({}); // the plain definition still goes in
});

test("a dry run of a defined body shows the body that would be sent, with the secret hidden", async () => {
  const k = kit();
  k.vault["#ShopKey"] = "shop-key-value-1";
  await define(k, "shop", {
    actions: [
      {
        name: "add",
        method: "POST",
        write: true,
        url: "https://api.shop.test/items",
        body: { name: "{input.name}", by: "{secret.Shop_Key}" },
      },
    ],
  });
  await k.hs["connectors.publish"](k.ctx, { key: "shop" });
  const conn = await k.hs["connections.create"](k.ctx, {
    connector: "shop",
    title: "Shop",
    ownerKind: "space",
    secrets: { Shop_Key: "#ShopKey" },
  } as never);
  const out = await k.hs["connectors.run"](k.ctx, {
    key: "shop",
    action: "add",
    connectionId: conn.connection.connectionId,
    input: { name: "Mug" },
    dryRun: true,
  } as never);
  assert.equal(out.dryRun, true);
  assert.equal(k.sent.length, 0, "nothing was sent");
  const req = (out.output as { request: { body: { name: string; by: string } } }).request;
  assert.equal(req.body.name, "Mug");
  assert.ok(!JSON.stringify(out).includes("shop-key-value-1"), "the key is not in the answer");
});

test("the connect card's service lookup says untested, so the card can say it before a key is typed", async () => {
  const k = kit();
  await define(k, "shop");
  await k.hs["connectors.publish"](k.ctx, { key: "shop" });
  const got = (await k.hs["connectors.for_service"](k.ctx, { service: "Shop" } as never)) as unknown as {
    found: boolean;
    connector?: { untested?: boolean };
  };
  assert.equal(got.found, true);
  assert.equal(got.connector?.untested, true);
});
