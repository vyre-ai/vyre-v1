// An app that issues its own OAuth client (item 8): the Vault item holds client_id, client_secret and refresh_token; the connector trades them for an access token, renews it before it ends, writes a rotated
// refresh token back into the same item, and repeats a call once when the app answers 401. The app here is a stand-in that rotates refresh tokens, as Clio does, and refuses one it has already retired.
import test from "node:test";
import assert from "node:assert/strict";
import { kit } from "../fixtures/kit.ts";
import type { Kit, Sent } from "../fixtures/kit.ts";
import { accessToken, grantKey, resetGrants } from "../refresh-grant.ts";
import { consumers } from "../impl.ts";
import type { ConnectorDef } from "../projections.ts";

const CLIO: ConnectorDef = {
  key: "clio",
  title: "Clio Manage",
  mode: "api",
  scope: "space",
  version: "1.0.0",
  auth: {
    type: "oauth_refresh",
    tokenUrl: "https://app.clio.com/oauth/token",
    clientIdSecret: "Client_id",
    clientSecret: "Client_secret",
    refreshSecret: "Refresh_token",
  },
  domains: ["app.clio.com"],
  secrets: [
    { name: "Client_id", description: "id" },
    { name: "Client_secret", description: "secret" },
    { name: "Refresh_token", description: "refresh" },
  ],
  health: "ping",
  actions: [{ name: "ping", url: "https://app.clio.com/api/v4/ping", output: "/ok" }],
};

/** The app: one live refresh token and one live access token; using a retired refresh token is refused. */
function app(k: Kit) {
  const s = { refresh: "rt_1", access: "", n: 0, posts: 0, api: 0, lifetime: 3600 };
  k.state.reply = (req: Sent) => {
    if (req.url.endsWith("/oauth/token")) {
      s.posts += 1;
      const form = new URLSearchParams(req.body ?? "");
      if (form.get("grant_type") !== "refresh_token" || form.get("refresh_token") !== s.refresh)
        return { status: 400, body: { error: "invalid_grant" } };
      if (form.get("client_id") !== "cid" || form.get("client_secret") !== "csecret")
        return { status: 401, body: { error: "invalid_client" } };
      s.n += 1;
      s.access = `at_${s.n}`;
      s.refresh = `rt_${s.n + 1}`;
      return {
        status: 200,
        body: { access_token: s.access, refresh_token: s.refresh, expires_in: s.lifetime, token_type: "bearer" },
      };
    }
    s.api += 1;
    return req.headers["Authorization"] === `Bearer ${s.access}` && s.access !== ""
      ? { status: 200, body: { ok: true } }
      : { status: 401, body: { error: "expired" } };
  };
  return s;
}

async function connected(k: Kit): Promise<string> {
  resetGrants();
  k.install(CLIO);
  k.items["vit_9"] = { handle: "#Clio_App", name: "Clio_App", value: "", folderId: "vfd_1" };
  Object.assign(k.vault, {
    "#Clio_App.client_id": "cid",
    "#Clio_App.client_secret": "csecret",
    "#Clio_App.refresh_token": "rt_1",
  });
  const made = await k.hs["connections.create"](k.ctx, {
    connector: "clio",
    title: "Clio",
    ownerKind: "space",
    secrets: {
      Client_id: "#Clio_App.client_id",
      Client_secret: "#Clio_App.client_secret",
      Refresh_token: "#Clio_App.refresh_token",
    },
  } as never);
  return made.connection.connectionId;
}
const ping = (k: Kit, id: string) =>
  k.hs["connectors.run"](k.ctx, { key: "clio", action: "ping", connectionId: id, input: {} });
const posts = (k: Kit): Sent[] => k.sent.filter((r) => r.url.endsWith("/oauth/token"));

test("the first call trades the refresh token, sends the access token, and writes the rotated refresh token back into the same Vault item", async () => {
  const k = kit();
  const s = app(k);
  const id = await connected(k);
  const out = await ping(k, id);
  assert.equal(out.output, true);
  assert.equal(s.posts, 1);
  assert.equal(k.vault["#Clio_App.refresh_token"], "rt_2", "the item holds the refresh token the app issued");
  const api = k.sent.find((r) => r.url.includes("/api/v4/ping"))!;
  assert.equal(api.headers["Authorization"], "Bearer at_1");
  assert.equal(k.calls.filter((c) => c.cap === "vault.item.rotate_field").length, 1, "one housekeeping write");
  assert.equal(k.calls.filter((c) => c.cap === "vault.item.update").length, 0, "no edit of the item");
});

test("the access token is kept until a minute before it ends, then renewed with the rotated refresh token", async () => {
  const k = kit();
  const s = app(k);
  const id = await connected(k);
  await ping(k, id);
  await ping(k, id);
  assert.equal(s.posts, 1, "the second call reuses the token");
  k.clock.t += 3_539_000; // 61 s left of the hour
  await ping(k, id);
  assert.equal(s.posts, 1);
  k.clock.t += 2_000; // under a minute left
  await ping(k, id);
  assert.equal(s.posts, 2);
  assert.equal(k.vault["#Clio_App.refresh_token"], "rt_3");
  assert.equal(posts(k).length, 2);
});

test("a 401 is answered with one new token and one repeat; a second 401 asks for a reconnect and no more calls follow", async () => {
  const k = kit();
  const s = app(k);
  const id = await connected(k);
  await ping(k, id);
  s.access = "revoked_at_the_app"; // the app retired the token we hold
  const out = await ping(k, id);
  assert.equal(out.output, true);
  assert.equal(s.posts, 2);
  assert.equal(s.api, 3, "the 401 and its repeat");
  // an app that keeps refusing: one repeat only
  const before = s.api;
  k.state.reply = (req: Sent) =>
    req.url.endsWith("/oauth/token")
      ? { status: 200, body: { access_token: "x", refresh_token: "rt_x", expires_in: 3600 } }
      : { status: 401, body: {} };
  await assert.rejects(ping(k, id), (e) => (e as { error?: { code?: string } }).error?.code === "provider.auth_failed");
  assert.equal(s.api, before, "no call reached the stand-in app");
  assert.equal(k.sent.filter((r) => r.url.includes("/api/v4/ping")).length - before, 2);
});

test("a refused refresh token fails with a plain line that has no token in it", async () => {
  const k = kit();
  app(k);
  const id = await connected(k);
  k.vault["#Clio_App.refresh_token"] = "rt_old_and_retired";
  await assert.rejects(ping(k, id), (e) => {
    const err = (e as { error?: { code?: string; message?: string } }).error!;
    assert.equal(err.code, "provider.auth_failed");
    assert.doesNotMatch(String(err.message), /rt_|csecret|at_/);
    return true;
  });
});

test("a rotated refresh token the Vault could not take is kept and saved first on the next call", async () => {
  const k = kit();
  const s = app(k);
  const id = await connected(k);
  const real = k.mk;
  void real;
  k.vaultFault.next = null;
  // the Vault refuses the write three times (the grant tries three times), then recovers
  let refuse = 3;
  const call = k.ctx.call;
  k.ctx.call = async (cap, input) => {
    if (cap === "vault.item.rotate_field" && refuse-- > 0) throw new Error("vault is busy");
    return call(cap, input);
  };
  await assert.rejects(ping(k, id), (e) =>
    /could not be saved to the Vault item/.test(String((e as { error?: { message?: string } }).error?.message)),
  );
  assert.equal(k.vault["#Clio_App.refresh_token"], "rt_1", "the item still has the retired one");
  k.clock.t += 4_000_000;
  const out = await ping(k, id);
  assert.equal(out.output, true);
  assert.equal(k.vault["#Clio_App.refresh_token"], "rt_3", "the held token went in first, then the next rotation");
  assert.equal(s.n, 2);
});

const second = async (k: Kit): Promise<string> =>
  (
    await k.hs["connections.create"](k.ctx, {
      connector: "clio",
      title: "Clio again",
      ownerKind: "space",
      secrets: {
        Client_id: "#Clio_App.client_id",
        Client_secret: "#Clio_App.client_secret",
        Refresh_token: "#Clio_App.refresh_token",
      },
    } as never)
  ).connection.connectionId;
const stateOf = (k: Kit, id: string): string =>
  (k.tx.get("SELECT state FROM cn_connections WHERE connection_id = ?", id) as { state: string }).state;

test("two connections on one Vault item and a probe in the middle of a sync make one refresh, and nobody is asked to reconnect", async () => {
  const k = kit();
  const s = app(k);
  const a = await connected(k);
  const b = await second(k);
  const probePort = {
    now: () => k.clock.t,
    fill: async (f: string) => k.vault[`#Clio_App.${f}`]!,
    http: async (url: string, init: { body: string }) => k.ctx.http(url, init as never),
    saveRefresh: async (t: string) => {
      k.vault["#Clio_App.refresh_token"] = t;
    },
  };
  const out = await Promise.all([
    ping(k, a),
    ping(k, b),
    accessToken(grantKey(k.tx, "#Clio_App"), "https://app.clio.com/oauth/token", probePort as never),
  ]);
  assert.equal(out[0]!.output, true);
  assert.equal(out[1]!.output, true);
  assert.equal(s.posts, 1, "one refresh for all three");
  assert.deepEqual([stateOf(k, a), stateOf(k, b)], ["active", "active"]);
});

test("only a refused refresh token asks for a reconnect; a busy, failing or unreachable app is tried again and the connection stays", async () => {
  for (const [status, code] of [
    [429, "provider.rate_limited"],
    [503, "provider.unavailable"],
    [408, "provider.unavailable"],
  ] as const) {
    const k = kit();
    app(k);
    const id = await connected(k);
    let tries = 0;
    k.state.reply = () => {
      tries += 1;
      return { status, body: {} };
    };
    await assert.rejects(ping(k, id), (e) => (e as { error?: { code?: string } }).error?.code === code, String(status));
    assert.equal(tries, 3, `${status}: tried three times`);
    assert.equal(stateOf(k, id), "active", `${status}: not asked to reconnect`);
  }
  const k = kit();
  const s = app(k);
  const id = await connected(k);
  let flaky = 2;
  const real = k.state.reply;
  k.state.reply = (req) => (req.url.endsWith("/oauth/token") && flaky-- > 0 ? { status: 503, body: {} } : real(req));
  assert.equal((await ping(k, id)).output, true, "two failures, then it works");
  assert.equal(s.posts, 1);
  const bad = kit();
  app(bad);
  const badId = await connected(bad);
  bad.vault["#Clio_App.refresh_token"] = "rt_retired";
  await assert.rejects(ping(bad, badId));
  assert.equal(stateOf(bad, badId), "needs_reconnect", "400 means refused");
});

test("a member who may use the item but not edit it runs a pass, and the rotated token still lands in the item", async () => {
  const k = kit();
  app(k);
  const id = await connected(k);
  k.noEdit.on = true;
  assert.equal((await ping(k, id)).output, true);
  assert.equal(k.vault["#Clio_App.refresh_token"], "rt_2");
  assert.equal(stateOf(k, id), "active");
});

test("deleting the connection, or pasting its credentials again, drops what was kept for the item, including a token that was waiting to be saved", async () => {
  const k = kit();
  const s = app(k);
  const id = await connected(k);
  // the save fails every time: the app has rotated, the Vault has not heard
  const call = k.ctx.call;
  k.ctx.call = async (cap, input) => {
    if (cap === "vault.item.rotate_field") throw new Error("vault is down");
    return call(cap, input);
  };
  await assert.rejects(ping(k, id));
  k.ctx.call = call;
  // the person pastes the item again with a token the app knows
  await k.hs["connections.delete"](k.ctx, { connectionId: id } as never);
  s.refresh = "rt_pasted";
  k.vault["#Clio_App.refresh_token"] = "rt_pasted";
  const again = await second(k);
  assert.equal((await ping(k, again)).output, true, "the stale waiting token was not put over the pasted one");
  assert.equal(k.vault["#Clio_App.refresh_token"], `rt_${s.n + 1}`);
});

test("the one consumer that ends what a pass kept of the Vault (modules/connectors/tests/syncrate.test.ts) also ends every kept access token, so a Vault revoke is felt by both", async () => {
  const k = kit();
  const s = app(k);
  const id = await connected(k);
  await ping(k, id);
  await ping(k, id);
  assert.equal(s.posts, 1, "the access token is kept");
  assert.ok(consumers["connectors.forget_pass_keys"].on.includes("vault.item_updated"));
  assert.ok(consumers["connectors.forget_pass_keys"].on.includes("connection.deleted"));
  consumers["connectors.forget_pass_keys"].run();
  await ping(k, id);
  assert.equal(s.posts, 2, "after a Vault change the next call asks the app for a new token");
});

test("a connection deleted while the Vault could not take a rotated refresh token still gets it saved: the next connection on the item saves it first", async () => {
  const k = kit();
  const s = app(k);
  const id = await connected(k);
  const call = k.ctx.call;
  k.ctx.call = async (cap, input) => {
    if (cap === "vault.item.rotate_field") throw new Error("vault is down");
    return call(cap, input);
  };
  await assert.rejects(ping(k, id));
  await k.hs["connections.delete"](k.ctx, { connectionId: id } as never);
  assert.equal(
    k.vault["#Clio_App.refresh_token"],
    "rt_1",
    "the Vault is still down: nothing was saved, nothing was dropped",
  );
  k.ctx.call = call;
  consumers["connectors.forget_pass_keys"].run();
  const again = await second(k);
  assert.equal((await ping(k, again)).output, true);
  assert.equal(k.vault["#Clio_App.refresh_token"], "rt_3", "rt_2 was saved first, then traded for rt_3");
  assert.equal(s.n, 2);
});
