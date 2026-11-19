// Getting in, the real gate in random order. SessionGate itself is rendered and driven with the presses a person has and the failures a network has (a server that goes down and comes back, a
// relay Space asleep, awake or gone), in a random order from fixed seeds. After every step: some screen with a press that moves on is showing (no dead end), the Spaces the device has used are
// all still listed, and the saved sign-in is byte for byte what it was (nothing the walk does signs anyone out). Each seed's walk is printed on a failure so it can be replayed.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { installDom, find, flush, press, typeInto } from "../../onboarding/test-dom.ts";
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

function rng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x100000000;
  };
}

/** The screens a way in can be on, each with the press that moves on from it. */
const SCREENS: { screen: string; exits: string[] }[] = [
  { screen: "your-spaces", exits: ["add-space", "your-space-0"] },
  { screen: "step-not-answering", exits: ["not-answering-retry", "back"] },
  { screen: "step-in-browser", exits: ["in-browser-again", "back"] },
  { screen: "si-user", exits: ["next", "back"] },
  { screen: "space-entry-address", exits: ["space-entry-continue", "back"] },
  { screen: "door-me", exits: ["door-existing", "door-invited"] },
  { screen: "opening-personal", exits: [] },
  // a saved Space that opened its shell and could not reach its server: Try again, and the way to Your Spaces
  { screen: "state-error", exits: ["state-retry", "state-second"] },
];
const PRESSES = [
  "your-space-0",
  "your-space-1",
  "add-space",
  "not-answering-retry",
  "not-answering-browser",
  "in-browser-again",
  "back",
  "state-retry",
  "state-second",
  "door-invited",
  "door-existing",
];

test("the real gate, 6 walks of 8 random steps: never a dead end, every Space still listed, the saved sign-in untouched", async () => {
  const restore = setQuietWaitsForTests([1, 1]);
  const realFetch = g.fetch;
  const realOpen = g.open;
  const visited = new Set<string>();
  try {
    for (let seed = 1; seed <= 6; seed++) {
      const r = rng(seed * 7919);
      const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
      installDom();
      const m = new Map<string, string>([["vyre.spaces.v1", JSON.stringify(KNOWN)]]);
      g.localStorage = {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => void m.set(k, v),
        removeItem: (k: string) => void m.delete(k),
      };
      const kv = g.localStorage as Parameters<typeof writeStored>[1];
      writeStored(SAVED_SESSION, kv);
      const savedBefore = JSON.stringify(readStoredSessions(kv));
      assert.ok(savedBefore.includes("vds_fixture"), "the saved sign-in is in the store the app reads");
      Object.assign(globalThis, {
        __TAURI__: {
          core: {
            invoke: async (c: string) =>
              c === "desktop_info"
                ? {
                    app: "Vyre",
                    version: "1.0.0-rc.41",
                    platform: "macos",
                    arch: "aarch64",
                    sidecar: { phase: "ready", url: null, version: "1.0.0-rc.41", restarts: 0, error: null },
                  }
                : null,
          },
          event: { listen: async () => () => undefined },
        },
      });
      g.open = () => undefined;
      const world = { northwind: true, lakeside: "awake" as "awake" | "asleep" | "gone" };
      g.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.origin === "https://northwind.example" && world.northwind) {
          if (url.pathname === "/healthz") return json(200, HEALTH);
          if (url.pathname.endsWith("sign_in_options")) return json(200, OPTIONS);
        }
        if (url.hostname.endsWith(".vyre.run") && url.pathname === "/__vyre/info.json") {
          const name = url.hostname.split(".")[0]!;
          if (name === "lakeside" && world.lakeside !== "gone")
            return json(200, {
              name,
              label: "Lakeside",
              route: "r1",
              relay: "wss://relay.vyre.run",
              online: world.lakeside === "awake",
            });
          if (name !== "lakeside") return json(404, { name, held: false });
        }
        if (init?.mode === "no-cors" && world.lakeside !== "gone" && url.hostname.endsWith(".vyre.run"))
          return new Response(null, { status: 200 });
        throw new TypeError("Failed to fetch");
      }) as typeof fetch;

      const log: string[] = [];
      let stop: () => Promise<void> = async () => undefined;
      try {
        const gate = await mountGate();
        stop = gate.stop;
        const root = gate.root;
        const settle = async (): Promise<void> => {
          for (let i = 0; i < 6; i++) await flush();
          await new Promise((res) => setTimeout(res, 5));
          for (let i = 0; i < 3; i++) await flush();
        };
        const present = (id: string): Node | null => find(root, id);
        await settle();
        for (let step = 0; step < 8; step++) {
          const roll = r();
          if (roll < 0.25) {
            const w = pick(["northwind-up", "northwind-down", "lakeside-awake", "lakeside-asleep", "lakeside-gone"]);
            log.push(w);
            if (w === "northwind-up") world.northwind = true;
            else if (w === "northwind-down") world.northwind = false;
            else world.lakeside = w.slice(9) as "awake" | "asleep" | "gone";
          } else {
            const here = PRESSES.filter((id) => present(id));
            if (here.length) {
              const id = pick(here);
              log.push(`press ${id}`);
              await press(present(id));
            } else if (present("space-entry-address")) {
              const typed = pick(["northwnd", "lakeside", "space.northwind.example", "northwind.example"]);
              log.push(`type ${typed}`);
              await typeInto(present("space-entry-address"), typed);
              await press(present("space-entry-continue"));
            }
          }
          await settle();
          const showing = SCREENS.filter((s) => present(s.screen));
          for (const x of showing) visited.add(x.screen);
          const where = `seed ${seed} after [${log.join(", ")}]`;
          assert.ok(showing.length > 0 || present("shell"), `${where}: no screen of Getting in is showing`);
          for (const s of showing)
            assert.ok(
              s.exits.length === 0 || s.exits.some((id) => present(id)),
              `${where}: ${s.screen} has none of ${s.exits.join(", ")} to press`,
            );
          const known = JSON.parse(m.get("vyre.spaces.v1") ?? "{}").spaces as { address: string }[];
          assert.deepEqual(
            known.map((k) => k.address).sort(),
            ["https://lakeside.vyre.run", "https://northwind.example"],
            `${where}: a Space left the list`,
          );
          assert.equal(JSON.stringify(readStoredSessions(kv)), savedBefore, `${where}: the saved sign-in changed`);
        }
      } catch (e) {
        console.error(`WALK FAILED: ${e instanceof Error ? e.message : String(e)}`);
        throw e;
      } finally {
        await stop();
        delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
        delete g.localStorage;
      }
    }
    for (const screen of ["your-spaces", "step-not-answering", "step-in-browser"])
      assert.ok(visited.has(screen), `the walks never reached ${screen}: ${[...visited].join(", ")}`);
  } finally {
    restore();
    g.fetch = realFetch;
    g.open = realOpen;
  }
});

test("a saved Space that answers its health check but fails its calls: Your Spaces opens with nothing of the failed shell mounted behind it, and Back asks for the Space afresh and returns to its failed screen; the saved sign-in is never touched", async () => {
  const realFetch = g.fetch;
  const restore = setQuietWaitsForTests([1, 1]);
  let stopSecond: () => Promise<void> = async () => undefined;
  try {
    installDom();
    const m = new Map<string, string>([["vyre.spaces.v1", JSON.stringify(KNOWN)]]);
    g.localStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
    const kv = g.localStorage as Parameters<typeof writeStored>[1];
    writeStored(SAVED_SESSION, kv);
    const before = JSON.stringify(readStoredSessions(kv));
    g.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/healthz") return json(200, HEALTH);
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const gate = await mountGate();
    stopSecond = gate.stop;
    const root = gate.root;
    const until = async (id: string): Promise<Node> => {
      const end = Date.now() + 8000;
      for (;;) {
        const n = find(root, id);
        if (n) return n;
        if (Date.now() > end) throw new Error(`${id} never showed`);
        await flush();
      }
    };
    await press(await until("your-space-0"));
    await until("state-second");
    assert.ok(find(root, "state-retry"), "Try again is beside it");
    await press(find(root, "state-second"));
    await until("your-spaces");
    assert.equal(find(root, "state-second"), null, "nothing of the failed shell is mounted behind the list");
    assert.equal(find(root, "state-retry"), null);
    await press(await until("back"));
    await until("state-second");
    assert.equal(find(root, "your-spaces"), null, "Back leaves the list");
    assert.equal(JSON.stringify(readStoredSessions(kv)), before, "the saved sign-in is untouched");
  } finally {
    await stopSecond();
    restore();
    g.fetch = realFetch;
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
    delete g.localStorage;
  }
});

test("one Space saved at two addresses, the used-last one dead: the list shows it, one press lands on the other address's sign-in (username there, no saved token sent), and both sign-ins stay saved", async () => {
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
      if (url.origin === "https://new.example" && url.pathname === "/healthz") return json(200, HEALTH);
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
    const end = Date.now() + 10000;
    while (!asked.includes("https://new.example/healthz") && Date.now() < end) await flush();
    assert.ok(asked.includes("https://new.example/healthz"));
    const signIn = await until("si-user");
    assert.equal(textOrValue(signIn), "imran", "the username is already there");
    assert.equal(find(root, "step-not-answering"), null, "the person is not left on the dead address");
    assert.deepEqual(authed, [], "no saved sign-in went to the other address: it is not proven to be the Space");
    assert.equal(JSON.stringify(readStoredSessions(kv)), before, "both sign-ins are still saved, unchanged");
  } finally {
    await stop();
    restore();
    g.fetch = realFetch;
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
    delete g.localStorage;
  }
});

test("the person moves on to Your Spaces while the other address is being asked: when it answers, nothing opens and the list stays", async () => {
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
    let release: () => void = () => undefined;
    const slow = new Promise<void>((r) => (release = r));
    g.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      asked.push(url.origin + url.pathname);
      if (url.origin === "https://new.example" && url.pathname === "/healthz") {
        await slow;
        return json(200, HEALTH);
      }
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
    // the shell of the dead address fails; the other address is being asked (its answer is held back)
    await until("state-second");
    const wait = Date.now() + 5000;
    while (!asked.includes("https://new.example/healthz") && Date.now() < wait) await flush();
    assert.ok(asked.includes("https://new.example/healthz"), "the other address is being asked");
    // the person goes to Your Spaces instead; then the answer arrives
    await press(find(root, "state-second"));
    await until("your-spaces");
    release();
    for (let i = 0; i < 60; i++) await flush();
    assert.ok(find(root, "your-spaces"), "the list is still what the person sees");
    assert.deepEqual(
      asked.filter((u) => u.startsWith("https://new.example") && !u.endsWith("/healthz")),
      [],
      "nothing was opened at the other address",
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
    const end = Date.now() + 10000;
    while (!asked.includes("https://new.example/healthz") && Date.now() < end) await flush();
    assert.ok(asked.includes("https://new.example/healthz"));
    for (let i = 0; i < 30; i++) await flush();
    assert.deepEqual(
      asked.filter((u) => u.startsWith("https://new.example")),
      ["https://new.example/healthz", "https://new.example/healthz"],
      "only the identity question went to the other address, nothing carrying a sign-in",
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
