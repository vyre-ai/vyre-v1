// Watching (lane r42-mcp, 19 Nov 2026): the stream an app keeps open, who it is told, and every way it ends. An app hears only of addresses it asked for, only after a read made as that app passes, only
// while its sign-in stands; a dropped line, a removed app, a flood of streams and a refused read each end cleanly and leave nothing open.
import test from "node:test";
import assert from "node:assert/strict";
import { createMcpServer } from "../../../agent/src/mcp/index.ts";
import type { McpCaller, McpHttpResponse } from "../../../agent/src/mcp/index.ts";
import { changeOf, WATCHED_EVENTS } from "../../../agent/src/mcp/watch.ts";
import { fakeInvoke, loadGenerated } from "../../../agent/src/tools/harness.ts";

const g = loadGenerated();
const V = "2026-07-28";
const imran: McpCaller = {
  kind: "outside",
  sessionId: "ses_out",
  space: "spc_1",
  principal: { kind: "agent", id: "agt_cc" },
  actingFor: "usr_imran",
};
const META = {
  "io.modelcontextprotocol/protocolVersion": V,
  "io.modelcontextprotocol/clientInfo": { name: "Cursor", version: "3.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function rig(opts: { refuseReads?: boolean; keepAliveMs?: number } = {}) {
  const fake = fakeInvoke(g.caps);
  let signedIn = true;
  const reads: string[] = [];
  const server = createMcpServer({
    catalog: g.catalog,
    defaults: g.defaults,
    invoke: async (cap, input, seed) => {
      reads.push(cap);
      if (opts.refuseReads && /\.(get|read)$/.test(cap)) throw new Error("forbidden");
      return fake.invoke(cap, input, seed);
    },
    info: { name: "vyre", version: "1.0.0" },
    open: async (token) => (token === "out" && signedIn ? imran : null),
    ...(opts.keepAliveMs ? { keepAliveMs: opts.keepAliveMs } : {}),
  });
  /** Open a listen stream; `lines` collects every notification as it is written. */
  async function listen(params: Record<string, unknown>, id = 1) {
    const r = await server.handle({
      method: "POST",
      headers: { authorization: "Bearer out", "mcp-protocol-version": V, "mcp-method": "subscriptions/listen" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method: "subscriptions/listen", params: { ...params, _meta: META } }),
    });
    return open(r);
  }
  function open(r: McpHttpResponse) {
    const lines: any[] = [];
    let drop: () => void = () => undefined;
    const closed = new Promise<void>((res) => {
      drop = res;
    });
    let done = false;
    const finished = r.stream
      ? r.stream({
          write: (c) => {
            for (const m of c.split("\n\n")) {
              const d = m.split("\n").find((l) => l.startsWith("data: "));
              if (d) lines.push(JSON.parse(d.slice(6)));
              else if (m.startsWith(":")) lines.push({ keepAlive: true });
            }
          },
          closed,
        }).then(() => {
          done = true;
        })
      : Promise.resolve();
    return { r, lines, drop, finished, isDone: () => done };
  }
  return { server, listen, open, reads, signOut: () => (signedIn = false) };
}

const updated = (l: any[]) => l.filter((m) => m.method === "notifications/resources/updated").map((m) => m.params.uri);

test("a listen stream acknowledges first, names only the addresses that are this server's, and tells the app of a change it asked for", async () => {
  const r = rig();
  const s = await r.listen({
    notifications: { resourceSubscriptions: ["vyre://records/company", "https://elsewhere.example/x", "vyre://task/tsk_1"] },
  });
  assert.equal(s.r.status, 200);
  assert.match(s.r.headers["content-type"] ?? "", /text\/event-stream/);
  assert.equal(r.server.listeners(), 1);
  assert.equal(s.lines[0].method, "notifications/subscriptions/acknowledged");
  assert.deepEqual(s.lines[0].params.notifications.resourceSubscriptions, ["vyre://records/company", "vyre://task/tsk_1"]);
  const n = await r.server.changed(changeOf("record.updated", { type: "company", recordId: "rec_a1" })!);
  assert.equal(n, 1);
  assert.deepEqual(updated(s.lines), ["vyre://records/company"], "the record's own address was not asked for, so it is not sent");
  assert.equal(s.lines.at(-1).params._meta["io.modelcontextprotocol/subscriptionId"], 1);
  s.drop();
  await s.finished;
  assert.equal(r.server.listeners(), 0, "a dropped line leaves nothing open");
});

test("an app hears of nothing it did not ask for, and nothing when the read that proves it may see the thing is refused", async () => {
  const r = rig();
  const s = await r.listen({ notifications: { resourceSubscriptions: ["vyre://task/tsk_9"] } });
  assert.equal(await r.server.changed(changeOf("task.updated", { taskId: "tsk_other" })!), 0);
  assert.equal(await r.server.changed(changeOf("run.succeeded", { runId: "run_1" })!), 0);
  assert.equal(await r.server.changed(changeOf("task.updated", { taskId: "tsk_9" })!), 1);
  s.drop();
  await s.finished;
  const denied = rig({ refuseReads: true });
  const d = await denied.listen({ notifications: { resourceSubscriptions: ["vyre://task/tsk_9"] } });
  assert.equal(await denied.server.changed(changeOf("task.updated", { taskId: "tsk_9" })!), 0, "an app that cannot read it hears nothing");
  assert.deepEqual(updated(d.lines), []);
  d.drop();
  await d.finished;
});

test("a task assigned to the person reaches only the apps acting for that person on vyre://tasks/mine", async () => {
  const r = rig();
  const mine = await r.listen({ notifications: { resourceSubscriptions: ["vyre://tasks/mine"] } });
  assert.equal(await r.server.changed(changeOf("task.assigned", { taskId: "tsk_1", to: "usr_other" })!), 0);
  assert.equal(await r.server.changed(changeOf("task.assigned", { taskId: "tsk_1", to: { id: "usr_imran" } })!), 1);
  assert.deepEqual(updated(mine.lines), ["vyre://tasks/mine"]);
  mine.drop();
  await mine.finished;
});

test("skills added or removed tell the apps that asked, and no one else", async () => {
  const r = rig();
  const yes = await r.listen({ notifications: { promptsListChanged: true } }, 1);
  const no = await r.listen({ notifications: { resourceSubscriptions: ["vyre://types"] } }, 2);
  assert.equal(await r.server.changed(changeOf("skill.added", { name: "x" })!), 1);
  assert.equal(yes.lines.filter((m) => m.method === "notifications/prompts/list_changed").length, 1);
  assert.equal(no.lines.filter((m) => m.method === "notifications/prompts/list_changed").length, 0);
  yes.drop();
  no.drop();
  await Promise.all([yes.finished, no.finished]);
});

test("a stream ends at once when the sign-in is gone, and says so with a closing answer; a refused sign-in never opens one", async () => {
  const r = rig({ keepAliveMs: 15 });
  const s = await r.listen({ notifications: { resourceSubscriptions: ["vyre://types"] } }, 7);
  r.signOut();
  await Promise.race([s.finished, wait(500)]);
  assert.ok(s.isDone(), "ended by its own check");
  assert.equal(s.lines.at(-1).id, 7);
  assert.equal(s.lines.at(-1).result.resultType, "complete");
  assert.equal(r.server.listeners(), 0);
  const late = await r.server.handle({
    method: "POST",
    headers: { authorization: "Bearer out", "mcp-protocol-version": V, "mcp-method": "subscriptions/listen" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "subscriptions/listen", params: { notifications: {}, _meta: META } }),
  });
  assert.equal(late.status, 401);
  assert.equal(late.stream, undefined);
});

test("a changed app removed from the host (end) closes its streams; one app holds at most eight", async () => {
  const r = rig();
  const streams = [];
  for (let i = 1; i <= 8; i++) streams.push(await r.listen({ notifications: { promptsListChanged: true } }, i));
  const ninth = await r.server.handle({
    method: "POST",
    headers: { authorization: "Bearer out", "mcp-protocol-version": V, "mcp-method": "subscriptions/listen" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "subscriptions/listen", params: { notifications: {}, _meta: META } }),
  });
  assert.equal(ninth.status, 429);
  assert.equal(r.server.listeners(), 8);
  assert.equal(r.server.end(imran.sessionId), true);
  await Promise.race([Promise.all(streams.map((s) => s.finished)), wait(500)]);
  assert.ok(streams.every((s) => s.isDone()));
  assert.equal(r.server.listeners(), 0);
});

test("a listen request that is malformed is refused with a reason, not hung", async () => {
  const r = rig();
  const bad = await r.server.handle({
    method: "POST",
    headers: { authorization: "Bearer out", "mcp-protocol-version": V, "mcp-method": "subscriptions/listen" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "subscriptions/listen", params: { notifications: [], _meta: META } }),
  });
  assert.equal(bad.stream, undefined);
  assert.equal(JSON.parse(bad.body).error.code, -32602);
});

test("the GET stream of the handshake revisions is told about what the app subscribed to, and only that", async () => {
  const r = rig();
  const post = (body: unknown, extra: Record<string, string> = {}) =>
    r.server.handle({
      method: "POST",
      headers: { authorization: "Bearer out", "content-type": "application/json", ...extra },
      body: JSON.stringify(body),
    });
  const init = await post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Claude", version: "1" } },
  });
  const sid = init.headers["mcp-session-id"]!;
  assert.ok(sid);
  const sub = await post(
    { jsonrpc: "2.0", id: 2, method: "resources/subscribe", params: { uri: "vyre://task/tsk_1" } },
    { "mcp-session-id": sid, "mcp-protocol-version": "2025-06-18" },
  );
  assert.deepEqual(JSON.parse(sub.body).result, {});
  const bad = await post(
    { jsonrpc: "2.0", id: 3, method: "resources/subscribe", params: { uri: "https://x.example/" } },
    { "mcp-session-id": sid, "mcp-protocol-version": "2025-06-18" },
  );
  assert.equal(JSON.parse(bad.body).error.code, -32002, "an address that is not ours is refused, so the client knows");
  const get = await r.server.handle({
    method: "GET",
    headers: { authorization: "Bearer out", accept: "text/event-stream", "mcp-session-id": sid },
  });
  assert.equal(get.status, 200);
  const s = r.open(get);
  assert.equal(await r.server.changed(changeOf("task.updated", { taskId: "tsk_2" })!), 0);
  assert.equal(await r.server.changed(changeOf("task.updated", { taskId: "tsk_1" })!), 1);
  assert.deepEqual(updated(s.lines), ["vyre://task/tsk_1"]);
  s.drop();
  await s.finished;
  assert.equal(r.server.listeners(), 0);
  const noAuth = await r.server.handle({ method: "GET", headers: { accept: "text/event-stream" } });
  assert.equal(noAuth.status, 401);
});

test("changeOf carries only ids: never a title, a field or a name; an event with no usable id is nobody's", () => {
  for (const name of WATCHED_EVENTS) assert.ok(typeof name === "string");
  const c = changeOf("task.assigned", { taskId: "tsk_1", title: "Secret merger", to: "usr_a" })!;
  assert.ok(!JSON.stringify(c).includes("Secret"));
  assert.equal(changeOf("task.updated", { taskId: "not an id; DROP" }), null);
  assert.equal(changeOf("record.created", { type: "Bad Type", recordId: "rec_1" }), null);
  assert.equal(changeOf("space.renamed", {}), null);
  assert.deepEqual(changeOf("skill.removed", {}), { prompts: true });
});

test("one change that shows as several events is announced once to the same app within a moment", async () => {
  const r = rig();
  const s = await r.listen({ notifications: { resourceSubscriptions: ["vyre://task/tsk_1"] } });
  const first = await r.server.changed(changeOf("task.created", { taskId: "tsk_1" })!);
  const second = await r.server.changed(changeOf("task.assigned", { taskId: "tsk_1", to: "usr_imran" })!);
  assert.equal(first, 1);
  assert.equal(second, 0, "the second event in the same moment is not a second announcement");
  assert.deepEqual(updated(s.lines), ["vyre://task/tsk_1"]);
  s.drop();
  await s.finished;
});
