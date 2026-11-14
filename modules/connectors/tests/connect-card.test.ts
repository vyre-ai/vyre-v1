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
  for (const said of ["Fathom", "fathom", " FATHOM "]) {
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
  const prefix = await k.hs["connectors.for_service"](k.ctx, { service: "fath" });
  assert.equal(prefix.found, false, "a prefix is never a match");
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

test("check_key: a connector built in one call has no health action, so its first read that needs no input tries the key", async () => {
  const k = kit();
  const built: ConnectorDef = {
    ...FATHOM,
    key: "built",
    title: "Built app",
    health: undefined as never,
    actions: [
      { name: "get_meeting", url: "https://api.fathom.test/v1/meetings/{input.id}" },
      { name: "list_meetings", url: "https://api.fathom.test/v1/meetings" },
    ],
  };
  delete (built as { health?: unknown }).health;
  k.install(built);
  k.state.reply = () => ({ status: 401 });
  const bad = await k.hs["connectors.check_key"](k.ctx, { connector: "built", secrets: { api_key: SECRET } });
  assert.equal(bad.result, "rejected", "a wrong key is caught even with no health action");
  assert.equal(k.sent[0]!.url, "https://api.fathom.test/v1/meetings", "the call that needs no input");
  const none: ConnectorDef = { ...built, key: "blind", actions: [built.actions[0]!] };
  k.install(none);
  assert.equal(
    (await k.hs["connectors.check_key"](k.ctx, { connector: "blind", secrets: { api_key: SECRET } })).result,
    "ok",
  );
});

test("two connectors of one name are not guessed between, and a short name never matches a longer one", async () => {
  const k = kit();
  k.install({ ...FATHOM, key: "git", title: "Git" });
  k.install({ ...FATHOM, key: "github", title: "GitHub" });
  const r = await k.hs["connectors.for_service"](k.ctx, { service: "GitHub" });
  assert.equal(r.connector?.key, "github");
  assert.equal((await k.hs["connectors.for_service"](k.ctx, { service: "Gi" })).found, false);
  k.install({ ...FATHOM, key: "git2", title: "git" });
  const two = await k.hs["connectors.for_service"](k.ctx, { service: "git" });
  assert.deepEqual([two.found, two.near], [false, ["Git", "git"]]);
});

test("check_key is a person's act: an agent caller is refused and nothing is sent", async () => {
  const k = kit();
  k.install(FATHOM);
  const agent = { ...k.mk("usr_dana"), callerKind: "agent" };
  await assert.rejects(k.hs["connectors.check_key"](agent, { connector: "fathom", secrets: { api_key: SECRET } }));
  assert.equal(k.sent.length, 0);
  const person = { ...k.mk("usr_dana"), callerKind: "person" };
  k.state.reply = () => ({ status: 200, body: { ok: true } });
  assert.equal(
    (await k.hs["connectors.check_key"](person, { connector: "fathom", secrets: { api_key: SECRET } })).result,
    "ok",
  );
});

test("a draft connector can be neither found nor tried", async () => {
  const k = kit();
  k.install({ ...FATHOM, key: "drafty", title: "Drafty" }, "draft");
  assert.equal((await k.hs["connectors.for_service"](k.ctx, { service: "Drafty" })).found, false);
  await assert.rejects(k.hs["connectors.check_key"](k.ctx, { connector: "drafty", secrets: { api_key: SECRET } }));
  assert.equal(k.sent.length, 0);
});
