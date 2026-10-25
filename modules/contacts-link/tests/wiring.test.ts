// The module entry: one handler for each capability the manifest declares, running through the host handler signature. The module stays `stub`
// in manifests/contacts-link.ts until P-CI_02 makes the flip a one-line edit of host/modules.json (ruling 25).
import test from "node:test";
import assert from "node:assert/strict";
import { handlers, projections } from "../impl.ts";
import { registry } from "../../../generated/registry.ts";
import { harness } from "../fixtures/harness.ts";

test("the handler map covers exactly the capabilities of the manifest", () => {
  const declared = registry.capabilities.filter((c) => c.module === "contacts-link").map((c) => c.name).sort();
  assert.equal(declared.length, 18);
  assert.deepEqual(Object.keys(handlers).sort(), declared);
  assert.deepEqual(Object.keys(projections), ["inline", "consumers"]);
});

test("a handler runs through the host signature", async () => {
  const h = harness();
  h.contact("rec_pat01", { name: "Pat Lee", email: "pat@x.test" });
  const asHost = h.ctx as unknown as Parameters<(typeof handlers)[string]>[0];
  const found = (await handlers["contacts.resolve"]!(asHost, { email: "pat@x.test" })) as { sure: { recordId: string }[] };
  assert.deepEqual(found.sure.map((c) => c.recordId), ["rec_pat01"]);
  const added = (await handlers["contacts.suppression.add"]!(asHost, { channel: "email", addresses: ["pat@x.test"], reason: "manual" })) as { added: number };
  assert.equal(added.added, 1);
  assert.deepEqual(await handlers["contacts.suppression.check"]!(asHost, { channel: "email", addresses: ["pat@x.test"] }), { suppressed: [{ address: "pat@x.test", reason: "manual" }] });
});
