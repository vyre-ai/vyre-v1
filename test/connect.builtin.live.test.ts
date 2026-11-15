// A booted daemon's connector list with the connect card off (the default, rc.28) is the registry's built-ins, as on rc.27: no Fathom. With it on, Fathom is there. The switch is read when the Space seeds.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { boot, call, connect, ok, scriptedModel, seededDir, stop } from "./support/eco-live.ts";

const registry = (): string[] =>
  (
    JSON.parse(readFileSync(new URL("../generated/registry.json", import.meta.url), "utf8")) as {
      connectors: { key: string }[];
    }
  ).connectors
    .map((c) => c.key)
    .sort();

const seen: { steps: string; connections: string; get: number; forService: number; forServiceBody: string } = {
  steps: "",
  connections: "",
  get: 0,
  forService: 0,
  forServiceBody: "",
};
const listed = async (): Promise<string[]> => {
  const d = await boot(
    seededDir(),
    scriptedModel(async function* () {}),
    { vault: undefined },
  );
  try {
    await connect(d);
    const all: string[] = [];
    let next: string | undefined;
    do {
      const r = await ok(d, "connectors.list", next ? { limit: 200, cursor: next } : { limit: 200 });
      all.push(...(r.connectors as { key: string }[]).map((c) => c.key));
      next = r.next as string | undefined;
    } while (next);
    // the other places a person meets a connector: the step picker, the connections flow, the connector's own page, and the connect card's lookup
    seen.steps = JSON.stringify(await ok(d, "automations.steps.list", {}));
    seen.connections = JSON.stringify(await ok(d, "connections.list", {}));
    seen.get = (await call(d, "connectors.get", { key: "fathom" })).status;
    const fs = await call(d, "connectors.for_service", { service: "Fathom" });
    seen.forService = fs.status;
    seen.forServiceBody = JSON.stringify(fs.data);
    return all.sort();
  } finally {
    await stop(d);
  }
};

test("off: the connector list equals rc.27's built-ins, with no Fathom", async () => {
  process.env["VYRE_CONNECT_CARD"] = "0";
  assert.deepEqual(await listed(), registry());
  assert.ok(!/fathom/i.test(seen.steps), "the step picker has no Fathom");
  assert.ok(!/fathom/i.test(seen.connections), "the connections flow has no Fathom");
  assert.notEqual(seen.get, 200, "no fathom connector or resource exists");
  assert.notEqual(seen.forService, 200, "connectors.for_service refuses");
  assert.ok(seen.forServiceBody.includes("Connecting a service this way is not available yet."), seen.forServiceBody);
});

test("on (VYRE_CONNECT_CARD=1): Fathom is built in as well", async () => {
  process.env["VYRE_CONNECT_CARD"] = "1";
  try {
    assert.deepEqual(await listed(), [...registry(), "fathom"].sort());
    assert.equal(seen.get, 200, "Fathom has its connector page");
    assert.equal(seen.forService, 200);
  } finally {
    delete process.env["VYRE_CONNECT_CARD"];
  }
});
