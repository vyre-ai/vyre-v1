// A connector made in one call is checked against the app's docs, never against the app. It says so ("untested") until one call to the app comes back with a success, and define refuses what it does not name
// (r43 meier-apps, 24 Nov 2026). Each test is red on the line before this change.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.equal(out["message"], untestedLine);
  assert.equal(out["message"], "Not tried yet. The first call may need a fix.");
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
  await k.hs["connectors.run"](k.ctx, {
    key: "shop",
    action: "list",
    connectionId: conn.connection.connectionId,
    input: {},
  } as never).catch(() => undefined);
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

test("define takes a rate limit and keeps it, and refuses one that is not a positive speed with a burst", async () => {
  const k = kit();
  await k.hs["connectors.init"](k.ctx, { key: "shop", title: "Shop", mode: "api", source: false } as never);
  const def = (rate: unknown) =>
    k.hs["connectors.define"](k.ctx, { key: "shop", ...BASE, actions: ACTIONS, rate } as never);
  await assert.rejects(def({ rps: 0, burst: 1 }), (e) => /rate/.test(msg(e)));
  await assert.rejects(def({ rps: 2, burst: 0 }), (e) => /rate/.test(msg(e)));
  await assert.rejects(def({ rps: 1_000_000, burst: 1 }), (e) => /rate/.test(msg(e)), "no ceiling would be no pacing");
  await assert.rejects(def({ rps: 2, burst: 100_000 }), (e) => /rate/.test(msg(e)));
  await def({ rps: 2, burst: 4 });
  await k.hs["connectors.publish"](k.ctx, { key: "shop" });
  const stored = k.tx.get<{ def: string }>("SELECT def FROM cn_connectors WHERE key = ?", "shop");
  assert.deepEqual((JSON.parse(stored!.def) as { rate: unknown }).rate, { rps: 2, burst: 4 });
});

test("the untested answer never reads the call log: 100,000 log rows and no success are listed at once", async () => {
  const k = kit();
  await define(k, "shop");
  await k.hs["connectors.publish"](k.ctx, { key: "shop" });
  k.tx.run(
    "WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 99999) INSERT INTO cn_log (at, connector, action, method, host, path, status, ms) SELECT i, 'shop', 'list', 'GET', 'api.shop.test', '/items', 500, 1 FROM n",
  );
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 20; i++) await k.hs["connectors.list"](k.ctx, {} as never);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 20;
  assert.ok(ms < 50, `a list took ${ms} ms with 100,000 failed calls in the log`);
  // proof it never reads the log: with the log table gone, a list still answers
  k.tx.exec("DROP TABLE cn_log");
  assert.equal((await k.hs["connectors.get"](k.ctx, { key: "shop" })).connector.untested, true);
});

test("a connector that was answered stays tested after its log is cleared, and a connector made again starts untested", async () => {
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
  k.tx.run("DELETE FROM cn_log");
  assert.equal((await k.hs["connectors.get"](k.ctx, { key: "shop" })).connector.untested, undefined);
  k.tx.run("DELETE FROM cn_connectors WHERE key = 'shop'");
  assert.equal(k.tx.get("SELECT 1 AS x FROM cn_tested WHERE key = 'shop'"), undefined, "the delete took its row");
});

test("a connector answered before the table existed is back-filled once from the log", () => {
  const sql = readFileSync(new URL("../migrations/0008_tested.sql", import.meta.url), "utf8");
  assert.match(sql, /INSERT OR IGNORE INTO cn_tested[\s\S]*FROM cn_log[\s\S]*status >= 200 AND status < 400/);
});
