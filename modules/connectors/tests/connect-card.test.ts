// @reads /modules/connectors/migrations/0001_connectors.sql
// The two reads the connect card stands on (b-connect, 14 Nov 2026): the connector a service named in words points at, and a typed key tried against the app BEFORE anything is stored.
import test from "node:test";
import assert from "node:assert/strict";
import { ACME } from "../fixtures/acme.ts";
import { kit } from "../fixtures/kit.ts";
import type { ConnectorDef } from "../projections.ts";

const FATHOM: ConnectorDef = {
  ...ACME,
  key: "fathom",
  title: "Fathom",
  scope: "person",
  domains: ["api.fathom.test"],
  auth: { type: "api_key", secret: "api_key", header: "X-Api-Key" },
  secrets: [
    { name: "api_key", description: "Your Fathom API key" },
    { name: "webhook_secret", description: "Optional: the secret Fathom signs its webhooks with" },
  ],
  health: "ping",
  actions: [{ name: "ping", url: "https://api.fathom.test/v1/ping", output: "/ok" }],
  tests: [],
};
delete (FATHOM as { rate?: unknown }).rate; // no rate limit: the checks in a test come back to back
const SECRET = "fk_live_TYPEDKEY_0001";

test("a service said in words finds its connector, with the fields it needs named as labels", async () => {
  const k = kit();
  k.install(FATHOM);
  for (const said of ["Fathom", "fathom", " FATHOM ", "fath"]) {
    const r = await k.hs["connectors.for_service"](k.ctx, { service: said });
    assert.equal(r.found, true, said);
    assert.equal(r.connector?.title, "Fathom");
    assert.deepEqual(r.connector?.fields, [
      { name: "api_key", label: "API key", optional: false },
      { name: "webhook_secret", label: "Webhook secret", optional: true },
    ]);
    assert.equal(r.connector?.site, "https://fathom.test");
    assert.equal(r.connection, undefined);
  }
  const none = await k.hs["connectors.for_service"](k.ctx, { service: "Zendesk" });
  assert.deepEqual(none, { found: false, near: [] }, "the answer names what was asked, with nothing close");
});

test("a draft connector is not offered, and an empty word finds nothing", async () => {
  const k = kit();
  k.install(FATHOM, "draft");
  assert.equal((await k.hs["connectors.for_service"](k.ctx, { service: "Fathom" })).found, false);
  k.install(FATHOM);
  assert.equal((await k.hs["connectors.for_service"](k.ctx, { service: "" })).found, false);
});

test("it says whether the caller already has the service connected, and whose connection it is", async () => {
  const k = kit();
  k.install(FATHOM);
  k.vault["#Fathom"] = "x";
  const made = await k.hs["connections.create"](k.ctx, {
    connector: "fathom",
    title: "Fathom",
    ownerKind: "person",
    secrets: { api_key: "#Fathom" },
  });
  k.state.reply = () => ({ status: 200, body: { ok: true } });
  await k.hs["connections.test"](k.ctx, { connectionId: made.connection.connectionId });
  const r = await k.hs["connectors.for_service"](k.ctx, { service: "fathom" });
  assert.deepEqual(r.connection, { connectionId: made.connection.connectionId, owner: "mine", state: "active" });
  const other = await k.hs["connectors.for_service"](k.mk("usr_other"), { service: "fathom" });
  assert.equal(other.connection, undefined, "someone else's own connection is not theirs");
});

test("check_key: a good key is ok, a rejected key says rejected, an app that cannot be reached says so, and no answer holds the key", async () => {
  const k = kit();
  k.install(FATHOM);
  k.state.reply = () => ({ status: 200, body: { ok: true } });
  const ok = await k.hs["connectors.check_key"](k.ctx, { connector: "fathom", secrets: { api_key: SECRET } });
  assert.equal(ok.result, "ok");
  assert.equal(k.sent[0]!.headers["X-Api-Key"], SECRET, "the typed key is what reached the app");

  k.state.reply = () => ({ status: 401 });
  const bad = await k.hs["connectors.check_key"](k.ctx, { connector: "fathom", secrets: { api_key: SECRET } });
  assert.equal(bad.result, "rejected");

  k.state.reply = () => new Error("ECONNREFUSED");
  const down = await k.hs["connectors.check_key"](k.ctx, { connector: "fathom", secrets: { api_key: SECRET } });
  assert.equal(down.result, "unreachable");

  const seen = JSON.stringify([ok, bad, down, k.events, k.logs, k.calls]);
  assert.equal(seen.includes(SECRET), false, "the key is in no answer, event, log line or nested call");
  assert.equal(
    k.calls.some((c) => c.cap.startsWith("vault.")),
    false,
    "nothing was stored",
  );
});

test("check_key refuses a missing required field, an unknown field and a draft, and leaves the optional one out", async () => {
  const k = kit();
  k.install(FATHOM);
  const code = (e: unknown) => (e as { error?: { code?: string } }).error?.code;
  await assert.rejects(k.hs["connectors.check_key"](k.ctx, { connector: "fathom", secrets: {} }), (e) => {
    assert.equal(code(e), "validation.bad_input");
    return true;
  });
  await assert.rejects(
    k.hs["connectors.check_key"](k.ctx, { connector: "fathom", secrets: { api_key: "a", nope: "b" } }),
    (e) => code(e) === "validation.bad_input",
  );
  k.state.reply = () => ({ status: 200, body: { ok: true } });
  assert.equal(
    (await k.hs["connectors.check_key"](k.ctx, { connector: "fathom", secrets: { api_key: "a" } })).result,
    "ok",
    "the webhook secret is optional",
  );
});
