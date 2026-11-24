// The open line to browserd (lane r42-computer, 19 Nov 2026): every browser call used to be one `docker exec` plus a new Node process for `ctl`, 131 ms before the call did anything (box C, Bengaluru).
// With the channel on, the adapter asks browserd once for a key (through `ctl`, so only who can already run `ctl` gets one) and then posts each call to browserd's own port. The rules that keep an act
// from happening twice stay: a call that never reached browserd goes through `ctl` instead; a call that was sent and then lost is an error, never a silent repeat.
import test from "node:test";
import assert from "node:assert/strict";
import type { ContainerConfig, DockerApi } from "../../../sandbox/src/docker.ts";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { createControl } from "../../../images/space-browser/browserd/control.ts";
import { channelAddressOk, createDockerSpaceBrowser, httpChannelPost, NotSent } from "../sbrowser/docker.ts";
import type { ChannelPost } from "../sbrowser/docker.ts";
import { ToolError } from "../handlers/tools/common.ts";

type Exec = { exitCode: number | null; stdout: string; stderr: string };
const ok = (v: unknown): Exec => ({ exitCode: 0, stdout: `${JSON.stringify(v)}\n`, stderr: "" });
const refuse = (code: string, message: string): Exec => ({
  exitCode: 1,
  stdout: "",
  stderr: `${JSON.stringify({ code, message })}\n`,
});

function engine(onCtl: (action: string, body: Record<string, unknown>) => Exec) {
  const execs: string[] = [];
  const running = new Set<string>();
  const api: DockerApi = {
    ping: async () => true,
    imageExists: async () => true,
    async networkCreate() {
      throw new Error("no networks");
    },
    async networkRemove() {
      throw new Error("no networks");
    },
    containerCreate: async (name: string, _c: ContainerConfig) => `id-${name}`,
    async containerStart(id) {
      running.add(id.replace(/^id-/, ""));
    },
    async containerStop(id) {
      running.delete(id);
    },
    async containerRemove(id) {
      running.delete(id);
    },
    containerRunning: async (id) => running.has(id.replace(/^id-/, "")),
    async exec(_name, a) {
      execs.push(String(a.cmd[1]));
      return onCtl(String(a.cmd[1]), JSON.parse(String(a.cmd[2])));
    },
    async putArchive() {},
  };
  return { api, execs };
}

/** The n-th key browserd hands out: as long as a real one (64 characters). */
const KEY = (n: number): string => `key-${n}-`.padEnd(64, "0");
/** browserd as the tests script it: `channel` hands out key-<n> and the address; anything else is a tool's answer. */
function world(o: { channel?: boolean } = {}) {
  let minted = 0;
  const e = engine((action) => {
    if (action === "status") return ok({ profiles: [] });
    if (action === "channel")
      return o.channel === false
        ? refuse("bad_input", "browserd has no action channel.")
        : ok({ key: KEY(++minted), address: "172.30.0.2", port: 7002 });
    return ok({ via: "ctl", action });
  });
  const posts: Array<{ url: string; key: string; action: string }> = [];
  let answer: (key: string, action: string) => Awaited<ReturnType<ChannelPost>> | Error = () => ({
    status: 200,
    body: { ok: true, result: { via: "channel" } },
  });
  const post: ChannelPost = async (a) => {
    posts.push({ url: a.url, key: a.key, action: String(a.body["action"]) });
    const r = answer(a.key, String(a.body["action"]));
    if (r instanceof Error) throw r;
    return r;
  };
  let now = 1_000_000;
  const sb = createDockerSpaceBrowser({
    api: e.api,
    sleep: async () => {},
    channel: { post, now: () => now },
  });
  return {
    sb,
    execs: e.execs,
    posts,
    minted: () => minted,
    answers(f: typeof answer) {
      answer = f;
    },
    tick(ms: number) {
      now += ms;
    },
  };
}
const call = (sb: ReturnType<typeof world>["sb"], tool = "chrome_state") =>
  sb.tool({ profileId: "agt_one", tool, args: {}, timeoutMs: 5000 });

test("with the channel on, a tool call is posted to browserd's own port with the key ctl handed out; no exec per call", async () => {
  const w = world();
  assert.deepEqual(await call(w.sb), { via: "channel" });
  assert.deepEqual(await call(w.sb), { via: "channel" });
  assert.deepEqual(await call(w.sb, "chrome_snapshot"), { via: "channel" });
  // the container's start asks `status`; the key is asked for once; the three calls are three posts and no `tool` exec
  assert.deepEqual(
    w.execs.filter((a) => a !== "status"),
    ["channel"],
  );
  assert.equal(w.posts.length, 3);
  assert.deepEqual(
    w.posts.map((p) => [p.url, p.key, p.action]),
    [
      ["http://172.30.0.2:7002/control", KEY(1), "tool"],
      ["http://172.30.0.2:7002/control", KEY(1), "tool"],
      ["http://172.30.0.2:7002/control", KEY(1), "tool"],
    ],
  );
});

test("a refusal from browserd over the channel is the same typed error as through ctl, with its reason and start", async () => {
  const w = world();
  w.answers(() => ({
    status: 200,
    body: {
      ok: false,
      code: "bad_input",
      message: "Your browser was reopened and its pages reloaded. Take a new snapshot before you click.",
      reason: "browser_reopened",
      start: "abc.2",
    },
  }));
  await assert.rejects(call(w.sb, "chrome_click"), (e: unknown) => {
    assert.ok(e instanceof ToolError);
    assert.equal(e.code, "bad_input");
    assert.equal(e.reason, "browser_reopened");
    assert.equal(e.start, "abc.2");
    assert.match(e.message, /Take a new snapshot/);
    return true;
  });
});

test("browserd restarted and forgot the key: the call was not done, a new key is asked for and the call is sent once more", async () => {
  const w = world();
  await call(w.sb);
  w.answers((key) =>
    key === KEY(1)
      ? { status: 401, body: { ok: false, code: "unavailable", message: "This needs a key." } }
      : { status: 200, body: { ok: true, result: { via: "channel", key } } },
  );
  assert.deepEqual(await call(w.sb, "chrome_click"), { via: "channel", key: KEY(2) });
  assert.equal(w.minted(), 2);
  assert.equal(w.execs.filter((a) => a === "tool").length, 0);
});

test("a call that never reached browserd goes through ctl, and so do the next ones until the channel is tried again", async () => {
  const w = world();
  w.answers(() => new NotSent("connect ECONNREFUSED"));
  assert.deepEqual(await call(w.sb, "chrome_click"), { via: "ctl", action: "tool" });
  const postsAfterFirst = w.posts.length;
  assert.deepEqual(await call(w.sb), { via: "ctl", action: "tool" });
  assert.equal(w.posts.length, postsAfterFirst, "no post while the channel rests");
  // later the channel is tried again, with a new key, and works
  w.answers(() => ({ status: 200, body: { ok: true, result: { via: "channel" } } }));
  w.tick(61_000);
  assert.deepEqual(await call(w.sb), { via: "channel" });
});

test("a call that was sent and then lost is an error and is never sent again, by the channel or by ctl", async () => {
  const w = world();
  await call(w.sb);
  w.answers(() => new Error("socket hang up"));
  const before = w.posts.length;
  await assert.rejects(call(w.sb, "chrome_click"), (e: unknown) => {
    assert.ok(e instanceof ToolError);
    assert.equal(e.code, "unavailable");
    assert.match(e.message, /stopped while it worked on the request/);
    return true;
  });
  assert.equal(w.posts.length, before + 1, "one post, no second try");
  assert.equal(w.execs.filter((a) => a === "tool").length, 0, "and not through ctl either");
});

test("a browserd of an earlier release has no channel: every call goes through ctl as before, and the key is not asked for on every call", async () => {
  const w = world({ channel: false });
  assert.deepEqual(await call(w.sb), { via: "ctl", action: "tool" });
  assert.deepEqual(await call(w.sb), { via: "ctl", action: "tool" });
  assert.equal(w.posts.length, 0);
  assert.equal(w.execs.filter((a) => a === "channel").length, 1);
});

test("without the channel option nothing changes: one exec per call and no key is asked for", async () => {
  const e = engine((action) => (action === "status" ? ok({ profiles: [] }) : ok({ via: "ctl", action })));
  const sb = createDockerSpaceBrowser({ api: e.api, sleep: async () => {} });
  assert.deepEqual(await sb.tool({ profileId: "agt_one", tool: "chrome_state", args: {}, timeoutMs: 5000 }), {
    via: "ctl",
    action: "tool",
  });
  assert.deepEqual(
    e.execs.filter((a) => a !== "status"),
    ["tool"],
  );
});

// ---- the real post, against a real socket ----

test("the real post reaches browserd's control line and brings back its answer; one connection per call", async () => {
  const control = createControl({ dispatch: async (action) => ({ did: action }), asked: () => {} });
  let connections = 0;
  const server = createServer((req, res) => {
    if (!control.handle(req, res)) res.writeHead(404).end();
  });
  server.on("connection", () => (connections += 1));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/control`;
    const post = httpChannelPost();
    const key = control.mint();
    for (let i = 0; i < 3; i++)
      assert.deepEqual(await post({ url, key, body: { action: "status", args: {} }, timeoutMs: 5000 }), {
        status: 200,
        body: { ok: true, result: { did: "status" } },
      });
    assert.equal(connections, 3);
    assert.equal((await post({ url, key: "x".repeat(64), body: { action: "status" }, timeoutMs: 5000 })).status, 401);
  } finally {
    server.close();
  }
});

test("the real post says NotSent when nothing listens, and a plain error when the connection was made and then dropped", async () => {
  // a port nothing listens on: taken, then closed
  const idle = createNetServer();
  await new Promise<void>((r) => idle.listen(0, "127.0.0.1", r));
  const closedPort = (idle.address() as AddressInfo).port;
  await new Promise<void>((r) => idle.close(() => r()));
  const post = httpChannelPost();
  await assert.rejects(
    post({ url: `http://127.0.0.1:${closedPort}/control`, key: "k", body: {}, timeoutMs: 2000 }),
    (e: unknown) => e instanceof NotSent,
  );
  // a server that takes the connection and hangs up without an answer: the call may have been done
  const rude = createNetServer((sock) => {
    sock.once("data", () => sock.destroy());
  });
  await new Promise<void>((r) => rude.listen(0, "127.0.0.1", r));
  try {
    await assert.rejects(
      post({
        url: `http://127.0.0.1:${(rude.address() as AddressInfo).port}/control`,
        key: "k",
        body: {},
        timeoutMs: 2000,
      }),
      (e: unknown) => e instanceof Error && !(e instanceof NotSent),
    );
  } finally {
    rude.close();
  }
});

test("the address browserd names is used only when it is the service's own: inside its subnet, or at least private", () => {
  assert.equal(channelAddressOk("172.30.0.2", 7002, "172.30.0.0/16"), true);
  assert.equal(channelAddressOk("172.31.0.2", 7002, "172.30.0.0/16"), false);
  assert.equal(channelAddressOk("10.1.2.3", 7002, "172.30.0.0/16"), false);
  assert.equal(channelAddressOk("172.17.0.4", 7002, null), true);
  assert.equal(channelAddressOk("192.168.1.9", 7002, null), true);
  assert.equal(channelAddressOk("127.0.0.1", 7002, null), false);
  assert.equal(channelAddressOk("169.254.169.254", 80, null), false);
  assert.equal(channelAddressOk("8.8.8.8", 7002, null), false);
  assert.equal(channelAddressOk("vyre-host", 7002, null), false);
  assert.equal(channelAddressOk("172.30.0.2", 0, "172.30.0.0/16"), false);
  assert.equal(channelAddressOk("172.30.0.2", "7002", "172.30.0.0/16"), false);
  assert.equal(channelAddressOk("999.1.1.1", 7002, null), false);
});

test("browserd naming an address outside its own network is not believed: no key is posted there, ctl carries the call", async () => {
  const e = engine((action) =>
    action === "status"
      ? ok({ profiles: [] })
      : action === "channel"
        ? ok({ key: KEY(1), address: "169.254.169.254", port: 80 })
        : ok({ via: "ctl", action }),
  );
  let posted = 0;
  const sb = createDockerSpaceBrowser({
    api: e.api,
    sleep: async () => {},
    channel: {
      post: async () => {
        posted += 1;
        return { status: 200, body: { ok: true, result: {} } };
      },
    },
  });
  assert.deepEqual(await sb.tool({ profileId: "agt_one", tool: "chrome_state", args: {}, timeoutMs: 5000 }), {
    via: "ctl",
    action: "tool",
  });
  assert.equal(posted, 0);
});
