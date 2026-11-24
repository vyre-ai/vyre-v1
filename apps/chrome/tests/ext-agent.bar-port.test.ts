// The bar's buttons send over a port to the worker. When that port has closed (the worker stopped and started again) a person's press connects again and goes through: it is never lost.
import test from "node:test";
import assert from "node:assert/strict";
import { overlayShow, overlayHide } from "../src/agent/overlay.js";

function fakeEl(tag: string) {
  const el: any = {
    tag,
    style: { setProperty() {}, cssText: "" },
    children: [] as any[],
    listeners: {} as Record<string, Array<(e: any) => void>>,
    className: "",
    classList: { add() {}, remove() {} },
    isConnected: true,
    append(...k: any[]) {
      el.children.push(...k);
    },
    appendChild(k: any) {
      el.children.push(k);
    },
    setAttribute() {},
    addEventListener(t: string, f: (e: any) => void) {
      (el.listeners[t] ??= []).push(f);
    },
    attachShadow: () => fakeEl("shadow"),
    remove() {
      el.isConnected = false;
    },
    animate: undefined,
    set textContent(_v: string) {},
  };
  return el;
}

function world() {
  const made: any[] = [];
  const ports: any[] = [];
  const posts: any[] = [];
  let failNext = 0;
  const g: any = globalThis;
  g.document = {
    documentElement: fakeEl("html"),
    createElement: (t: string) => {
      const e = fakeEl(t);
      made.push(e);
      return e;
    },
    createElementNS: (_n: string, t: string) => fakeEl(t),
  };
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  g.chrome = {
    runtime: {
      connect: () => {
        const p: any = {
          dis: [] as Array<() => void>,
          onDisconnect: { addListener: (f: () => void) => p.dis.push(f) },
          postMessage: (m: any) => {
            if (failNext > 0) {
              failNext--;
              throw new Error("Attempting to use a disconnected port object");
            }
            posts.push({ port: ports.indexOf(p), m });
          },
          disconnect() {},
        };
        ports.push(p);
        return p;
      },
    },
  };
  return { made, ports, posts, failOnce: () => (failNext = 1), g };
}

const press = (el: any) => {
  for (const f of el.listeners["pointerdown"] ?? [])
    f({ isTrusted: true, button: 0, clientX: 10, clientY: 10, preventDefault() {}, stopPropagation() {} });
};

test("a Take over pressed after the port closed connects again and is sent, with the agent's id and name", () => {
  const w = world();
  try {
    overlayShow({ name: "Scout", agent: "agt_scout", port: "p" } as any);
    const take = w.made.find((e) => e.className === "take");
    assert.ok(take, "the bar has a Take over button");
    assert.equal(w.ports.length, 1);
    // the worker restarted: the page's port closed
    for (const f of w.ports[0].dis) f();
    press(take);
    assert.equal(w.ports.length, 2, "the bar connected again");
    assert.deepEqual(
      w.posts.map((p) => [p.port, p.m.type, p.m.agent, p.m.name]),
      [[1, "takeover", "agt_scout", "Scout"]],
    );
  } finally {
    overlayHide();
  }
});

test("a press that finds the port dead without a disconnect event connects again once and is sent", () => {
  const w = world();
  try {
    overlayShow({ name: "Scout", agent: "agt_scout", port: "p" } as any);
    const stop = w.made.find((e) => e.className === "stop");
    w.failOnce();
    press(stop);
    assert.equal(w.ports.length, 2);
    assert.deepEqual(
      w.posts.map((p) => [p.port, p.m.type]),
      [[1, "stop"]],
    );
  } finally {
    overlayHide();
  }
});
