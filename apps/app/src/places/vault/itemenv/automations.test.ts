import test from "node:test";
import assert from "node:assert/strict";
import { appNameOf, connectorOpening, gateFor, offersAutomations, usedByOf } from "./automations.ts";

test("keys, env blocks, logins and loose items offer Add to Automations; cards, notes, codes, SSH keys and AI accounts do not", () => {
  for (const k of ["api_key", "env", "login", "other"] as const) assert.equal(offersAutomations(k), true, k);
  for (const k of ["card", "note", "totp", "ssh_key", "ai_subscription"] as const) assert.equal(offersAutomations(k), false, k);
});

test("the opening message names the app and the handle and never a value", () => {
  assert.equal(connectorOpening({ name: "  Lawmatics  ", handle: "#Dana_Lawmatics" }), "Add Lawmatics to Automations. Vault handle #Dana_Lawmatics. Load the connector-builder skill. Never ask for the key.");
  const leaked = connectorOpening({ name: "sk_live_ABCDEF123456", handle: "#X" });
  assert.equal(leaked.includes("sk_live"), false);
  assert.match(leaked, /this app/);
  assert.equal(appNameOf("sk_ live_ABCDEF123456"), "this app");
  assert.equal(appNameOf(""), "this app");
});

test("the gate names the worst blocker first and is ready otherwise", () => {
  const ok = [{ state: "ok" }];
  assert.deepEqual(gateFor({ online: false, yourLevel: "manage", accounts: ok }), { state: "offline" });
  assert.deepEqual(gateFor({ online: true, yourLevel: "view", accounts: ok }), { state: "no_use" });
  assert.deepEqual(gateFor({ online: true, yourLevel: "use", accounts: [] }), { state: "no_ai" });
  assert.deepEqual(gateFor({ online: true, yourLevel: "use", accounts: [{ state: "needs_sign_in" }] }), { state: "ai_signin" });
  assert.deepEqual(gateFor({ online: true, yourLevel: "use", accounts: ok }), { state: "ready" });
  assert.deepEqual(gateFor({ online: true, yourLevel: "use", accounts: null }), { state: "ready" });
});

test("usage rows come out of the reply and a bad reply is no rows", () => {
  const rows = usedByOf({ uses: [{ handle: "#A", automations: [{ automationId: "aut_1", name: "Sync", status: "on", steps: [{ nodeId: "n1", title: "Read" }, { bad: 1 }] }, { nope: true }] }] });
  assert.deepEqual(rows, [{ automationId: "aut_1", name: "Sync", status: "on", steps: [{ nodeId: "n1", title: "Read" }] }]);
  assert.deepEqual(usedByOf(null), []);
  assert.deepEqual(usedByOf({ uses: "x" }), []);
});
