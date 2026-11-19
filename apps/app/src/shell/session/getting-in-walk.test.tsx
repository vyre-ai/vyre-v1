// Getting in, the real gate in random order. SessionGate itself is rendered and driven with the presses a person has and the failures a network has (a server that goes down and comes back, a
// relay Space asleep, awake or gone), in a random order from fixed seeds. After every step: some screen with a press that moves on is showing (no dead end), the Spaces the device has used are
// all still listed, and the saved sign-in is byte for byte what it was (nothing the walk does signs anyone out). Each seed's walk is printed on a failure so it can be replayed.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { installDom, mount, find, flush, press, typeInto } from "../../onboarding/test-dom.ts";
import type { Node } from "../../../../../ui/src/testing/dom.ts";
import { setQuietWaitsForTests } from "../../../../../client/src/gateway/find-space.ts";
import { SessionGate } from "./SessionGate.tsx";

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
  data: { name: "Northwind", fingerprint: "ab12cd34", password: true, github: false, sso: [], secondFactorRequired: false },
};
const HEALTH = { ok: true, version: "1.0.0-rc.41", roles: ["space"], space: "spc_01NORTH", head: 1, startedAt: 1 };
const KNOWN = {
  spaces: [
    { address: "https://northwind.example", name: "Northwind", spaceId: "spc_01NORTH", kind: "team", person: "Imran Ibarra", username: "imran", via: "app", usedAt: 2000 },
    { address: "https://lakeside.vyre.run", name: "Lakeside", via: "browser", usedAt: 1000 },
  ],
};
const OTHER_KEY = "vyre.test.saved-sign-in";
const SAVED = JSON.stringify({ note: "a saved sign-in belongs to storage.ts; nothing in this walk may touch it" });

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
];
const PRESSES = [
  "your-space-0",
  "your-space-1",
  "add-space",
  "not-answering-retry",
  "not-answering-browser",
  "in-browser-again",
  "back",
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
      const m = new Map<string, string>([
        ["vyre.spaces.v1", JSON.stringify(KNOWN)],
        [OTHER_KEY, SAVED],
      ]);
      g.localStorage = {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => void m.set(k, v),
        removeItem: (k: string) => void m.delete(k),
      };
      Object.assign(globalThis, {
        __TAURI__: {
          core: {
            invoke: async (c: string) =>
              c === "desktop_info"
                ? { app: "Vyre", version: "1.0.0-rc.41", platform: "macos", arch: "aarch64", sidecar: { phase: "ready", url: null, version: "1.0.0-rc.41", restarts: 0, error: null } }
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
            return json(200, { name, label: "Lakeside", route: "r1", relay: "wss://relay.vyre.run", online: world.lakeside === "awake" });
          if (name !== "lakeside") return json(404, { name, held: false });
        }
        if (init?.mode === "no-cors" && world.lakeside !== "gone" && url.hostname.endsWith(".vyre.run")) return new Response(null, { status: 200 });
        throw new TypeError("Failed to fetch");
      }) as typeof fetch;

      const log: string[] = [];
      try {
        const root = await mount(createRoot, <SessionGate baseUrl={null} />);
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
          assert.equal(m.get(OTHER_KEY), SAVED, `${where}: the saved sign-in changed`);
        }
      } finally {
        delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
        delete g.localStorage;
      }
    }
    for (const screen of ["your-spaces", "step-not-answering", "si-user"])
      assert.ok(visited.has(screen), `the walks never reached ${screen}: ${[...visited].join(", ")}`);
  } finally {
    restore();
    g.fetch = realFetch;
    g.open = realOpen;
  }
});
