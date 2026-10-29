// The Chrome link's lists are held to the two things they must agree with: the extension's own list of what it calls, and the manifest's idempotency rule.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vault from "../../manifests/vault.ts";
import { EXTENSION_CAPABILITIES, KEYED, createChromeLink } from "../src/daemon/chrome-link.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

test("the daemon answers exactly the capabilities the extension may call", () => {
  const protocol = fs.readFileSync(path.join(here, "../../apps/chrome/src/worker/protocol.js"), "utf8");
  const block = protocol.slice(protocol.indexOf("export const CAPABILITIES"), protocol.indexOf("export const BRIDGE_OPS"));
  const theirs = [...block.matchAll(/^\s*"([a-z_.]+)":/gm)].map((m) => m[1]!).sort();
  assert.deepEqual([...EXTENSION_CAPABILITIES].sort(), theirs);
});

test("every capability the extension calls that needs an idempotency key gets one from the link, and no other does", () => {
  const caps = (vault as unknown as { capabilities: { name: string; idempotency: string }[] }).capabilities;
  for (const name of EXTENSION_CAPABILITIES) {
    const def = caps.find((c) => c.name === name);
    assert.ok(def, `${name} is a vault capability`);
    assert.equal(KEYED.includes(name), def.idempotency === "key", `${name}: ${def.idempotency}`);
  }
});

test("without a hosted Space the link says so, and with one it refuses an agent, another Space and anything off the list before touching the pipeline", async () => {
  let calls = 0;
  const base = { version: "1", person: () => "usr_a", unlocked: () => true, push: () => 0, optedIn: { read: () => [], write: () => {} }, announce: () => {}, callTool: () => Promise.resolve({}) };
  const none = createChromeLink({ ...base, space: () => null });
  await assert.rejects(() => none.invoke("vault.items.match", {}, {}), (e: { code?: string }) => e.code === "not_available");
  assert.deepEqual(await none.op("hello", {}), { version: "1", spaces: [], active: null, locked: false });
  const some = createChromeLink({ ...base, space: () => ({ id: "spc_a", name: "A", webUrl: "http://127.0.0.1:1" }) });
  some.bind((async () => { calls++; return { status: "ok", output: {}, traceId: "t" }; }) as never);
  for (const [cap, extra, code] of [["access.share", {}, "not_allowed"], ["vault.items.match", { agent: "agt_x" }, "not_allowed"], ["vault.items.match", { space: "spc_b" }, "not_available"]] as const) {
    await assert.rejects(() => some.invoke(cap, {}, extra), (e: { code?: string }) => e.code === code, cap);
  }
  assert.equal(calls, 0);
  await some.invoke("vault.items.match", { url: "https://x.test" }, {});
  assert.equal(calls, 1);
});
