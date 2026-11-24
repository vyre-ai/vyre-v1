// browserd's side of the open line (images/space-browser/browserd/control.ts): POST /control on its own port answers the same actions as `ctl`, for a caller that holds a key `ctl` handed out.
// Every agent's pages share the container's loopback with this port, so the door is tested as a page would try it: no key, a wrong key, a request that names an Origin (every browser page does).
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createControl } from "../../../images/space-browser/browserd/control.ts";
import { AgentError } from "../../../images/agent-computer/agentd/errors.ts";

async function serve(dispatch: (action: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>) {
  let asked = 0;
  const control = createControl({ dispatch, asked: () => (asked += 1), maxBody: 2000 });
  const server = createServer((req, res) => {
    if (!control.handle(req, res)) res.writeHead(404).end("Not found.\n");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/control`;
  const post = async (headers: Record<string, string>, body: unknown) => {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  return { control, post, url, asked: () => asked, close: () => server.close() };
}

test("a caller with a key ctl handed out gets the action's answer; browserd counts it as being asked", async () => {
  const seen: unknown[] = [];
  const s = await serve(async (action, args) => {
    seen.push([action, args]);
    return { url: "https://northwind.example/", n: 1 };
  });
  try {
    const key = s.control.mint();
    const r = await s.post({ "x-vyre-control": key }, { action: "tool", args: { profileId: "agt_one" } });
    assert.deepEqual(r, { status: 200, body: { ok: true, result: { url: "https://northwind.example/", n: 1 } } });
    assert.deepEqual(seen, [["tool", { profileId: "agt_one" }]]);
    assert.equal(s.asked(), 1);
  } finally {
    s.close();
  }
});

test("no key, a wrong key and a key of the wrong length are refused with 401 and nothing is done", async () => {
  let done = 0;
  const s = await serve(async () => {
    done += 1;
    return {};
  });
  try {
    const key = s.control.mint();
    for (const headers of [{}, { "x-vyre-control": "nope" }, { "x-vyre-control": key.slice(0, -1) + "0x" }]) {
      const r = await s.post(headers as Record<string, string>, { action: "status", args: {} });
      assert.equal(r.status, 401);
      assert.equal(r.body["ok"], false);
    }
    assert.equal(done, 0);
    assert.equal(s.asked(), 0);
  } finally {
    s.close();
  }
});

test("a request that names an Origin is a page's, and is refused even with a good key", async () => {
  let done = 0;
  const s = await serve(async () => {
    done += 1;
    return {};
  });
  try {
    const key = s.control.mint();
    const r = await s.post({ "x-vyre-control": key, origin: "https://evil.example" }, { action: "status", args: {} });
    assert.equal(r.status, 403);
    assert.equal(done, 0);
  } finally {
    s.close();
  }
});

test("a refusal keeps its code, reason and start, exactly as ctl prints it", async () => {
  const s = await serve(async () => {
    const e = new AgentError("bad_input", "Take a new snapshot before you click.", "browser_reopened");
    e.start = "boot.3";
    throw e;
  });
  try {
    const r = await s.post({ "x-vyre-control": s.control.mint() }, { action: "tool", args: {} });
    assert.deepEqual(r, {
      status: 200,
      body: {
        ok: false,
        code: "bad_input",
        message: "Take a new snapshot before you click.",
        reason: "browser_reopened",
        start: "boot.3",
      },
    });
  } finally {
    s.close();
  }
});

test("an error that is not a refusal is `unavailable`, never a crash; a body that is not JSON or is too large is refused", async () => {
  const s = await serve(async () => {
    throw new Error("the pipe closed");
  });
  try {
    const key = s.control.mint();
    const a = await s.post({ "x-vyre-control": key }, { action: "tool", args: {} });
    assert.deepEqual(a.body, { ok: false, code: "unavailable", message: "the pipe closed" });
    const b = await s.post({ "x-vyre-control": key }, "not json");
    assert.equal(b.status, 400);
    const c = await s.post({ "x-vyre-control": key }, { action: "tool", args: { pad: "x".repeat(3000) } });
    assert.equal(c.status, 413);
  } finally {
    s.close();
  }
});

test("only the newest few keys are kept: a daemon that asks again and again does not grow the list", () => {
  const control = createControl({ dispatch: async () => ({}), asked: () => {}, maxKeys: 3 });
  const keys = [control.mint(), control.mint(), control.mint(), control.mint()];
  assert.equal(new Set(keys).size, 4);
  assert.equal(control.has(keys[0]!), false);
  assert.deepEqual(
    keys.slice(1).map((k) => control.has(k)),
    [true, true, true],
  );
});
