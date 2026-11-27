// The terminal stream's relay (rc.44): the ticket comes as the first message and never in the address, a good ticket joins the terminal's watcher and gets its numbered changes, a bad one or a silent socket is
// refused and closed, ping is answered, resync reaches the watcher, a view ends when its person loses access or the socket closes. A real HTTP server and the platform's WebSocket client.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createTerminalStream } from "../src/routes/terminal-stream.ts";
import type { TerminalOpened } from "../src/routes/terminal-stream.ts";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function rig(o: { good?: string; helloMs?: number } = {}) {
  const calls: Array<{ terminalId: string; ticket: string; since: number | undefined }> = [];
  const events: string[] = [];
  const ts = createTerminalStream({
    helloMs: o.helloMs ?? 5000,
    open: async (terminalId, ticket, since, send) => {
      calls.push({ terminalId, ticket, since });
      if (ticket !== (o.good ?? "good")) return null;
      send(JSON.stringify({ t: "screen", rev: 1, text: "$ " }));
      const opened: TerminalOpened = {
        personId: "usr_a",
        stop: () => void events.push("stop"),
        resync: () => {
          events.push("resync");
          send(JSON.stringify({ t: "screen", rev: 2, text: "$ " }));
        },
      };
      return opened;
    },
  });
  const server = http.createServer();
  server.on("upgrade", (req, socket, head) => {
    if (ts.claims(req)) ts.upgrade(req, socket, head);
    else socket.destroy();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const client = (path = "/terminals/trm_abc123/ws") => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    const got: string[] = [];
    let closed = false;
    ws.onmessage = (e) => void got.push(String(e.data));
    ws.onclose = () => void (closed = true);
    const opened = new Promise<void>((r) => (ws.onopen = () => r()));
    return { ws, got, opened, closed: () => closed };
  };
  return { ts, calls, events, client, close: () => server.close() };
}

test("the ticket is the first message, never the address; a good one gets the first screen, pong, and a resync", async () => {
  const r = await rig();
  const c = r.client();
  await c.opened;
  c.ws.send(JSON.stringify({ t: "hello", ticket: "good", rev: 7 }));
  await sleep(60);
  assert.deepEqual(r.calls, [{ terminalId: "trm_abc123", ticket: "good", since: 7 }]);
  assert.equal(JSON.parse(c.got[0]!).t, "screen");
  c.ws.send(JSON.stringify({ t: "ping", seq: 5 }));
  c.ws.send(JSON.stringify({ t: "resync" }));
  await sleep(60);
  assert.ok(c.got.includes(JSON.stringify({ t: "pong", seq: 5 })));
  assert.deepEqual(r.events, ["resync"]);
  assert.equal(r.ts.views(), 1);
  c.ws.close();
  await sleep(60);
  assert.deepEqual(r.events, ["resync", "stop"], "a closed socket leaves the watcher");
  assert.equal(r.ts.views(), 0);
  r.close();
});

test("a ticket in the address is not looked at: the view still waits for the first message", async () => {
  const r = await rig();
  const c = r.client("/terminals/trm_abc123/ws?ticket=good");
  await c.opened;
  await sleep(60);
  assert.deepEqual(r.calls, [], "nothing was spent from the address");
  c.ws.send(JSON.stringify({ t: "hello", ticket: "good" }));
  await sleep(60);
  assert.deepEqual(r.calls, [{ terminalId: "trm_abc123", ticket: "good", since: undefined }]);
  c.ws.close();
  r.close();
});

test("a bad ticket is refused with a reason and the socket closes; so is a view that sends nothing", async () => {
  const r = await rig({ helloMs: 150 });
  const bad = r.client();
  await bad.opened;
  bad.ws.send(JSON.stringify({ t: "hello", ticket: "nope" }));
  await sleep(80);
  assert.equal(JSON.parse(bad.got[0]!).t, "refused");
  assert.equal(bad.closed(), true);
  const quiet = r.client();
  await quiet.opened;
  await sleep(300);
  assert.equal(JSON.parse(quiet.got[0]!).t, "refused");
  assert.equal(quiet.closed(), true);
  assert.equal(r.ts.views(), 0);
  r.close();
});

test("a person who loses access has their views ended at once; a path that is not a terminal is not claimed", async () => {
  const r = await rig();
  const c = r.client();
  await c.opened;
  c.ws.send(JSON.stringify({ t: "hello", ticket: "good" }));
  await sleep(60);
  assert.equal(r.ts.endPerson("usr_other"), 0);
  assert.equal(r.ts.endPerson("usr_a"), 1);
  await sleep(60);
  assert.equal(c.closed(), true);
  assert.ok(r.events.includes("stop"));
  assert.equal(r.ts.claims({ url: "/browsers/agt_1/ws" } as http.IncomingMessage), false);
  assert.equal(r.ts.claims({ url: "/terminals/not-an-id/ws" } as http.IncomingMessage), false);
  r.close();
});

test("when the Space stops every view ends at once, so viewers open again instead of waiting for a dead connection", async () => {
  const r = await rig();
  const a = r.client();
  const b = r.client();
  await a.opened;
  await b.opened;
  a.ws.send(JSON.stringify({ t: "hello", ticket: "good" }));
  await sleep(60);
  b.ws.send(JSON.stringify({ t: "hello", ticket: "good" }));
  await sleep(60);
  assert.equal(r.ts.endAll(), 2);
  await sleep(80);
  assert.equal(a.closed(), true);
  assert.equal(b.closed(), true);
  assert.equal(r.events.filter((e) => e === "stop").length, 2);
  r.close();
});
