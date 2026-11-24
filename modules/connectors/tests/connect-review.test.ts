// THE REVIEW OF 9bdda3ef3 (r32-connect, 16 Nov 2026), each finding a test that was red first: secrets in an answer, a path that climbs, the seed upgrade both ways, and connections made before this release.
import test from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { loadBuiltins } from "../impl.ts";
import { kit } from "../fixtures/kit.ts";
import { executeAction } from "../handlers/runtime.ts";
import { seedBuiltins, withoutSecretValues } from "../projections.ts";
import { CODE_BUILTINS } from "../../../lib/builtin-connectors.ts";
import type { ConnectorDef } from "../projections.ts";

process.env["VYRE_CONNECT_CARD"] = "1";
const setup = async () => {
  const k = kit({ builtins: loadBuiltins() });
  await k.hs["connectors.for_service"](k.ctx, { service: "nothing" });
  return k;
};
const defOf = (k: Awaited<ReturnType<typeof setup>>, key: string) =>
  JSON.parse(k.tx.get<{ def: string }>("SELECT def FROM cn_connectors WHERE key = ?", key)!.def) as ConnectorDef;

test("1: Twilio's answer (an account with an auth_token) never leaves an action with the token, and no shipped action points at secrets", async () => {
  const k = await setup();
  k.state.reply = () => ({
    status: 200,
    body: { page_size: 1, accounts: [{ sid: "ACsub", auth_token: "PRIMARY_OR_SUBACCOUNT_TOKEN_9f3a" }] },
  });
  const r = await executeAction(k.deps, k.ctx, defOf(k, "twilio"), "check_account", {
    secrets: { Twilio_Account: "ACtyped0000", Twilio_Auth: "typedtoken_1234" },
    persist: false,
  });
  assert.ok(!JSON.stringify(r.output).includes("PRIMARY_OR_SUBACCOUNT_TOKEN_9f3a"));
  for (const d of CODE_BUILTINS as readonly unknown[] as ConnectorDef[])
    for (const a of d.actions)
      assert.ok(
        !/payment_intents|accounts$/.test(`${a.name} ${a.output ?? ""}`),
        `${d.key}.${a.name} points at no secret`,
      );
});

test("1: the guard, for every connector: secret-named keys, nested and in arrays, case and separator insensitive", () => {
  const out = withoutSecretValues({
    ok: 1,
    next_page_token: "keep",
    Auth_Token: "a",
    deep: { "client-secret": "b", list: [{ apiKey: "c", name: "n" }, { x: { PASSWORD: "d" } }] },
    items: [{ client_secret: "pi_secret_x", id: "pi_1" }, { refreshToken: "e" }, { token: "f" }],
  });
  assert.deepEqual(out, {
    ok: 1,
    next_page_token: "keep",
    Auth_Token: "***",
    deep: { "client-secret": "***", list: [{ apiKey: "***", name: "n" }, { x: { PASSWORD: "***" } }] },
    items: [{ client_secret: "***", id: "pi_1" }, { refreshToken: "***" }, { token: "***" }],
  });
});

test("1: any name ending in token is a secret, paging tokens are not; credentials, authorization and JSON inside a string are guarded (re-check, 16 Nov)", () => {
  const out = withoutSecretValues({
    bearer_token: "a",
    sessionToken: "b",
    sid_token: "c",
    idToken: "d",
    token_value: "kept: not a name that ends in token",
    credential: "e",
    Credentials: { user: "u" },
    authorization: "Bearer f",
    next_page_token: "p1",
    nextPageToken: "p2",
    continuationToken: "p3",
    sync_token: "p4",
    cursor: "p5",
    key: "PROJ-1",
    signatures: [{ signer: "s" }],
    doc: '{"auth_token":"H","name":"n"}',
    plain: "{not json",
    list: '[{"client_secret":"x"}]',
  });
  assert.deepEqual(out, {
    bearer_token: "***",
    sessionToken: "***",
    sid_token: "***",
    idToken: "***",
    token_value: "kept: not a name that ends in token",
    credential: "***",
    Credentials: "***",
    authorization: "***",
    next_page_token: "p1",
    nextPageToken: "p2",
    continuationToken: "p3",
    sync_token: "p4",
    cursor: "p5",
    key: "PROJ-1",
    signatures: [{ signer: "s" }],
    doc: '{"auth_token":"***","name":"n"}',
    plain: "{not json",
    list: '[{"client_secret":"***"}]',
  });
});

test("1: a refusal whose body carries another account's token does not show it", async () => {
  const k = await setup();
  const def: ConnectorDef = {
    key: "custom",
    title: "Custom",
    mode: "api",
    scope: "space",
    version: "1.0.0",
    auth: { type: "api_key", secret: "K", header: "X-Key" },
    domains: ["api.custom.example"],
    secrets: [{ name: "K", description: "key" }],
    actions: [{ name: "list", method: "GET", url: "https://api.custom.example/l" }],
  };
  k.state.reply = () => ({ status: 400, body: { accounts: [{ auth_token: "OTHER_TOKEN_77aa", sid: "AC1" }] } });
  let seen = "";
  await assert.rejects(
    () => executeAction(k.deps, k.ctx, def, "list", { secrets: { K: "kkkk-1111" }, persist: false }),
    (e: unknown) => {
      seen = inspect(e, { depth: 8 });
      return true;
    },
  );
  assert.match(seen, /refused the request \(400\)/);
  assert.doesNotMatch(seen, /OTHER_TOKEN_77aa/);
  assert.match(seen, /AC1/, "the rest of the service's words stay");
});

test("1: a custom connector's output gets the same guard", async () => {
  const k = await setup();
  const def: ConnectorDef = {
    key: "custom",
    title: "Custom",
    mode: "api",
    scope: "space",
    version: "1.0.0",
    auth: { type: "api_key", secret: "K", header: "X-Key" },
    domains: ["api.custom.example"],
    secrets: [{ name: "K", description: "key" }],
    actions: [{ name: "list", method: "GET", url: "https://api.custom.example/l" }],
  };
  k.state.reply = () => ({ status: 200, body: { rows: [{ id: 1, api_key: "LEAKED_VALUE_1" }] } });
  const r = await executeAction(k.deps, k.ctx, def, "list", { secrets: { K: "kkkk-1111" }, persist: false });
  assert.deepEqual(r.output, { rows: [{ id: 1, api_key: "***" }] });
});

test("4: a path input that climbs or leaves the path is refused in plain words, before any request", async () => {
  const k = await setup();
  for (const [key, action, input] of [
    ["stripe", "get_customer", { customer_id: ".." }],
    ["stripe", "get_customer", { customer_id: "a/b" }],
    ["mailgun", "list_events", { domain: ".." }],
    ["mailgun", "list_events", { domain: "%2e%2e" }],
  ] as const) {
    k.sent.length = 0;
    await assert.rejects(
      executeAction(k.deps, k.ctx, defOf(k, key), action, {
        secrets: { Stripe_Key: "sk_test_abcd1234", Mailgun_Key: "key-abcd1234" },
        input,
        persist: false,
      }),
      (e: { error?: { message?: string } }) => /cannot be/.test(e.error?.message ?? ""),
      `${key}.${action} ${JSON.stringify(input)}`,
    );
    assert.equal(k.sent.length, 0, "nothing was sent");
  }
});

test("2: the seed upgrade reaches an unchanged shipped row and never a row a Space changed", async () => {
  const k = await setup();
  const fresh = (key: string) => k.tx.get<{ def: string }>("SELECT def FROM cn_connectors WHERE key = ?", key)!.def;
  const shipped = JSON.parse(fresh("stripe")) as ConnectorDef;
  assert.ok(shipped.shipped, "a seeded row carries its shipped hash");
  // a later release fixes the shipped definition: an unchanged row is brought up
  const older = { ...shipped, version: "0.9.0", actions: shipped.actions.filter((a) => a.name !== "list_products") };
  const { shipped: _h, ...body } = older;
  const withHash = { ...body, shipped: (await import("../projections.ts")).shippedHash(body as ConnectorDef) };
  k.tx.run("UPDATE cn_connectors SET def = ?, version = '0.9.0' WHERE key = 'stripe'", JSON.stringify(withHash));
  const revOf = () => k.tx.get<{ rev: number }>("SELECT rev FROM cn_revisions WHERE key = 'stripe'")!.rev;
  const revBefore = revOf();
  seedBuiltins({ ...k.deps, tx: Object.create(k.tx) });
  assert.ok(
    JSON.parse(fresh("stripe")).actions.some((a: { name: string }) => a.name === "list_products"),
    "the fix reached it",
  );
  assert.ok(revOf() > revBefore, "a refresh of a shipped definition moves its revision");
  // a Space changed it (its own host added): never overwritten, even though its version is older
  const mine = { ...withHash, domains: [...withHash.domains, "my-own-proxy.example.org"] };
  k.tx.run("UPDATE cn_connectors SET def = ?, version = '0.9.0' WHERE key = 'stripe'", JSON.stringify(mine));
  seedBuiltins({ ...k.deps, tx: Object.create(k.tx) });
  assert.ok(JSON.parse(fresh("stripe")).domains.includes("my-own-proxy.example.org"), "the Space's change survived");
});

test("3: a connection made by rc.28 (the old slot names) keeps working after the update", async () => {
  const k = await setup();
  for (const [key, slots] of [
    ["zoom", { Zoom_S2S: "#Zoom_S2S.value", Zoom_Webhook_Secret: "#Zoom_S2S.hook" }],
    ["twilio", { Twilio_Account: "#Tw.sid", Twilio_Auth: "#Tw.auth", Twilio_API_Key: "#Tw.key" }],
  ] as const) {
    const def = defOf(k, key);
    for (const name of Object.keys(slots))
      assert.ok(
        def.secrets.some((s) => s.name === name),
        `${key} still declares ${name}`,
      );
    const made = await k.hs["connections.create"](k.ctx, {
      connector: key,
      title: key,
      ownerKind: "space",
      secrets: slots,
      idempotencyKey: `old-${key}`,
    } as never);
    assert.ok(made.connection.connectionId, `${key}: a connection bound to the old slots is still accepted`);
  }
  // and the card never asks for a legacy slot
  const card = (await k.hs["connectors.for_service"](k.ctx, { service: "Twilio" })).connector!;
  assert.ok(!card.fields.some((f) => /API_Key/.test(f.name)));
});
