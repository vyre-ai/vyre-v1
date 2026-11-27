// The terminal screen on the stream (rc.44): the ticket is the first message and not in the address, the screen is built from the numbered changes, a socket that closes opens again by itself with a new ticket and
// the number the screen has, and a Space that does not stream (or refuses twice) leaves the screen on the poll it had. A fake WebSocket and a fake `call`; nothing is polled while the stream works.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { TmuxScreen, xtermLoader } from "./TmuxScreen.tsx";

xtermLoader.load = null;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const meta = { cols: 80, rows: 24, cursor: null, history: 0, hidden: false };

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  sent: Array<Record<string, unknown>> = [];
  constructor(public url: string) {
    FakeSocket.all.push(this);
    setTimeout(() => this.onopen?.(), 0);
  }
  send(s: string): void {
    this.sent.push(JSON.parse(s) as Record<string, unknown>);
  }
  close(): void {}
  say(m: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

function install() {
  const g = globalThis as Record<string, unknown>;
  const had = g["WebSocket"];
  FakeSocket.all = [];
  g["WebSocket"] = FakeSocket;
  return () => {
    if (had === undefined) delete g["WebSocket"];
    else g["WebSocket"] = had;
  };
}

function rig(o: { stream?: "ok" | "none" | "refuse" | "no_stream" } = {}) {
  const calls: string[] = [];
  let tickets = 0;
  const call = async (cap: string): Promise<unknown> => {
    calls.push(cap);
    if (cap === "terminal.stream") {
      if (o.stream === "none") return {};
      if (o.stream === "no_stream")
        throw Object.assign(new Error("no screen"), { code: "validation.precondition_failed" });
      return { ws: "/terminals/trm_1/ws", ticket: `tk${++tickets}`, expiresAt: Date.now() + 60_000 };
    }
    // the poll answers once and then says the terminal ended, so its loop stops and the test process can end
    if (cap === "terminal.capture") {
      if (calls.filter((c) => c === "terminal.capture").length > 1)
        throw Object.assign(new Error("gone"), { code: "validation.not_found" });
      return { text: "polled screen", ...meta };
    }
    return {};
  };
  return { call, calls };
}

test("the stream: the ticket is the first message and not in the address; the screen is the screen message plus the diffs; nothing is polled", async () => {
  const restore = installDom();
  const back = install();
  try {
    const r = rig();
    const root = await mount(
      createRoot,
      <TmuxScreen call={r.call} terminalId="trm_1" keys={false} spaceUrl="http://s" />,
    );
    await flush();
    await sleep(20);
    const s = FakeSocket.all[0]!;
    assert.equal(s.url, "ws://s/terminals/trm_1/ws", "no ticket in the address");
    assert.deepEqual(s.sent[0], { t: "hello", ticket: "tk1" }, "the ticket is the first message, with no number yet");
    s.say({ t: "screen", rev: 1, text: "$ ls\na\n$ ", ...meta });
    await flush();
    assert.match(textOf(find(root, "terminal-screen")), /\$ ls/);
    s.say({ t: "diff", rev: 2, base: 1, top: 0, at: 2, drop: 1, ins: ["$ echo hi"], ...meta });
    await flush();
    assert.match(textOf(find(root, "terminal-screen")), /\$ echo hi/);
    assert.ok(!r.calls.includes("terminal.capture"), "the stream carries the screen: no poll");
  } finally {
    back();
    restore();
  }
});

test("a socket that closes is opened again by itself with a new ticket and the number the screen has, and the screen says Reconnecting meanwhile", async () => {
  const restore = installDom();
  const back = install();
  try {
    const r = rig();
    const root = await mount(
      createRoot,
      <TmuxScreen call={r.call} terminalId="trm_1" keys={false} spaceUrl="http://s" />,
    );
    await flush();
    await sleep(20);
    FakeSocket.all[0]!.say({ t: "screen", rev: 4, text: "a\nb", ...meta });
    await flush();
    FakeSocket.all[0]!.onclose?.();
    await flush();
    assert.match(textOf(find(root, "terminal-screen-state")), /Reconnecting/);
    await sleep(700);
    await flush();
    const again = FakeSocket.all[1]!;
    assert.ok(again, "a new socket");
    assert.deepEqual(again.sent[0], { t: "hello", ticket: "tk2", rev: 4 }, "a new ticket, and where it left off");
    again.say({ t: "ok", rev: 4 });
    await flush();
    assert.equal(find(root, "terminal-screen-state"), null, "the line goes when it is back");
  } finally {
    back();
    restore();
  }
});

test("a diff that does not follow asks for the whole screen; a Space that does not stream leaves the screen on the poll", async () => {
  const restore = installDom();
  const back = install();
  try {
    const r = rig();
    await mount(createRoot, <TmuxScreen call={r.call} terminalId="trm_1" keys={false} spaceUrl="http://s" />);
    await flush();
    await sleep(20);
    const s = FakeSocket.all[0]!;
    s.say({ t: "screen", rev: 1, text: "a", ...meta });
    s.say({ t: "diff", rev: 5, base: 4, top: 0, at: 1, drop: 0, ins: ["x"], ...meta });
    await flush();
    assert.deepEqual(s.sent.at(-1), { t: "resync" });
    const none = rig({ stream: "none" });
    const root2 = await mount(
      createRoot,
      <TmuxScreen call={none.call} terminalId="trm_2" keys={false} spaceUrl="http://s" />,
    );
    await flush();
    await sleep(300);
    await flush();
    assert.ok(none.calls.includes("terminal.capture"), "it polls");
    assert.match(textOf(find(root2, "terminal-screen")), /polled screen/);
  } finally {
    back();
    restore();
  }
});

test("a host that captures a screen but does not stream one keeps the screen and polls it: a refused stream is not a terminal without a screen", async () => {
  const restore = installDom();
  const back = install();
  try {
    const r = rig({ stream: "no_stream" });
    let unsupported = 0;
    const root = await mount(
      createRoot,
      <TmuxScreen
        call={r.call}
        terminalId="trm_3"
        keys={false}
        spaceUrl="http://s"
        onUnsupported={() => unsupported++}
      />,
    );
    await flush();
    await sleep(300);
    await flush();
    assert.equal(unsupported, 0, "the screen is not given up for the line terminal");
    assert.ok(r.calls.includes("terminal.capture"), "it polls");
    assert.match(textOf(find(root, "terminal-screen")), /polled screen/);
  } finally {
    back();
    restore();
  }
});
