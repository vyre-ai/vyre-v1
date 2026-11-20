// The key check's accept mode is a test switch: only the test runner (scripts/test-run.ts, which loads scripts/lib/test-marker.mjs) turns it on. A production daemon that finds VYRE_TEST_KEY_CHECK=accept in its environment
// removes it, says so once, and still asks the real provider.
import test from "node:test";
import assert from "node:assert/strict";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { createProviderProbe } from "../src/seams/vault.ts";
import { ignoreTestSwitches, inTestRunner } from "../src/test-mode.ts";
import { boot, seededDirFrom } from "./daemon-boot-rig.ts";

const MARK = Symbol.for("vyre.test-runner");
const g = globalThis as Record<symbol, unknown>;
const ask = { providerKey: "anthropic", connection: "api_key", caller: "usr_x", apiKey: "sk-ant-made-up" };
const refusing = (() => Promise.resolve(new Response("{}", { status: 401 }))) as never;
const asProduction = async (f: () => Promise<void>): Promise<void> => {
  const was = g[MARK],
    env = process.env["VYRE_TEST_KEY_CHECK"];
  delete g[MARK];
  process.env["VYRE_TEST_KEY_CHECK"] = "accept";
  try {
    await f();
  } finally {
    if (was !== undefined) g[MARK] = was;
    if (env === undefined) delete process.env["VYRE_TEST_KEY_CHECK"];
    else process.env["VYRE_TEST_KEY_CHECK"] = env;
  }
};

test("outside the test runner the accept variable is removed once and a made-up key is refused by the provider", async () => {
  await asProduction(async () => {
    assert.equal(inTestRunner(), false);
    const lines: string[] = [];
    assert.deepEqual(
      ignoreTestSwitches((l) => lines.push(l)),
      ["VYRE_TEST_KEY_CHECK"],
    );
    assert.equal(lines.length, 1);
    assert.equal(process.env["VYRE_TEST_KEY_CHECK"], undefined);
    assert.deepEqual(
      ignoreTestSwitches((l) => lines.push(l)),
      [],
      "said once",
    );
    // even with the variable put back, the probe does not accept without the marker
    process.env["VYRE_TEST_KEY_CHECK"] = "accept";
    const r = await createProviderProbe({ fetch: refusing })(ask);
    assert.equal(r.ok, false);
    assert.equal(r.refused, true);
  });
});

test("a booted daemon outside the test runner removes the accept variable at start", async () => {
  const dir = seededDirFrom(bootCore)();
  await asProduction(async () => {
    const d = await boot(dir);
    try {
      assert.equal(process.env["VYRE_TEST_KEY_CHECK"], undefined);
    } finally {
      await d.stop();
    }
  });
});

test("inside the runner the marker is set and accept mode accepts a fixture key", async () => {
  if (!inTestRunner()) return; // started with raw node --test: nothing to check
  assert.equal(process.env["VYRE_TEST_KEY_CHECK"], "accept");
  assert.equal((await createProviderProbe()(ask)).ok, true);
});
