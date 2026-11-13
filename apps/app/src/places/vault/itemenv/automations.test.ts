import test from "node:test";
import assert from "node:assert/strict";
import {
  appNameOf,
  connectorOpening,
  gateFor,
  offersAutomations,
  readyToBuild,
  setupOffered,
  usedByOf,
} from "./automations.ts";

test("keys, env blocks, logins and loose items offer Add to Automations; cards, notes, codes, SSH keys and AI accounts do not", () => {
  for (const k of ["api_key", "env", "login", "other"] as const) assert.equal(offersAutomations(k), true, k);
  for (const k of ["card", "note", "totp", "ssh_key", "ai_subscription"] as const)
    assert.equal(offersAutomations(k), false, k);
});

test("the opening message names the app and the handle and never a value", () => {
  assert.equal(
    connectorOpening({ name: "  Lawmatics  ", handle: "#Dana_Lawmatics" }),
    "Add Lawmatics to Automations. Vault handle #Dana_Lawmatics. Load the connector-builder skill. Never ask for the key.",
  );
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
  assert.deepEqual(gateFor({ online: true, yourLevel: "use", accounts: [{ state: "needs_sign_in" }] }), {
    state: "ai_signin",
  });
  assert.deepEqual(gateFor({ online: true, yourLevel: "use", accounts: ok }), { state: "ready" });
  assert.deepEqual(gateFor({ online: true, yourLevel: "use", accounts: null }), { state: "ready" });
});

test("usage rows come out of the reply and a bad reply is no rows", () => {
  const rows = usedByOf({
    uses: [
      {
        handle: "#A",
        automations: [
          { automationId: "aut_1", name: "Sync", status: "on", steps: [{ nodeId: "n1", title: "Read" }, { bad: 1 }] },
          { nope: true },
        ],
      },
    ],
  });
  assert.deepEqual(rows, [
    { automationId: "aut_1", name: "Sync", status: "on", steps: [{ nodeId: "n1", title: "Read" }] },
  ]);
  assert.deepEqual(usedByOf(null), []);
  assert.deepEqual(usedByOf({ uses: "x" }), []);
});

test("without the builder permission an admin allows it in one tap and anyone else asks an admin, once", () => {
  const base = { online: true, yourLevel: "use", accounts: [{ state: "ok" }] };
  assert.deepEqual(gateFor({ ...base, builder: { allowed: true, canGrant: false } }), { state: "ready" });
  assert.deepEqual(gateFor({ ...base, builder: { allowed: false, canGrant: true } }), { state: "no_builder" });
  assert.deepEqual(gateFor({ ...base, builder: { allowed: false, canGrant: false } }), { state: "ask_admin" });
  assert.deepEqual(gateFor({ ...base, builder: { allowed: false, canGrant: false }, asked: true }), { state: "asked" });
  assert.deepEqual(gateFor({ ...base, builder: null }), { state: "ready" });
  assert.deepEqual(
    gateFor({ ...base, accounts: [], builder: { allowed: false, canGrant: true } }),
    { state: "no_ai" },
    "an AI account comes first",
  );
});

test("the app name drops a trailing key word: Notely API key is Notely", () => {
  assert.equal(appNameOf("Notely API key"), "Notely");
  assert.equal(appNameOf("OpenCode Go key"), "OpenCode Go");
  assert.equal(appNameOf("Acme access token"), "Acme");
  assert.equal(appNameOf("Stripe webhooks"), "Stripe webhooks");
  assert.equal(appNameOf("API key"), "API key", "a name that is only the key word stays");
});

test("readyToBuild: the assistant must reach the item and hold the builder role, which a person who may give it gives with the press", async () => {
  const run = async (st: unknown): Promise<{ error: string | null; calls: string[] }> => {
    const calls: string[] = [];
    try {
      await readyToBuild(
        async (cap) => (calls.push(cap), cap === "access.connector_builder.status" ? st : {}),
        "agt_a",
        "vit_x",
      );
      return { error: null, calls };
    } catch (e) {
      return { error: (e as Error).message, calls };
    }
  };
  assert.deepEqual(await run({ allowed: true, canGrant: false, reaches: true }), {
    error: null,
    calls: ["access.connector_builder.status"],
  });
  assert.deepEqual(await run({ allowed: false, canGrant: true, reaches: true }), {
    error: null,
    calls: ["access.connector_builder.status", "access.connector_builder.grant"],
  });
  assert.match(
    (await run({ allowed: true, canGrant: true, reaches: false })).error ?? "",
    /cannot open that Vault item/,
  );
  const no = await run({ allowed: false, canGrant: false, reaches: true });
  assert.match(no.error ?? "", /needs permission to build connectors/);
  assert.deepEqual(
    no.calls,
    ["access.connector_builder.status"],
    "nothing is granted for a person who may not give it",
  );
});

test("setupOffered: no setup is offered that an assistant cannot finish: a company key, an AI account's key, an item above its clearance", () => {
  const base = { kind: "api_key" as const, handle: "#Acme", aiKey: false };
  assert.equal(setupOffered(base), true);
  assert.equal(setupOffered({ ...base, reaches: true }), true);
  assert.equal(setupOffered({ ...base, reaches: false }), false, "above the assistant's clearance");
  for (const handle of ["#Google_DWD", "#Microsoft_App", "#SSO_Okta", "#Google_DWD.key"])
    assert.equal(setupOffered({ ...base, handle }), false, handle);
  assert.equal(setupOffered({ ...base, aiKey: true }), false);
  assert.equal(setupOffered({ ...base, aiKey: null }), false, "not known yet");
  assert.equal(setupOffered({ ...base, kind: "card" }), false);
});
