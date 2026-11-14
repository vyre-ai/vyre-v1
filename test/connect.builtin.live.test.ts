// A booted daemon's connector list with the connect card off (the default, rc.28) is the registry's built-ins, as on rc.27: no Fathom. With it on, Fathom is there. The switch is read when the Space seeds.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { boot, connect, ok, scriptedModel, seededDir, stop } from "./support/eco-live.ts";

const registry = (): string[] =>
  (
    JSON.parse(readFileSync(new URL("../generated/registry.json", import.meta.url), "utf8")) as {
      connectors: { key: string }[];
    }
  ).connectors
    .map((c) => c.key)
    .sort();

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
    return all.sort();
  } finally {
    await stop(d);
  }
};

test("off: the connector list equals rc.27's built-ins, with no Fathom", async () => {
  delete process.env["VYRE_CONNECT_CARD"];
  assert.deepEqual(await listed(), registry());
});

test("on: Fathom is built in as well", async () => {
  process.env["VYRE_CONNECT_CARD"] = "1";
  try {
    assert.deepEqual(await listed(), [...registry(), "fathom"].sort());
  } finally {
    delete process.env["VYRE_CONNECT_CARD"];
  }
});
