// P-L3_REC3: connectors.get and connectors.list carry the per-object action names a connector spec declares (P-CC_19). The sync engine reads the map from the connector row, so a row
// with an override must return it exactly, and a row without one must not invent it.
import test from "node:test";
import assert from "node:assert/strict";
import { ACME } from "../fixtures/acme.ts";
import { kit } from "../fixtures/kit.ts";
import { objectsOf } from "../handlers/get.ts";
import type { ConnectorDef } from "../projections.ts";

const OVERRIDE: ConnectorDef = {
  ...ACME, key: "oddapp", title: "Odd app",
  objects: { contact: { list: "find_all", listAfter: "find_more", create: "add_one", update: "change_one", delete: "remove_one" }, deal: { list: "all_deals" } },
};

test("objects: connectors.get returns the objects map of a stored connector row, keys and names intact", async () => {
  const k = kit();
  k.install(OVERRIDE);
  const { connector } = await k.hs["connectors.get"](k.ctx, { key: "oddapp" });
  assert.deepEqual(connector.objects, {
    contact: { list: "find_all", listAfter: "find_more", create: "add_one", update: "change_one", delete: "remove_one" },
    deal: { list: "all_deals" },
  });
});

test("objects: connectors.list carries the same map as connectors.get", async () => {
  const k = kit();
  k.install(OVERRIDE);
  const listed = await k.hs["connectors.list"](k.ctx, {});
  assert.deepEqual(listed.connectors.find((c) => c.key === "oddapp")?.objects?.["deal"], { list: "all_deals" });
});

test("objects: a connector without an override has no objects key, so the convention applies", async () => {
  const k = kit();
  k.install(ACME);
  const { connector } = await k.hs["connectors.get"](k.ctx, { key: ACME.key });
  assert.equal("objects" in connector, false);
});

test("objects: only the five known action keys with real names survive; empty and unknown entries drop", () => {
  const def = { objects: { contact: { list: "find_all", bogus: "x", create: "" }, empty: {}, junk: 5 } } as unknown as Pick<ConnectorDef, "objects">;
  assert.deepEqual(objectsOf(def), { contact: { list: "find_all" } });
  assert.equal(objectsOf({}), undefined);
  assert.equal(objectsOf({ objects: {} }), undefined);
});

test("objects: a draft row carries its objects map too", async () => {
  const k = kit();
  k.install({ ...OVERRIDE }, "draft");
  const { connector } = await k.hs["connectors.get"](k.ctx, { key: "oddapp" });
  assert.equal(connector.state, "draft");
  assert.deepEqual(connector.objects?.["contact"]?.["create"], "add_one");
});
