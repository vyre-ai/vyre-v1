// Getting in (rc.41), walked through the gate itself: the Spaces this device has used show when Vyre opens, one press each; the one address box takes a bare name; the desktop app opens a
// Space on Vyre's relay in the browser for the person; a wrong name is said under the box; a Space that does not answer is asked again quietly and then named, with the fix as a button, and
// nothing saved is deleted on the way.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { installDom, mount, find, flush, press, textOf, typeInto } from "../../onboarding/test-dom.ts";
import type { Node } from "../../../../../ui/src/testing/dom.ts";
import { setQuietWaitsForTests } from "../../../../../client/src/gateway/find-space.ts";
import { SessionGate } from "./SessionGate.tsx";
import { readKnown } from "./known-spaces.ts";

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

function storage(seed: Record<string, unknown> = {}): {
  getItem(k: string): string | null;
  all(): Record<string, string>;
} {
  const m = new Map<string, string>(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  const store = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    all: () => Object.fromEntries(m),
  };
  g.localStorage = store;
  return store;
}
function desktopShell(): void {
  const info = {
    app: "Vyre",
    version: "1.0.0-rc.41",
    platform: "macos",
    arch: "aarch64",
    sidecar: { phase: "ready", url: null, version: "1.0.0-rc.41", restarts: 0, error: null },
  };
  Object.assign(globalThis, {
    __TAURI__: {
      core: { invoke: async (command: string) => (command === "desktop_info" ? info : null) },
      event: { listen: async () => () => undefined },
    },
  });
}
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
/** The network of one test: an answer per address, anything else is a server that is not there. */
function network(answer: (url: URL, init?: RequestInit) => Response | null): { asked: string[] } {
  const asked: string[] = [];
  g.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    asked.push(url.href);
    const res = answer(url, init);
    if (!res) throw new TypeError("Failed to fetch");
    return res;
  }) as typeof fetch;
  return { asked };
}
async function until(root: Node, id: string, ms = 3000): Promise<Node> {
  const end = Date.now() + ms;
  for (;;) {
    const n = find(root, id);
    if (n) return n;
    if (Date.now() > end) throw new Error(`${id} never showed`);
    await flush();
  }
}
const KNOWN = {
  spaces: [
    {
      address: "https://northwind.example",
      name: "Northwind",
      spaceId: "spc_01NORTH",
      kind: "team",
      person: "Imran Ibarra",
      username: "imran",
      via: "app",
      usedAt: 2000,
    },
    { address: "https://lakeside.vyre.run", name: "Lakeside", via: "browser", usedAt: 1000 },
  ],
};
const realFetch = globalThis.fetch;
const realOpen = g.open;
function done(): void {
  g.fetch = realFetch;
  g.open = realOpen;
  delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
  delete g.localStorage;
}

test("opening Vyre shows the Spaces this device has used; a signed-out one opens its sign-in with the username there; Add a Space is the one box", async () => {
  installDom();
  storage({ "vyre.spaces.v1": KNOWN });
  network((url) =>
    url.origin === "https://northwind.example" && url.pathname.endsWith("sign_in_options") ? json(200, OPTIONS) : null,
  );
  try {
    desktopShell();
    const root = await mount(createRoot, <SessionGate baseUrl={null} />);
    const list = await until(root, "your-spaces");
    assert.equal(find(root, "door-me"), null, "the first-launch doors are for a device that has used no Space");
    assert.match(textOf(list), /Northwind/);
    assert.match(
      textOf(find(root, "your-space-0")),
      /Northwind.*Sign in/s,
      "the newest first, and a signed-out Space says what a press does",
    );
    assert.match(textOf(find(root, "your-space-1")), /Lakeside.*In your browser/s);
    await press(find(root, "add-space"));
    await until(root, "space-entry-address");
    assert.ok(find(root, "space-entry-create-link"), "Create a Space is one press from the box");
    await press(find(root, "back"));
    await press(await until(root, "your-space-0"));
    const user = await until(root, "si-user");
    assert.equal(
      (user.props as { value?: string }).value,
      "imran",
      "the username it last signed in with is already there",
    );
    await press(find(root, "back"));
    await until(root, "your-spaces");
  } finally {
    done();
  }
});

test("the desktop app opens a Space on Vyre's relay in the browser itself, with the link as it was given, and keeps it in Your Spaces", async () => {
  installDom();
  const store = storage();
  const opened: string[] = [];
  g.open = (url: string) => void opened.push(url);
  network((url) =>
    url.origin === "https://lakeside.vyre.run" && url.pathname === "/__vyre/info.json"
      ? json(200, { name: "lakeside", label: "Lakeside", route: "r1", relay: "wss://relay.vyre.run", online: true })
      : null,
  );
  try {
    desktopShell();
    const root = await mount(createRoot, <SessionGate baseUrl={null} />);
    await press(await until(root, "door-invited"));
    await typeInto(await until(root, "space-entry-address"), "lakeside");
    assert.match(textOf(find(root, "space-hint")), /lakeside\.vyre\.run/, "a bare name shows the address it means");
    await press(find(root, "space-entry-continue"));
    await until(root, "step-in-browser");
    assert.deepEqual(opened, ["https://lakeside.vyre.run/chat"]);
    assert.equal(find(root, "space-entry-error"), null, "nobody is told to switch to a browser");
    assert.deepEqual(
      readKnown(store as never).map((k) => [k.address, k.name, k.via]),
      [["https://lakeside.vyre.run", "Lakeside", "browser"]],
    );
    await press(find(root, "back"));
    assert.match(textOf(await until(root, "your-space-0")), /Lakeside.*In your browser/s);
    // the Space link (its key in the fragment) goes to the browser exactly as given
    await press(find(root, "add-space"));
    const link = `https://lakeside.vyre.run/#box=${"k".repeat(43)}`;
    await typeInto(await until(root, "space-entry-address"), link);
    await press(find(root, "space-entry-continue"));
    await until(root, "step-in-browser");
    assert.equal(opened[1], link);
  } finally {
    done();
  }
});

test("a name with no Space is said under the box, and a Space that does not answer is named there after the quiet retries", async () => {
  installDom();
  storage();
  const back = setQuietWaitsForTests([1, 1]);
  let nothing = false;
  network((url) =>
    !nothing && url.pathname === "/__vyre/info.json"
      ? json(404, { name: url.hostname.split(".")[0], held: false })
      : null,
  );
  try {
    desktopShell();
    const root = await mount(createRoot, <SessionGate baseUrl={null} />);
    await press(await until(root, "door-invited"));
    await typeInto(await until(root, "space-entry-address"), "northwnd");
    await press(find(root, "space-entry-continue"));
    assert.equal(textOf(await until(root, "space-entry-error")), "No Space at northwnd.vyre.run. Check the name.");
    nothing = true;
    await typeInto(find(root, "space-entry-address"), "space.northwind.example");
    await press(find(root, "space-entry-continue"));
    assert.equal(
      textOf(await until(root, "space-entry-error")),
      "space.northwind.example is not answering. Check the name and your connection.",
    );
  } finally {
    back();
    done();
  }
});

test("a remembered Space that does not answer: Reconnecting, then its name with Try again and Open in browser; when it answers again Try again goes in; nothing saved is deleted", async () => {
  installDom();
  const store = storage({ "vyre.spaces.v1": KNOWN });
  const back = setQuietWaitsForTests([1, 1]);
  const opened: string[] = [];
  g.open = (url: string) => void opened.push(url);
  let up = false;
  network((url) => {
    if (!up || url.origin !== "https://northwind.example") return null;
    if (url.pathname === "/healthz") return json(200, HEALTH);
    return url.pathname.endsWith("sign_in_options") ? json(200, OPTIONS) : null;
  });
  try {
    desktopShell();
    const root = await mount(createRoot, <SessionGate baseUrl={null} />);
    await press(await until(root, "your-space-0"));
    const failed = await until(root, "step-not-answering");
    assert.match(textOf(failed), /Northwind is not answering/);
    assert.ok(find(root, "not-answering-retry"), "the fix is a button");
    assert.ok(find(root, "not-answering-browser"), "the desktop app offers the browser");
    assert.equal(find(root, "not-answering-clear"), null, "the app window holds no old data to clear");
    await press(find(root, "not-answering-browser"));
    assert.deepEqual(opened, ["https://northwind.example/chat"]);
    assert.ok(
      find(root, "step-not-answering"),
      "looking in the browser does not move a Space that is not on the relay",
    );
    up = true;
    await press(find(root, "not-answering-retry"));
    await until(root, "si-user");
    assert.equal(
      readKnown(store as never).some((k) => k.address === "https://northwind.example"),
      true,
      "the Space is still remembered",
    );
  } finally {
    back();
    done();
    await act(async () => undefined);
  }
});

test("an address whose sign-in options answer is an empty 200 or a page of HTML is no Space: the sign-in does not wait on it, the screen says it is not answering", async () => {
  installDom();
  storage({ "vyre.spaces.v1": KNOWN });
  const back = setQuietWaitsForTests([1, 1]);
  g.open = () => undefined;
  // a proxy or a relay page in front of the address: every call answers 200, none with JSON
  network((url) =>
    url.origin === "https://northwind.example"
      ? new Response("<!doctype html><title>proxy</title>", { status: 200, headers: { "content-type": "text/html" } })
      : null,
  );
  try {
    desktopShell();
    const root = await mount(createRoot, <SessionGate baseUrl={null} />);
    await press(await until(root, "your-space-0"));
    const screen = await until(root, "step-not-answering", 6000);
    assert.match(textOf(screen), /Northwind is not answering/);
    assert.equal(find(root, "si-user"), null, "no sign-in for something that is not a Space");
  } finally {
    back();
    done();
  }
});

test("a loopback address typed in the desktop app is asked like any other: a port nothing answers on is said under the box, not opened as this computer's Space", async () => {
  installDom();
  storage();
  const back = setQuietWaitsForTests([1, 1]);
  network(() => null);
  try {
    desktopShell();
    const root = await mount(createRoot, <SessionGate baseUrl={null} />);
    await press(await until(root, "door-invited"));
    await typeInto(await until(root, "space-entry-address"), "http://127.0.0.1:1");
    await press(find(root, "space-entry-continue"));
    assert.match(textOf(await until(root, "space-entry-error")), /127\.0\.0\.1 is not answering/);
    assert.equal(find(root, "si-user"), null, "no sign-in for a port nothing answers on");
  } finally {
    back();
    done();
  }
});

test("the person pressed a Space's row: its sign-in shows the Space's name on first paint, before the Space has answered with its own", async () => {
  installDom();
  storage({ "vyre.spaces.v1": KNOWN });
  const back = setQuietWaitsForTests([1, 1]);
  let release: () => void = () => undefined;
  const held = new Promise<void>((r) => (release = r));
  g.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.origin !== "https://northwind.example") throw new TypeError("Failed to fetch");
    if (url.pathname === "/healthz") return json(200, HEALTH);
    if (url.pathname.endsWith("sign_in_options")) {
      await held; // the Space has not answered with its own name yet
      return json(200, { data: { ...OPTIONS.data, name: "Northwind Legal" } });
    }
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  try {
    desktopShell();
    const root = await mount(createRoot, <SessionGate baseUrl={null} />);
    await press(await until(root, "your-space-0"));
    const user = await until(root, "si-user");
    assert.ok(user);
    assert.match(textOf(find(root, "step-sign-in")), /Sign in to Northwind\b/);
    assert.doesNotMatch(textOf(find(root, "step-sign-in")), /your Space/, "no generic title");
    release();
    for (let i = 0; i < 20; i++) await flush();
    assert.match(
      textOf(find(root, "step-sign-in")),
      /Sign in to Northwind Legal/,
      "the Space's own name replaces it when it arrives",
    );
  } finally {
    back();
    done();
  }
});
