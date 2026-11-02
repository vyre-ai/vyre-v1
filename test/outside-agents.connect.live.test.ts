// Outside agents, the connection, end to end on a booted daemon with a scripted MCP client: revoked and expired tokens, Remove and Trash, a Personal Space, a suspended person, a token from another
// address or another Space, and a cross-site Allow post. What it does once connected is in outside-agents.work.live.test.ts; shared setup in test/support/outside-client.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { bootAgentGateSpace } from "../golden/steps/07-agent-gate.ts";
import { expectStatus } from "../golden/steps/02-space.ts";
import { Client, OUTSIDE_LIVE as LIVE, raw, signIn, withOutsideSpace as withSpace } from "./support/outside-client.ts";

type Json = any;   // eslint-disable-line @typescript-eslint/no-explicit-any

withSpace("revoked and expired tokens stop at the next request; Remove ends the agent, and the same app starts over as a new one", async (s, owner, mcp) => {
  const c = new Client(mcp);
  const { agentId } = await signIn(s, c, owner);
  await c.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } });
  assert.equal((await c.tool("agents_next")).status, 200);

  s.d.db!.run("UPDATE mcp_oauth_tokens SET expires_at = 1 WHERE kind = 'access'");
  const expired = await c.tool("agents_next");
  assert.equal(expired.status, 401);
  assert.match(String(expired.headers["www-authenticate"]), /invalid_token/);
  const fresh = await c.exchange({ grant_type: "refresh_token", refresh_token: c.refresh });
  assert.equal(fresh.status, 200);
  c.token = fresh.json.access_token; c.refresh = fresh.json.refresh_token;
  assert.equal((await c.tool("agents_next")).status, 200);

  expectStatus(await s.call("mcp.connected.remove", owner, { agentId }), 200, "mcp.connected.remove");
  assert.equal((await c.tool("agents_next")).status, 401, "ended at once");
  assert.equal((await c.exchange({ grant_type: "refresh_token", refresh_token: c.refresh })).status, 400);
  assert.notEqual((await s.call("agents.get", owner, { agentId })).status, 200, "the agent went to Trash");
  assert.deepEqual(expectStatus(await s.call("mcp.connected.list", owner, {}), 200, "mcp.connected.list").agents, []);

  const again = await signIn(s, c, owner);
  assert.notEqual(again.agentId, agentId, "a removed agent does not come back");
});

withSpace("an outside agent moved to Trash any other way ends its sign-in too", async (s, owner, mcp) => {
  const c = new Client(mcp);
  const { agentId } = await signIn(s, c, owner);
  await c.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } });
  assert.equal((await c.tool("agents_next")).status, 200);
  expectStatus(await s.call("agents.delete", owner, { agentId }), 200, "agents.delete");
  await s.d.hooks?.pump?.();
  assert.equal((await c.tool("agents_next")).status, 401);
  assert.deepEqual(expectStatus(await s.call("mcp.connected.list", owner, {}), 200, "mcp.connected.list").agents, []);
});

test("in a Personal Space it works the same, on this computer's own address", async () => {
  const s = await bootAgentGateSpace(LIVE, { spaceKind: "personal" });
  try {
    const owner = s.signedIn("usr_olivia");
    const c = new Client(`${s.d.url}/mcp`);
    const { agentId } = await signIn(s, c, owner);
    await c.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } });
    assert.equal((await c.tool("agents_next")).status, 200);
    assert.equal(expectStatus(await s.call("mcp.connected.link", owner, {}), 200, "mcp.connected.link").url, `${s.d.url}/mcp`);
    assert.equal(expectStatus(await s.call("agents.get", owner, { agentId }), 200, "agents.get").agent.runtime, "outside");
  } finally { await s.stop(); }
});

withSpace("a person suspended ends their agent's access at once", async (s, owner, mcp) => {
  const c = new Client(mcp);
  const noah = s.signedIn("usr_noah");
  await signIn(s, c, noah);
  await c.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } });
  assert.equal((await c.tool("agents_next")).status, 200);
  expectStatus(await s.call("members.suspend", owner, { personId: "usr_noah" }), 200, "members.suspend");
  assert.equal((await c.tool("agents_next")).status, 401);
});

withSpace("a token from another address opens nothing, and the relay address is its own resource", async (s, owner, mcp) => {
  const port = new URL(mcp).port;
  const local = new Client(mcp);
  await signIn(s, local, owner);
  await local.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } });
  assert.equal((await local.tool("agents_next")).status, 200);
  const other = await raw(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { host: `localhost:${port}`, authorization: `Bearer ${local.token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
  assert.equal(other.status, 401, "the same daemon on another name is another resource");

  // a phone address: the box hands the request on with x-vyre-via, and the metadata names the public address, whatever Host says
  s.d.db!.run("INSERT OR REPLACE INTO network_phone (id, name, state, reported_at) VALUES (1, 'northwind', 'claimed', 1)");
  const relay = new Client(mcp, { "x-vyre-via": "relay", host: "evil.example" });
  await relay.discover();
  assert.equal(relay.issuer, "https://northwind.vyre.run");
  assert.equal(relay.resource, "https://northwind.vyre.run/mcp");
  await relay.register();
  const { requestId, proof } = await relay.authorize();
  expectStatus(await s.call("mcp.oauth.allow", owner, { requestId }), 200, "mcp.oauth.allow");
  const w = await relay.wait(requestId, proof);
  assert.equal(new URL(w.redirect).searchParams.get("iss"), "https://northwind.vyre.run");
  await relay.trade(new URL(w.redirect).searchParams.get("code")!);
  assert.equal((await relay.rpc("ping")).status, 200);
  const crossed = await raw(mcp, { method: "POST", headers: { authorization: `Bearer ${relay.token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
  assert.equal(crossed.status, 401, "a token for the relay address opens nothing on loopback");
  const wrong = await relay.exchange({ grant_type: "refresh_token", refresh_token: local.refresh });
  assert.equal(wrong.status, 400, "and a refresh token of the other address does not trade here");
});

test("a token from another Space opens nothing", async () => {
  const a = await bootAgentGateSpace(LIVE);
  const b = await bootAgentGateSpace(LIVE);
  try {
    const c = new Client(`${a.d.url}/mcp`);
    await signIn(a, c, a.signedIn("usr_olivia"));
    const there = await raw(`${b.d.url}/mcp`, { method: "POST", headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
    assert.equal(there.status, 401);
  } finally { await a.stop(); await b.stop(); }
});

withSpace("a cross-site Allow post is refused: no session, a cookie, a foreign Origin, a preflight", async (s, owner, mcp) => {
  const c = new Client(mcp);
  await c.discover();
  await c.register();
  const { requestId, proof } = await c.authorize();
  const body = JSON.stringify({ requestId });
  const post = (headers: Record<string, string>) => raw(`${s.d.url}/v1/mcp/oauth/allow`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
  assert.equal((await post({ origin: "https://evil.example" })).status, 401, "a form on another site has no Bearer token to send");
  assert.equal((await post({ origin: "https://evil.example", cookie: `session=${owner}; vyre=${owner}` })).status, 401, "a cookie is not a session here");
  const form = await raw(`${s.d.url}/v1/mcp/oauth/allow`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" }, body: `requestId=${requestId}` });
  assert.notEqual(form.status, 200);
  const preflight = await raw(`${s.d.url}/v1/mcp/oauth/allow`, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" } });
  assert.equal(preflight.headers["access-control-allow-origin"], undefined, "a browser never gets to send one with a Bearer token");
  assert.equal((await c.wait(requestId, proof)).status, "waiting", "nothing was allowed");
  assert.equal((await raw(c.door(`/oauth/authorize`), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "allow=1" })).status, 405, "and there is no Allow on the page to post to");
});
