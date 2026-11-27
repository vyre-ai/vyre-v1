// The live view finds out that its stream is gone and opens it again by itself (rc.44; owner: "I can't open browser or terminal in a stable way"). Before, a closed socket or a dead picture stream left the last
// frame on screen under a bar that still said Watching, for ever. Here the socket closes under the view: it says Reconnecting, asks for a new address (a ticket is never reused), connects again and the line goes.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { BrowserLive } from "./BrowserLive.tsx";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

class FakeSocket {
  static all: FakeSocket[] = [];
  binaryType = "";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {
    FakeSocket.all.push(this);
    setTimeout(() => this.onopen?.(), 0);
  }
  send(s: string): void {
    this.sent.push(s);
  }
  close(): void {
    this.onclose?.();
  }
}

function rig(failOpensAfter = Infinity) {
  const calls: string[] = [];
  let n = 0;
  const call = async (cap: string): Promise<unknown> => {
    calls.push(cap);
    if (cap !== "computers.browser.stream") return {};
    n++;
    if (n > failOpensAfter)
      throw Object.assign(new Error("The Space browser did not answer in time"), { code: "internal.unexpected" });
    return {
      transport: "mjpeg",
      url: `/browsers/a/stream?ticket=t${n}`,
      ws: `/browsers/a/ws?ticket=t${n}`,
      expiresAt: Date.now() + 60_000,
    };
  };
  return { call, calls, opens: () => n };
}

function install() {
  const g = globalThis as Record<string, unknown>;
  const had = { ws: g["WebSocket"], bmp: g["createImageBitmap"] };
  FakeSocket.all = [];
  g["WebSocket"] = FakeSocket;
  g["createImageBitmap"] = async () => ({ width: 10, height: 10, close() {} });
  return () => {
    if (had.ws === undefined) delete g["WebSocket"];
    else g["WebSocket"] = had.ws;
    if (had.bmp === undefined) delete g["createImageBitmap"];
    else g["createImageBitmap"] = had.bmp;
  };
}

test("a socket that closes is replaced by a new one with a new address, and the view says Reconnecting meanwhile", async () => {
  const restore = installDom();
  const back = install();
  try {
    const r = rig();
    const root = await mount(createRoot, <BrowserLive agentId="a" control={false} call={r.call} spaceUrl="http://s" />);
    await flush();
    await sleep(20);
    assert.equal(FakeSocket.all.length, 1, "the watcher uses the socket, not a picture stream");
    assert.match(FakeSocket.all[0]!.url, /ticket=t1/);
    assert.equal(find(root, "browser-live-view-state"), null, "nothing is said while it is live");
    FakeSocket.all[0]!.onclose?.();
    await flush();
    assert.match(textOf(find(root, "browser-live-view-state")), /Reconnecting/);
    await sleep(700);
    await flush();
    assert.equal(r.opens(), 2, "a new address was asked for");
    assert.equal(FakeSocket.all.length, 2);
    assert.match(FakeSocket.all[1]!.url, /ticket=t2/, "the ticket is never reused");
    assert.equal(find(root, "browser-live-view-state"), null, "the line goes when it is back");
  } finally {
    back();
    restore();
  }
});

test("when it cannot be reached it says so and Try again opens it once more", async () => {
  const restore = installDom();
  const back = install();
  try {
    const r = rig(1);
    const root = await mount(
      createRoot,
      <BrowserLive agentId="a" control={false} call={r.call} spaceUrl="http://s" giveUpMs={500} />,
    );
    await flush();
    await sleep(20);
    FakeSocket.all[0]!.onclose?.();
    await flush();
    // the view is told to give up after 0.5 s here (30 s in the app)
    const t0 = Date.now();
    while (Date.now() - t0 < 8000 && !find(root, "browser-live-view-retry")) {
      await sleep(250);
      await flush();
    }
    assert.match(textOf(find(root, "browser-live-view-state")), /Couldn't reach the browser/);
    assert.ok(find(root, "browser-live-view-retry"), "a Try again is offered");
    const before = r.opens();
    await press(find(root, "browser-live-view-retry"));
    await flush();
    assert.ok(r.opens() > before, "Try again asks for a new address at once");
  } finally {
    back();
    restore();
  }
});
