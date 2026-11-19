// Getting in, one Space saved at two addresses, on the real gate: the other address is offered by name on the not-answering screen and asked only on a press; nothing is sent to it before that,
// no saved sign-in ever goes there, the person who moves on while it is asked gets nothing opened, and an address that names another Space gets no sign-in. Split from getting-in-walk.test.tsx
// to keep each file under the time cap.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { installDom, find, flush, press, textOf } from "../../onboarding/test-dom.ts";
import type { Node } from "../../../../../ui/src/testing/dom.ts";
import { setQuietWaitsForTests } from "../../../../../client/src/gateway/find-space.ts";
import { SessionGate } from "./SessionGate.tsx";
import { readStoredSessions, writeStored } from "./stored.ts";
import type { StoredSession } from "./stored.ts";
import { NORTHWIND } from "../spaces/model.ts";

const g = globalThis as {
  requestAnimationFrame?: (f: (t: number) => void) => number;
  cancelAnimationFrame?: (id: number) => void;
  localStorage?: unknown;
  open?: unknown;
  fetch: typeof fetch;
};
g.requestAnimationFrame ??= () => 0;
g.cancelAnimationFrame ??= () => undefined;
const box = { x: 0, y: 0, width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 };
Object.defineProperty(Object.prototype, "getBoundingClientRect", {
  value: () => box,
  configurable: true,
  enumerable: false,
  writable: true,
});
Object.defineProperty(Object.prototype, "getContext", {
  value: () => null,
  configurable: true,
  enumerable: false,
  writable: true,
});

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
  });
const OPTIONS = {
  data: {
    name: "Northwind",
    fingerprint: "ab12cd34",
    password: true,
    github: false,
    sso: [],
    secondFactorRequired: false,
  },
};
const HEALTH = { ok: true, version: "1.0.0-rc.41", roles: ["space"], space: "spc_01NORTH", head: 1, startedAt: 1 };
/** A real saved sign-in, written by the app's own store: the walk presses its row and the Space goes down under it, and it must be there, byte for byte, after every step. */
const SAVED_SESSION: StoredSession = {
  baseUrl: "https://northwind.example",
  token: "vds_fixture",
  def: { ...NORTHWIND, spaceId: "spc_01NORTH", name: "Northwind" },
  personId: "per_imran",
  marker: "ab12",
  username: "imran",
  displayName: "Imran Ibarra",
};

/** The gate in a test root that can be taken down: a shell left mounted keeps timers that hold the test process open. */
/** Two presses inside one act: the same tick, before the screen can re-render (overlapping act calls are not supported by the renderer, which is what made an earlier try hang). */
async function pressTwice(n: Node): Promise<void> {
  const event = {
    stopPropagation() {},
    preventDefault() {},
    altKey: false,
    target: { getAttribute: () => null },
    currentTarget: { getAttribute: () => null },
    nativeEvent: {},
  };
  await act(async () => {
    (n.props.onClick as (e: unknown) => void)(event);
    (n.props.onClick as (e: unknown) => void)(event);
  });
}

async function mountGate(): Promise<{ root: Node; stop: () => Promise<void> }> {
  const r = createRoot();
  await act(async () => {
    r.render(<SessionGate baseUrl={null} />);
  });
  await flush();
  return {
    root: r.container as unknown as Node,
    stop: async () => {
      await act(async () => {
        r.unmount();
      });
    },
  };
}

/** What an input node holds. */
const textOrValue = (n: Node): string => String((n as unknown as { props?: { value?: string } }).props?.value ?? "");

test("one Space saved at two addresses, the used-last one dead: the list shows it, the failed screen offers the other address by name; pressing it opens that address's own sign-in (no username typed, no saved token sent), and both sign-ins stay saved", async () => {
  const realFetch = g.fetch;
  const restore = setQuietWaitsForTests([1, 1]);
  let stop: () => Promise<void> = async () => undefined;
  try {
    installDom();
    const m = new Map<string, string>([
      [
        "vyre.spaces.v1",
        JSON.stringify({
          spaces: [
            {
              address: "https://old.example",
              name: "Northwind",
              spaceId: "spc_01NORTH",
              kind: "team",
              via: "app",
              usedAt: 5000,
            },
          ],
        }),
      ],
    ]);
    g.localStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
    const kv = g.localStorage as Parameters<typeof writeStored>[1];
    writeStored({ ...SAVED_SESSION, baseUrl: "https://old.example", token: "vds_old" }, kv);
    writeStored({ ...SAVED_SESSION, baseUrl: "https://new.example", token: "vds_new" }, kv);
    const before = JSON.stringify(readStoredSessions(kv));
    const asked: string[] = [];
    const authed: string[] = [];
    let release: () => void = () => undefined;
    const slow = new Promise<void>((r) => (release = r));
    g.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      asked.push(url.origin + url.pathname);
      if (
        url.origin === "https://new.example" &&
        JSON.stringify(init?.headers ?? {})
          .toLowerCase()
          .includes("authorization")
      )
        authed.push(url.pathname);
      if (url.origin === "https://new.example" && url.pathname === "/healthz") {
        await slow;
        return json(200, HEALTH);
      }
      if (url.origin === "https://new.example" && url.pathname.endsWith("sign_in_options")) return json(200, OPTIONS);
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const gate = await mountGate();
    stop = gate.stop;
    const root = gate.root;
    const until = async (id: string): Promise<Node> => {
      const end = Date.now() + 10000;
      for (;;) {
        const n = find(root, id);
        if (n) return n;
        if (Date.now() > end) throw new Error(`${id} never showed; asked ${asked.join(" ")}`);
        await flush();
      }
    };
    await press(await until("your-space-0"));
    const other = await until("not-answering-other-0");
    assert.match(textOf(other), /new\.example/, "the button names the address");
    assert.equal(
      asked.filter((u) => u.startsWith("https://new.example")).length,
      0,
      "nothing is sent to the other address until the person presses it",
    );
    // two presses in one tick (a double click before the screen re-renders), the other address's answer held back, then released
    await pressTwice(other);
    const wait = Date.now() + 5000;
    while (!asked.includes("https://new.example/healthz") && Date.now() < wait) await flush();
    release();
    await until("si-user");
    assert.equal(
      asked.filter((u) => u === "https://new.example/healthz").length,
      2,
      "one press worth of questions (is it answering, which Space is it), not two",
    );
    assert.equal(textOrValue(find(root, "si-user")!), "", "no username is typed for them there");
    // an address nothing proves to be the Space does not borrow its look: the plain host, no name from the saved Space or from the address, no picture asked for, no username
    const screen = textOf(root);
    assert.match(screen, /Sign in to new\.example/, "the host is the title");
    assert.ok(!screen.includes("Northwind"), "no Space name on it");
    assert.deepEqual(
      asked.filter((u) => u.startsWith("https://new.example") && /image/.test(u)),
      [],
      "no Space picture was asked of it",
    );
    assert.deepEqual(authed, [], "no saved sign-in went to the other address");
    assert.equal(JSON.stringify(readStoredSessions(kv)), before, "both sign-ins are still saved, unchanged");
  } finally {
    await stop();
    restore();
    g.fetch = realFetch;
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
    delete g.localStorage;
  }
});

test("the person moves on while the other address is being asked: when it answers, nothing opens and the list stays", async () => {
  const realFetch = g.fetch;
  const restore = setQuietWaitsForTests([1, 1]);
  let stop: () => Promise<void> = async () => undefined;
  try {
    installDom();
    const m = new Map<string, string>([
      [
        "vyre.spaces.v1",
        JSON.stringify({
          spaces: [
            {
              address: "https://old.example",
              name: "Northwind",
              spaceId: "spc_01NORTH",
              kind: "team",
              via: "app",
              usedAt: 5000,
            },
          ],
        }),
      ],
    ]);
    g.localStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
    const kv = g.localStorage as Parameters<typeof writeStored>[1];
    writeStored({ ...SAVED_SESSION, baseUrl: "https://old.example", token: "vds_old" }, kv);
    writeStored({ ...SAVED_SESSION, baseUrl: "https://new.example", token: "vds_new" }, kv);
    const before = JSON.stringify(readStoredSessions(kv));
    const asked: string[] = [];
    const authed: string[] = [];
    let release: () => void = () => undefined;
    const slow = new Promise<void>((r) => (release = r));
    g.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      asked.push(url.origin + url.pathname);
      if (
        url.origin === "https://new.example" &&
        JSON.stringify(init?.headers ?? {})
          .toLowerCase()
          .includes("authorization")
      )
        authed.push(url.pathname);
      if (url.origin === "https://new.example" && url.pathname === "/healthz") {
        await slow;
        return json(200, HEALTH);
      }
      if (url.origin === "https://new.example" && url.pathname.endsWith("sign_in_options")) return json(200, OPTIONS);
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const gate = await mountGate();
    stop = gate.stop;
    const root = gate.root;
    const until = async (id: string): Promise<Node> => {
      const end = Date.now() + 10000;
      for (;;) {
        const n = find(root, id);
        if (n) return n;
        if (Date.now() > end) throw new Error(`${id} never showed; asked ${asked.join(" ")}`);
        await flush();
      }
    };
    await press(await until("your-space-0"));
    const other = await until("not-answering-other-0");
    await press(other);
    const wait = Date.now() + 5000;
    while (!asked.includes("https://new.example/healthz") && Date.now() < wait) await flush();
    assert.ok(asked.includes("https://new.example/healthz"), "the other address is being asked");
    // the person goes Back to Your Spaces while it is asked; then the answer arrives
    await press(await until("back"));
    await until("your-spaces");
    release();
    for (let i = 0; i < 60; i++) await flush();
    assert.ok(find(root, "your-spaces"), "the list is still what the person sees");
    assert.equal(find(root, "si-user"), null, "no sign-in opened over it");
    assert.equal(find(root, "step-not-answering"), null, "no screen landed over it");
    assert.equal(JSON.stringify(readStoredSessions(kv)), before, "both sign-ins are still saved, unchanged");
  } finally {
    await stop();
    restore();
    g.fetch = realFetch;
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
    delete g.localStorage;
  }
});

test("a press right after Back, while the old probe still hangs, is not blocked: it asks again and gets the person in", async () => {
  const realFetch = g.fetch;
  const restore = setQuietWaitsForTests([1, 1]);
  let stop: () => Promise<void> = async () => undefined;
  try {
    installDom();
    const m = new Map<string, string>([
      [
        "vyre.spaces.v1",
        JSON.stringify({
          spaces: [
            {
              address: "https://old.example",
              name: "Northwind",
              spaceId: "spc_01NORTH",
              kind: "team",
              via: "app",
              usedAt: 5000,
            },
          ],
        }),
      ],
    ]);
    g.localStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
    const kv = g.localStorage as Parameters<typeof writeStored>[1];
    writeStored({ ...SAVED_SESSION, baseUrl: "https://old.example", token: "vds_old" }, kv);
    writeStored({ ...SAVED_SESSION, baseUrl: "https://new.example", token: "vds_new" }, kv);
    const before = JSON.stringify(readStoredSessions(kv));
    const asked: string[] = [];
    const authed: string[] = [];
    let release: () => void = () => undefined;
    const slow = new Promise<void>((r) => (release = r));
    g.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      asked.push(url.origin + url.pathname);
      if (
        url.origin === "https://new.example" &&
        JSON.stringify(init?.headers ?? {})
          .toLowerCase()
          .includes("authorization")
      )
        authed.push(url.pathname);
      if (url.origin === "https://new.example" && url.pathname === "/healthz") {
        await slow;
        return json(200, HEALTH);
      }
      if (url.origin === "https://new.example" && url.pathname.endsWith("sign_in_options")) return json(200, OPTIONS);
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const gate = await mountGate();
    stop = gate.stop;
    const root = gate.root;
    const until = async (id: string): Promise<Node> => {
      const end = Date.now() + 10000;
      for (;;) {
        const n = find(root, id);
        if (n) return n;
        if (Date.now() > end) throw new Error(`${id} never showed; asked ${asked.join(" ")}`);
        await flush();
      }
    };
    await press(await until("your-space-0"));
    const other = await until("not-answering-other-0");
    await press(other);
    const first = Date.now() + 5000;
    while (!asked.includes("https://new.example/healthz") && Date.now() < first) await flush();
    // Back to the list while that probe hangs, then the same Space again, then its other address again
    await press(await until("back"));
    await press(await until("your-space-0"));
    await press(await until("not-answering-other-0"));
    const second = Date.now() + 5000;
    while (asked.filter((u) => u === "https://new.example/healthz").length < 2 && Date.now() < second) await flush();
    assert.ok(
      asked.filter((u) => u === "https://new.example/healthz").length >= 2,
      "the press after Back asked again, it was not blocked",
    );
    release();
    await until("si-user");
    assert.equal(JSON.stringify(readStoredSessions(kv)), before, "both sign-ins are still saved, unchanged");
  } finally {
    await stop();
    restore();
    g.fetch = realFetch;
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
    delete g.localStorage;
  }
});

test("the other address now answers as a different Space: its saved sign-in is not sent there, and the person gets the dead Space's own screen", async () => {
  const realFetch = g.fetch;
  const restore = setQuietWaitsForTests([1, 1]);
  let stop: () => Promise<void> = async () => undefined;
  try {
    installDom();
    const m = new Map<string, string>([
      [
        "vyre.spaces.v1",
        JSON.stringify({
          spaces: [
            {
              address: "https://old.example",
              name: "Northwind",
              spaceId: "spc_01NORTH",
              kind: "team",
              via: "app",
              usedAt: 5000,
            },
          ],
        }),
      ],
    ]);
    g.localStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
    const kv = g.localStorage as Parameters<typeof writeStored>[1];
    writeStored({ ...SAVED_SESSION, baseUrl: "https://old.example", token: "vds_old" }, kv);
    writeStored({ ...SAVED_SESSION, baseUrl: "https://new.example", token: "vds_new" }, kv);
    const before = JSON.stringify(readStoredSessions(kv));
    const asked: string[] = [];
    g.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      asked.push(url.origin + url.pathname);
      if (url.origin === "https://new.example" && url.pathname === "/healthz")
        return json(200, { ...HEALTH, space: "spc_other" });
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const gate = await mountGate();
    stop = gate.stop;
    const root = gate.root;
    const until = async (id: string): Promise<Node> => {
      const end = Date.now() + 10000;
      for (;;) {
        const n = find(root, id);
        if (n) return n;
        if (Date.now() > end) throw new Error(`${id} never showed; asked ${asked.join(" ")}`);
        await flush();
      }
    };
    await press(await until("your-space-0"));
    await press(await until("not-answering-other-0"));
    for (let i = 0; i < 40; i++) await flush();
    assert.equal(find(root, "si-user"), null, "an address that names another Space gets no sign-in");
    assert.ok(find(root, "step-not-answering"), "the person stays on a screen with a way on");
    assert.deepEqual(
      asked.filter((u) => u.startsWith("https://new.example") && !u.endsWith("/healthz")),
      [],
      "only the identity question went to the other address",
    );
    assert.equal(JSON.stringify(readStoredSessions(kv)), before, "both sign-ins are still saved, unchanged");
  } finally {
    await stop();
    restore();
    g.fetch = realFetch;
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
    delete g.localStorage;
  }
});

test("one Space saved at three addresses, the first two not answering: each other address is offered, and the person still gets in at the third", async () => {
  const realFetch = g.fetch;
  const restore = setQuietWaitsForTests([1, 1]);
  let stop: () => Promise<void> = async () => undefined;
  try {
    installDom();
    const m = new Map<string, string>([
      [
        "vyre.spaces.v1",
        JSON.stringify({
          spaces: [
            {
              address: "https://a.example",
              name: "Northwind",
              spaceId: "spc_01NORTH",
              kind: "team",
              via: "app",
              usedAt: 5000,
            },
          ],
        }),
      ],
    ]);
    g.localStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
    const kv = g.localStorage as Parameters<typeof writeStored>[1];
    for (const host of ["a", "b", "c"])
      writeStored({ ...SAVED_SESSION, baseUrl: `https://${host}.example`, token: `vds_${host}` }, kv);
    const before = JSON.stringify(readStoredSessions(kv));
    const authed: string[] = [];
    g.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (
        JSON.stringify(init?.headers ?? {})
          .toLowerCase()
          .includes("authorization")
      )
        authed.push(url.origin + url.pathname);
      if (url.origin === "https://c.example" && url.pathname === "/healthz") return json(200, HEALTH);
      if (url.origin === "https://c.example" && url.pathname.endsWith("sign_in_options")) return json(200, OPTIONS);
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const gate = await mountGate();
    stop = gate.stop;
    const root = gate.root;
    const until = async (id: string): Promise<Node> => {
      const end = Date.now() + 10000;
      for (;;) {
        const n = find(root, id);
        if (n) return n;
        if (Date.now() > end) throw new Error(`${id} never showed`);
        await flush();
      }
    };
    const pressHost = async (host: string): Promise<void> => {
      for (let i = 0; i < 3; i++) {
        const n = find(root, `not-answering-other-${i}`);
        if (n && textOf(n).includes(`${host}.example`)) return press(n);
      }
      throw new Error(`no button for ${host}.example`);
    };
    await press(await until("your-space-0"));
    await until("not-answering-other-0");
    // the first address does not answer: the other two are offered, one row each
    assert.ok(find(root, "not-answering-other-1"), "both other addresses are offered");
    await pressHost("b");
    // b does not answer either: its own screen offers the others again
    for (let i = 0; i < 40; i++) await flush();
    await until("not-answering-other-1");
    await pressHost("c");
    await until("si-user");
    assert.deepEqual(
      authed.filter((u) => !u.startsWith("https://a.example")),
      [],
      "no saved sign-in went to any other address (only the first address, where the sign-in was made, saw one)",
    );
    assert.equal(JSON.stringify(readStoredSessions(kv)), before, "all three sign-ins are still saved, unchanged");
  } finally {
    await stop();
    restore();
    g.fetch = realFetch;
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
    delete g.localStorage;
  }
});

test("one Space saved at seven addresses, only the seventh answering: five are shown, More shows the rest, and the seventh gets the person in", async () => {
  const realFetch = g.fetch;
  const restore = setQuietWaitsForTests([1, 1]);
  let stop: () => Promise<void> = async () => undefined;
  try {
    installDom();
    const hosts = ["a", "b", "c", "d", "e", "f", "g"];
    const m = new Map<string, string>([
      [
        "vyre.spaces.v1",
        JSON.stringify({
          spaces: [
            {
              address: "https://a.example",
              name: "Northwind",
              spaceId: "spc_01NORTH",
              kind: "team",
              via: "app",
              usedAt: 5000,
            },
          ],
        }),
      ],
    ]);
    g.localStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
    const kv = g.localStorage as Parameters<typeof writeStored>[1];
    for (const h of hosts) writeStored({ ...SAVED_SESSION, baseUrl: `https://${h}.example`, token: `vds_${h}` }, kv);
    const before = JSON.stringify(readStoredSessions(kv));
    g.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.origin === "https://g.example" && url.pathname === "/healthz") return json(200, HEALTH);
      if (url.origin === "https://g.example" && url.pathname.endsWith("sign_in_options")) return json(200, OPTIONS);
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const gate = await mountGate();
    stop = gate.stop;
    const root = gate.root;
    const until = async (id: string): Promise<Node> => {
      const end = Date.now() + 10000;
      for (;;) {
        const n = find(root, id);
        if (n) return n;
        if (Date.now() > end) throw new Error(`${id} never showed`);
        await flush();
      }
    };
    await press(await until("your-space-0"));
    await until("not-answering-other-0");
    // six other addresses: five rows and a More row
    assert.ok(find(root, "not-answering-other-4"), "five rows");
    assert.equal(find(root, "not-answering-other-5"), null, "not six");
    assert.match(textOf(await until("not-answering-more")), /1 more/);
    assert.ok(!textOf(root).includes("g.example"), "the seventh is behind More");
    await press(find(root, "not-answering-more"));
    assert.equal(find(root, "not-answering-more"), null, "More is gone once shown");
    let pressed = false;
    for (let i = 0; i < 6 && !pressed; i++) {
      const n = find(root, `not-answering-other-${i}`);
      if (n && textOf(n).includes("g.example")) {
        await press(n);
        pressed = true;
      }
    }
    assert.ok(pressed, "the seventh address is offered");
    await until("si-user");
    assert.equal(JSON.stringify(readStoredSessions(kv)), before, "all seven sign-ins are still saved, unchanged");
  } finally {
    await stop();
    restore();
    g.fetch = realFetch;
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
    delete g.localStorage;
  }
});
