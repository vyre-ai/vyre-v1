// A watching app on a booted Space (lane r42-mcp, 19 Nov 2026): a client holds subscriptions/listen open over real HTTP, hears of a task assigned to its person, does not hear of one assigned to someone else, and its
// stream ends at once when the person removes the app. The same for the GET stream of the handshake revisions.
import assert from "node:assert/strict";
import http from "node:http";
import { expectStatus } from "../golden/steps/02-space.ts";
import { Client, signIn, withOutsideSpace as withSpace } from "./support/outside-client.ts";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const V = "2026-07-28";

/** A request whose answer stays open: every `data:` line is kept as it arrives. */
function open(url: string, o: { method: string; headers: Record<string, string>; body?: string }) {
  const messages: Json[] = [];
  let status = 0;
  let ended = false;
  let contentType = "";
  const u = new URL(url);
  const req = http.request(
    { host: u.hostname, port: u.port, path: u.pathname, method: o.method, headers: o.headers },
    (res) => {
      status = res.statusCode ?? 0;
      contentType = String(res.headers["content-type"] ?? "");
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => {
        buf += c;
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const d = frame.split("\n").find((l) => l.startsWith("data: "));
          if (d) messages.push(JSON.parse(d.slice(6)));
        }
      });
      res.on("end", () => void (ended = true));
      res.on("close", () => void (ended = true));
    },
  );
  req.on("error", () => void (ended = true));
  req.end(o.body);
  const until = async (f: () => boolean, ms = 6000): Promise<boolean> => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      if (f()) return true;
      await new Promise((r) => setTimeout(r, 40));
    }
    return f();
  };
  return {
    messages,
    status: () => status,
    contentType: () => contentType,
    ended: () => ended,
    until,
    close: () => req.destroy(),
  };
}

const updated = (m: Json[]): string[] =>
  m.filter((x) => x.method === "notifications/resources/updated").map((x) => x.params.uri as string);

withSpace(
  "an app holds a listen stream open: it hears of a task assigned to its person, not of one assigned elsewhere, and the stream ends when the person removes the app",
  async (s, owner, mcp) => {
    const c = new Client(mcp);
    const { agentId } = await signIn(s, c, owner);
    const stream = open(mcp, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${c.token}`,
        "mcp-protocol-version": V,
        "mcp-method": "subscriptions/listen",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "subscriptions/listen",
        params: {
          notifications: { resourceSubscriptions: ["vyre://tasks/mine"], promptsListChanged: true },
          _meta: {
            "io.modelcontextprotocol/protocolVersion": V,
            "io.modelcontextprotocol/clientInfo": { name: "Claude Code", version: "3" },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });
    assert.ok(await stream.until(() => stream.messages.length > 0), "the acknowledgment arrives first");
    assert.equal(stream.status(), 200);
    assert.match(stream.contentType(), /text\/event-stream/);
    assert.equal(stream.messages[0].method, "notifications/subscriptions/acknowledged");
    assert.deepEqual(stream.messages[0].params.notifications.resourceSubscriptions, ["vyre://tasks/mine"]);

    // a task for someone else (the app itself) does not reach it
    expectStatus(
      await s.call("tasks.create", owner, {
        title: "For the app",
        assigned: { kind: "agent", id: agentId },
        idempotencyKey: "w-other",
      }),
      200,
      "tasks.create",
    );
    await s.d.hooks?.pump?.();
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(updated(stream.messages), [], "a task not assigned to its person is not told");

    // a task assigned to the person is
    expectStatus(
      await s.call("tasks.create", owner, {
        title: "For the person",
        assigned: { kind: "person", id: "usr_olivia" },
        idempotencyKey: "w-mine",
      }),
      200,
      "tasks.create",
    );
    await s.d.hooks?.pump?.();
    assert.ok(
      await stream.until(() => updated(stream.messages).length > 0),
      JSON.stringify(stream.messages).slice(0, 600),
    );
    assert.deepEqual(updated(stream.messages), ["vyre://tasks/mine"]);
    assert.equal(stream.messages.at(-1).params._meta["io.modelcontextprotocol/subscriptionId"], 5);

    // removing the app ends the stream with a closing answer
    expectStatus(await s.call("mcp.connected.remove", owner, { agentId }), 200, "mcp.connected.remove");
    assert.ok(await stream.until(() => stream.ended(), 8000), "the stream ended");
    assert.equal(stream.messages.at(-1).id, 5, "with the answer to the request that opened it");
    assert.equal(stream.messages.at(-1).result.resultType, "complete");
    stream.close();
  },
);

withSpace(
  "a client of the handshake revisions subscribes and holds the GET stream: it hears of what it asked for, and a refused sign-in never opens one",
  async (s, owner, mcp) => {
    const c = new Client(mcp);
    await signIn(s, c, owner);
    await c.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-code", version: "2.1" },
    });
    const sub = await c.rpc("resources/subscribe", { uri: "vyre://tasks/mine" });
    assert.deepEqual(sub.json.result, {});
    const stream = open(mcp, {
      method: "GET",
      headers: { accept: "text/event-stream", authorization: `Bearer ${c.token}`, "mcp-session-id": c.session },
    });
    assert.ok(await stream.until(() => stream.status() === 200));
    assert.match(stream.contentType(), /text\/event-stream/);
    expectStatus(
      await s.call("tasks.create", owner, {
        title: "Mine",
        assigned: { kind: "person", id: "usr_olivia" },
        idempotencyKey: "w-legacy",
      }),
      200,
      "tasks.create",
    );
    await s.d.hooks?.pump?.();
    assert.ok(
      await stream.until(() => updated(stream.messages).length > 0),
      JSON.stringify(stream.messages).slice(0, 400),
    );
    assert.deepEqual(updated(stream.messages), ["vyre://tasks/mine"]);
    stream.close();
    const refused = open(mcp, {
      method: "GET",
      headers: { accept: "text/event-stream", authorization: "Bearer nope" },
    });
    assert.ok(await refused.until(() => refused.status() !== 0));
    assert.equal(refused.status(), 401);
    refused.close();
  },
);
