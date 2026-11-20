// The runtime on real SQLite: an access token opens a session, one sign-in keeps one session, Remove in the middle of a call fails that call at once, and what a call does is written as activity and steps.
import test from "node:test";
import assert from "node:assert/strict";
import { createMcpRuntime } from "../impl.ts";
import { handlers } from "../impl.ts";
import { harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { ensure } from "../projections.ts";
import { ACCESS_MS, beginAuthorize, challengeOf, collect, exchange, registerClient } from "../oauth.ts";
import type { Invoke } from "../../../host/src/invoke.ts";

const ORIGIN = "https://acme.vyre.run";
const VERIFIER = "v".repeat(60);
const h = handlers as unknown as Record<string, (ctx: unknown, input: any) => Promise<any> | any>;
const people = (hn: Harness) => ({
  ...hn.ctx,
  call: async (cap: string) =>
    cap === "agents.outside.connect"
      ? { agentId: "agt_out", name: "Claude Code" }
      : { deleted: true, agent: { name: "Claude Code" } },
});

async function tokens(hn: Harness): Promise<{ access: string; refresh: string; clientId: string }> {
  ensure(hn.db);
  const r = registerClient(
    hn.db,
    { client_name: "Claude Code (vyre)", redirect_uris: ["http://127.0.0.1:1/cb"] },
    hn.clock.t,
  ) as { client: { client_id: string; client_name: string } };
  assert.equal(r.client.client_name, "Claude Code");
  const b = beginAuthorize(
    hn.db,
    {
      client_id: r.client.client_id,
      redirect_uri: "http://127.0.0.1:1/cb",
      response_type: "code",
      code_challenge: challengeOf(VERIFIER),
      code_challenge_method: "S256",
    },
    ORIGIN,
    hn.clock.t,
  );
  if (b.kind !== "page") throw new Error("no page");
  await h["mcp.oauth.allow"]!(people(hn), { requestId: b.request.requestId });
  const w = collect(hn.db, b.request.requestId, b.proof, ORIGIN, hn.clock.t) as { redirect: string };
  const t = exchange(
    hn.db,
    {
      grant_type: "authorization_code",
      client_id: r.client.client_id,
      code: new URL(w.redirect).searchParams.get("code") as string,
      redirect_uri: "http://127.0.0.1:1/cb",
      code_verifier: VERIFIER,
    },
    ORIGIN,
    hn.clock.t,
  );
  if (!("tokens" in t)) throw new Error("no tokens");
  return { access: t.tokens.access_token, refresh: t.tokens.refresh_token, clientId: r.client.client_id };
}

function runtime(hn: Harness, invoke: Invoke, active: () => boolean = () => true) {
  return createMcpRuntime({
    db: hn.db,
    space: hn.ctx.space,
    invoke,
    now: () => hn.clock.t,
    active,
    endpoint: { url: `${ORIGIN}/mcp`, loopbackUrl: "http://127.0.0.1:1/mcp" },
  });
}
const call = (r: ReturnType<typeof runtime>, token: string, name: string, args: unknown = {}, origin = ORIGIN) =>
  r.handle({
    method: "POST",
    origin,
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });

test("revoked agent mid-call: Remove while a tool runs fails that call at once, and nothing after it gets in", async () => {
  const hn = harness();
  const t = await tokens(hn);
  let finish = (): void => undefined;
  let entered = (): void => undefined;
  const inside = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const r = runtime(
    hn,
    () =>
      new Promise((resolve) => {
        entered();
        finish = () => resolve({ status: "ok", output: { late: true }, traceId: "t" });
      }),
  );
  const running = call(r, t.access, "records_query", { type: "lead" });
  await inside;
  await h["mcp.connected.remove"]!(people(hn), { agentId: "agt_out" });
  const out = JSON.parse((await running).body) as {
    result: { isError: boolean; structuredContent: { error: { code: string } } };
  };
  assert.equal(out.result.isError, true);
  assert.equal(out.result.structuredContent.error.code, "permission.revoked");
  finish();
  assert.equal((await call(r, t.access, "records_query", { type: "lead" })).status, 401);
  assert.equal(r.sessions(), 0);
});

test("the person or the agent going inactive ends the token at the next request", async () => {
  const hn = harness();
  const t = await tokens(hn);
  let on = true;
  const r = runtime(
    hn,
    async () => ({ status: "ok", output: {}, traceId: "t" }),
    () => on,
  );
  assert.equal((await call(r, t.access, "records_query", { type: "lead" })).status, 200);
  on = false;
  assert.equal((await call(r, t.access, "records_query", { type: "lead" })).status, 401);
});

test("a token works only at the address it was made for, and expires", async () => {
  const hn = harness();
  const t = await tokens(hn);
  const r = runtime(hn, async () => ({ status: "ok", output: {}, traceId: "t" }));
  assert.equal((await call(r, t.access, "records_query", { type: "lead" }, "https://other.vyre.run")).status, 401);
  assert.equal((await call(r, t.access, "records_query", { type: "lead" })).status, 200);
  hn.advance(ACCESS_MS);
  const late = await call(r, t.access, "records_query", { type: "lead" });
  assert.equal(late.status, 401);
  assert.match(
    late.headers["www-authenticate"] ?? "",
    /resource_metadata="https:\/\/acme\.vyre\.run\/\.well-known\/oauth-protected-resource\/mcp", error="invalid_token"/,
  );
});

test("every call is an activity row with no input in it, as the agent, and a call that fails says so", async () => {
  const hn = harness();
  const t = await tokens(hn);
  const seeds: unknown[] = [];
  const r = runtime(hn, async (cap, _i, seed) => {
    seeds.push({
      cap,
      principal: seed.principal,
      actingFor: seed.actingFor,
      provider: seed.provider,
      auditAll: seed.auditAll,
      thread: seed.thread,
    });
    return { status: "ok", output: {}, traceId: "t" };
  });
  await call(r, t.access, "records_query", { type: "secret-words" });
  assert.deepEqual(seeds[0], {
    cap: "records.query",
    principal: { kind: "agent", id: "agt_out" },
    actingFor: "usr_dana",
    provider: "outside",
    auditAll: true,
    thread: undefined,
  });
  const rows = (await h["mcp.activity.list"]!(hn.ctx, { agentId: "agt_out" })).rows;
  assert.equal(rows[0].tool, "records_query");
  assert.equal(rows[0].outcome, "ok");
  assert.equal(JSON.stringify(rows).includes("secret-words"), false);
});

// an app that names itself by an address (client metadata document, lane r42-mcp): the authorize route reads its page once, keeps it as a client, and goes on as for any registered client
test("authorize with a client_id that is an address: its page is read once and kept; a page that cannot be read leaves the usual refusal; a private address is never connected to", async () => {
  const ID = "https://app.example.com/client.json";
  const hn = harness();
  ensure(hn.db);
  let reads = 0;
  const doc = JSON.stringify({ client_id: ID, client_name: "Example app", redirect_uris: ["https://app.example.com/cb"] });
  const make = (get: (u: string) => Promise<{ ok: boolean; status: number; body: AsyncIterable<Uint8Array> | null }>) =>
    createMcpRuntime({
      db: hn.db,
      space: hn.ctx.space,
      invoke: (async () => ({ status: "ok", output: {}, traceId: "t" })) as Invoke,
      now: () => hn.clock.t,
      active: () => true,
      endpoint: { url: `${ORIGIN}/mcp`, loopbackUrl: "http://127.0.0.1:1/mcp" },
      clientDocGet: get as never,
    });
  const search = (id: string) =>
    `?client_id=${encodeURIComponent(id)}&redirect_uri=${encodeURIComponent("https://app.example.com/cb")}&response_type=code&code_challenge=${challengeOf(VERIFIER)}&code_challenge_method=S256`;
  const authorize = (r: ReturnType<typeof make>, id: string) =>
    r.oauth({ method: "GET", path: "/oauth/authorize", search: search(id), headers: {}, body: "", origin: ORIGIN, visitor: "v1" });
  const good = make(async () => {
    reads += 1;
    return {
      ok: true,
      status: 200,
      body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(doc); } },
    };
  });
  const first = await authorize(good, ID);
  assert.equal(first?.status, 200, "the Allow tab is drawn for the app that named itself");
  assert.match(first?.body ?? "", /Example app/);
  assert.match(first?.body ?? "", /names itself by <b>app\.example\.com<\/b>/, "the page shows whose address named it, since its name is its own word");
  assert.equal(reads, 1);
  await authorize(good, ID);
  assert.equal(reads, 1, "the second request does not read the page again");
  hn.clock.t += 3 * 86_400_000;
  await authorize(good, ID);
  await authorize(good, ID);
  await authorize(good, ID);
  assert.equal(reads, 2, "a day later it is read once more, and not again on every request after that");
  // a page that cannot be read: the usual refusal page, never a redirect
  const other = "https://down.example.com/client.json";
  const down = make(async () => {
    throw new Error("address refused");
  });
  const refused = await authorize(down, other);
  assert.equal(refused?.status, 400);
  assert.match(refused?.body ?? "", /not from an app Vyre knows/);
  // a page that names a different address is not trusted
  const liar = make(async () => ({
    ok: true,
    status: 200,
    body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(JSON.stringify({ client_id: "https://x.example.com/c.json", redirect_uris: ["https://app.example.com/cb"] })); } },
  }));
  assert.equal((await authorize(liar, "https://liar.example.com/client.json"))?.status, 400);
});

// one actor naming many apps cannot block another actor's first (lane r42-mcp)
test("authorize: one source that names many apps is stopped after its daily few, and a second source's first is never refused for it", async () => {
  const hn = harness();
  ensure(hn.db);
  const mk = (id: string) =>
    JSON.stringify({ client_id: id, client_name: "App", redirect_uris: [`https://${new URL(id).host}/cb`] });
  const rt = createMcpRuntime({
    db: hn.db,
    space: "spc_sources",
    invoke: (async () => ({ status: "ok", output: {}, traceId: "t" })) as Invoke,
    now: () => hn.clock.t,
    active: () => true,
    endpoint: { url: `${ORIGIN}/mcp`, loopbackUrl: "http://127.0.0.1:1/mcp" },
    clientDocGet: (async (u: string) => ({
      ok: true,
      status: 200,
      body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(mk(u)); } },
    })) as never,
  });
  const ask = (visitor: string, id: string) =>
    rt.oauth({
      method: "GET",
      path: "/oauth/authorize",
      search: `?client_id=${encodeURIComponent(id)}&redirect_uri=${encodeURIComponent(`https://${new URL(id).host}/cb`)}&response_type=code&code_challenge=${challengeOf(VERIFIER)}&code_challenge_method=S256`,
      headers: {},
      body: "",
      origin: ORIGIN,
      visitor,
    });
  const statuses: number[] = [];
  for (let i = 0; i < 25; i++) statuses.push((await ask("evil", `https://spam${i}.junk${i}.example/c.json`))!.status);
  assert.equal(statuses.filter((s) => s === 200).length, 20, "twenty new apps for one source");
  assert.ok(statuses.slice(20).every((s) => s === 429), "then it is stopped");
  assert.equal((await ask("honest", "https://app.honest.example/c.json"))!.status, 200, "another source's first is welcome");
});
