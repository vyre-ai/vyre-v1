// Vyre for Chrome connected straight to a Space (src/worker/link.js): the pairing state machine, the socket port, and every way the connection can end, against fakes.
import test from "node:test";
import assert from "node:assert/strict";
import { createLink, spaceOrigin, withLink, PENDING_MS } from "../src/worker/link.js";

function area(): any {
  const data: Record<string, any> = {};
  return {
    data,
    get: async (keys: string[]) =>
      Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
    set: async (items: Record<string, any>) => void Object.assign(data, structuredClone(items)),
    remove: async (keys: string[]) => void keys.forEach((k) => delete data[k]),
  };
}

class FakeSocket {
  static all: FakeSocket[] = [];
  sent: any[] = [];
  closed = false;
  handlers: Record<string, ((e: any) => void)[]> = {};
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  addEventListener(t: string, f: (e: any) => void) {
    (this.handlers[t] ??= []).push(f);
  }
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.closed = true;
  }
  emit(t: string, e: any = {}) {
    for (const f of this.handlers[t] ?? []) f(e);
  }
  say(m: any) {
    this.emit("message", { data: JSON.stringify(m) });
  }
}

function world(over: { fetch?: any } = {}) {
  FakeSocket.all = [];
  const local = area();
  const session = area();
  const calls: any[] = [];
  let t = 1_000_000;
  const link = createLink(
    { local, session },
    {
      WebSocket: FakeSocket,
      now: () => t,
      setTimer: () => 0,
      clearTimer: () => {},
      fetch:
        over.fetch ??
        (async (url: string, init: any) => {
          calls.push({ url, body: JSON.parse(init.body) });
          return { ok: true, json: async () => ({ data: { session: { token: "vst_tok" } } }) };
        }),
    },
  );
  return { link, local, session, calls, advance: (ms: number) => (t += ms) };
}

test("a Space address is https, or this computer's own http; anything else is not an address", () => {
  assert.equal(spaceOrigin("team.example.com"), "https://team.example.com");
  assert.equal(spaceOrigin(" https://team.example.com/path?x=1 "), "https://team.example.com");
  assert.equal(spaceOrigin("http://localhost:8787"), "http://localhost:8787");
  for (const bad of [
    "http://team.example.com",
    "ftp://x.example.com",
    "javascript:alert(1)",
    "https://a:b@team.example.com",
    "",
    "localhostx",
    5,
    null,
    "https://" + "a".repeat(400) + ".com",
  ])
    assert.equal(spaceOrigin(bad as any), null, String(bad));
});

test("connecting: only the hash of a kept value goes to the Space's page; the code redeems with the value; the session is kept under one key", async () => {
  const w = world();
  const b = await w.link.begin("team.example.com");
  assert.ok("url" in b);
  const challenge = /#challenge=([0-9a-f]{64})$/.exec((b as any).url)![1];
  assert.match((b as any).url, /^https:\/\/team\.example\.com\/chrome\/connect#/);
  const kept = w.session.data["vyrePendingLink"];
  assert.notEqual(kept.verifier, challenge, "the page sees the hash, never the value");
  const { createHash } = await import("node:crypto");
  assert.equal(createHash("sha256").update(kept.verifier).digest("hex"), challenge);
  const done = await w.link.redeem({ origin: "https://team.example.com", code: "K7P2-9QXA" });
  assert.deepEqual(done.ok, true);
  assert.equal(w.calls[0].url, "https://team.example.com/v1/identity/pair_redeem");
  assert.deepEqual(w.calls[0].body, {
    code: "K7P2-9QXA",
    verifier: kept.verifier,
    deviceName: "Chrome on this computer",
    deviceClass: "extension",
  });
  assert.equal(w.session.data["vyrePendingLink"], undefined, "the value is spent with the code");
  assert.equal(w.local.data["vyreLinks"][0].token, "vst_tok");
  assert.equal(w.link.current()?.address, "https://team.example.com");
  assert.deepEqual(
    await w.link.redeem({ origin: "https://team.example.com", code: "K7P2-9QXA" }),
    { ok: false, why: "nothing_pending" },
    "a second code with no new begin goes nowhere",
  );
});

test("a code from the wrong page, after ten minutes, with nothing pending, or refused by the Space leaves no session", async () => {
  const w = world();
  assert.deepEqual(await w.link.redeem({ origin: "https://team.example.com", code: "AAAA-BBBB" }), {
    ok: false,
    why: "nothing_pending",
  });
  await w.link.begin("team.example.com");
  assert.deepEqual(await w.link.redeem({ origin: "https://evil.example.com", code: "AAAA-BBBB" }), {
    ok: false,
    why: "wrong_page",
  });
  assert.deepEqual(await w.link.redeem({ origin: "https://team.example.com.evil.io", code: "AAAA-BBBB" }), {
    ok: false,
    why: "wrong_page",
  });
  assert.deepEqual(await w.link.redeem({ origin: "https://team.example.com", code: "x".repeat(200) }), {
    ok: false,
    why: "wrong_page",
  });
  assert.equal(w.calls.length, 0, "nothing went to any Space");
  w.advance(PENDING_MS + 1);
  assert.deepEqual(await w.link.redeem({ origin: "https://team.example.com", code: "AAAA-BBBB" }), {
    ok: false,
    why: "expired",
  });
  assert.equal(w.session.data["vyrePendingLink"], undefined, "an expired value is dropped");

  const refused = world({
    fetch: async () => ({ ok: false, json: async () => ({ error: { code: "auth.invalid_code" } }) }),
  });
  await refused.link.begin("team.example.com");
  assert.deepEqual(await refused.link.redeem({ origin: "https://team.example.com", code: "AAAA-BBBB" }), {
    ok: false,
    why: "refused",
  });
  assert.deepEqual(await refused.link.links(), []);
  assert.ok(refused.session.data["vyrePendingLink"], "a refused code can be tried again until the ten minutes pass");

  const down = world({
    fetch: async () => {
      throw new TypeError("network");
    },
  });
  await down.link.begin("team.example.com");
  assert.deepEqual(await down.link.redeem({ origin: "https://team.example.com", code: "AAAA-BBBB" }), {
    ok: false,
    why: "offline",
  });
  assert.deepEqual(await down.link.links(), []);
});

test("a second begin replaces the first, and a begin with a bad address keeps nothing", async () => {
  const w = world();
  await w.link.begin("one.example.com");
  const first = w.session.data["vyrePendingLink"].verifier;
  assert.deepEqual(await w.link.begin("not an address"), { error: "address" });
  assert.equal(w.session.data["vyrePendingLink"].verifier, first, "a bad address changes nothing");
  await w.link.begin("two.example.com");
  assert.equal(w.session.data["vyrePendingLink"].origin, "https://two.example.com");
  assert.deepEqual(await w.link.redeem({ origin: "https://one.example.com", code: "AAAA-BBBB" }), {
    ok: false,
    why: "wrong_page",
  });
});

async function linked(w: ReturnType<typeof world>) {
  await w.link.begin("team.example.com");
  await w.link.redeem({ origin: "https://team.example.com", code: "K7P2-9QXA" });
  return w.link.current()!;
}

test("the socket port: hello first, messages wait for ready, pings are answered and hidden, pushes and answers come through", async () => {
  const w = world();
  const l = await linked(w);
  const port = w.link.openPort(l);
  const got: any[] = [];
  port.onMessage.addListener((m: any) => got.push(m));
  const s = FakeSocket.all[0];
  assert.equal(s.url, "wss://team.example.com/chrome/v1/socket");
  port.postMessage({ id: "r1", type: "bridge", op: "hello", input: {} });
  assert.deepEqual(s.sent, [], "nothing goes before the socket is open");
  s.emit("open");
  assert.deepEqual(s.sent, [{ type: "hello", token: "vst_tok" }]);
  s.say({ type: "ping" });
  assert.deepEqual(s.sent[1], { type: "pong" });
  s.say({ type: "ready", space: { id: "spc_a", name: "Team" }, person: "usr_x" });
  assert.deepEqual(
    s.sent[2],
    { id: "r1", type: "bridge", op: "hello", input: {} },
    "the waiting message goes once the Space says ready",
  );
  port.postMessage({ id: "r2", type: "invoke", capability: "vault.items.match", input: {} });
  assert.equal(s.sent[3].id, "r2");
  s.say({ id: "r2", ok: true, output: { items: [] } });
  s.say({ type: "fill", ref: "w1-aa", value: "v" });
  assert.deepEqual(
    got.map((m) => m.type ?? m.id),
    ["ready", "r2", "fill"],
    "pings never reach the bridge",
  );
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual([w.link.current()!.space, w.link.current()!.name], ["spc_a", "Team"]);
});

test("a signed out or revoked session forgets the link and says so; a lost connection keeps it; a closed port refuses new messages", async () => {
  for (const [code, why] of [
    [4401, "signed_out"],
    [4403, "revoked"],
  ] as const) {
    const w = world();
    const l = await linked(w);
    const seen: any[] = [];
    w.link.onChange((e) => seen.push(e));
    const port = w.link.openPort(l);
    let closed = 0;
    port.onDisconnect.addListener(() => closed++);
    FakeSocket.all[0].emit("close", { code });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(closed, 1);
    assert.equal(w.link.current(), null, "the link is gone: connect again");
    assert.equal(w.local.data["vyreLinks"].length, 0);
    assert.deepEqual(
      seen.map((e) => e.why),
      [why],
    );
    assert.match(w.link.lastError, /connect again|signed out/);
    assert.throws(() => port.postMessage({ id: "x" }), /closed/);
  }
  const w = world();
  const l = await linked(w);
  const port = w.link.openPort(l);
  let closed = 0;
  port.onDisconnect.addListener(() => closed++);
  FakeSocket.all[0].emit("close", { code: 1006 });
  FakeSocket.all[0].emit("close", { code: 1006 });
  assert.equal(closed, 1, "one disconnect, however many close events");
  assert.ok(w.link.current(), "a lost connection keeps the session: the caller reconnects");
  const second = w.link.openPort(l);
  let replaced = 0;
  second.onDisconnect.addListener(() => replaced++);
  FakeSocket.all[1].emit("close", { code: 4000 });
  assert.equal(replaced, 1);
  assert.match(w.link.lastError, /another Chrome window/);
});

test("the Space not answering the hello is a lost connection; signing out here forgets the session", async () => {
  const timers: (() => void)[] = [];
  FakeSocket.all = [];
  const local = area();
  const link = createLink(
    { local },
    {
      WebSocket: FakeSocket,
      setTimer: (f) => timers.push(f),
      clearTimer: () => {},
      fetch: async () => ({ ok: true, json: async () => ({ data: { session: { token: "vst_tok" } } }) }),
    },
  );
  await link.begin("team.example.com");
  await link.redeem({ origin: "https://team.example.com", code: "AAAA-BBBB" });
  const port = link.openPort(link.current()!);
  let closed = 0;
  port.onDisconnect.addListener(() => closed++);
  FakeSocket.all[0].emit("open");
  timers.at(-1)!();
  assert.equal(closed, 1);
  assert.ok(FakeSocket.all[0].closed);
  assert.match(link.lastError, /did not answer/);
  await link.signOut("https://team.example.com");
  assert.equal(link.current(), null);
  assert.deepEqual(await link.links(), []);
});

test("one browser API for the bridge: the Space's socket when connected directly, the native host when not", async () => {
  const w = world();
  const native: any[] = [];
  const ext = {
    runtime: {
      id: "ext",
      lastError: { message: "native says" },
      connectNative: (n: string) => (native.push(n), { native: true }),
    },
  };
  const wrapped: any = withLink(ext, w.link, w.link.current);
  assert.deepEqual(wrapped.runtime.connectNative("run.vyre.bridge"), { native: true });
  assert.equal(wrapped.runtime.lastError.message, "native says");
  await linked(w);
  const port = wrapped.runtime.connectNative("run.vyre.bridge");
  assert.equal(typeof port.postMessage, "function");
  assert.equal(FakeSocket.all.length, 1);
  assert.deepEqual(native, ["run.vyre.bridge"], "the native host was not asked again");
  assert.equal(typeof wrapped.runtime.lastError.message, "string");
  await w.link.signOut("https://team.example.com");
  assert.deepEqual(
    wrapped.runtime.connectNative("run.vyre.bridge"),
    { native: true },
    "signed out: back to the native host",
  );
});

test("the stored session has one shape: a stored value of any other shape is not used", async () => {
  const w = world();
  w.local.data["vyreLinks"] = [{ address: "https://team.example.com", token: "t", space: "", name: "x", extra: 1 }];
  assert.deepEqual(await w.link.links(), []);
  w.local.data["vyreLinks"] = "garbage";
  assert.deepEqual(await w.link.links(), []);
  assert.equal(w.link.current(), null);
});

test("the extension updates or the worker sleeps mid-session: a pairing in progress and a linked Space both survive the restart", async () => {
  const w = world();
  await w.link.begin("team.example.com");
  // a new worker over the same storage (an update, or the worker slept and woke): the unfinished pairing is still there and can finish
  const woke = createLink(
    { local: w.local, session: w.session },
    {
      WebSocket: FakeSocket,
      now: () => 1_000_000,
      fetch: async () => ({ ok: true, json: async () => ({ data: { session: { token: "vst_after" } } }) }) as any,
    },
  );
  assert.equal((await woke.redeem({ origin: "https://team.example.com", code: "AAAA-BBBB" })).ok, true);
  // and a worker that wakes later finds the linked Space before anything asks
  const later = createLink({ local: w.local, session: w.session }, { WebSocket: FakeSocket });
  assert.equal(later.current(), null, "memory is empty until it reads");
  await later.refresh();
  assert.equal(later.current()?.token, "vst_after");
  // storage cleared by the person (site data cleared): not linked, and nothing throws
  await w.local.remove(["vyreLinks"]);
  await later.refresh();
  assert.equal(later.current(), null);
});
