import test from "node:test";
import assert from "node:assert/strict";
import { clearOldData, hasOldData, healStaleWorker, staleWorker, type OldDataEnv } from "./old-data.ts";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const html = (): Response => new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } });
const INFO = { name: "northwind", label: "Northwind", route: "r1", relay: "wss://relay.vyre.run", online: true };

function page(o: { worker?: string; regs?: string[]; caches?: string[]; store?: Record<string, string> }) {
  const gone: string[] = [];
  const store = o.store ?? {};
  let reloads = 0;
  const env: OldDataEnv = {
    navigator: {
      serviceWorker: {
        controller: o.worker ? { scriptURL: `https://northwind.vyre.run${o.worker}` } : null,
        getRegistrations: async () =>
          (o.regs ?? (o.worker ? [o.worker] : [])).map((s) => ({
            active: { scriptURL: `https://northwind.vyre.run${s}` },
            unregister: async () => {
              gone.push(`worker ${s}`);
              return true;
            },
          })),
      },
    },
    caches: {
      keys: async () => o.caches ?? [],
      delete: async (k) => {
        gone.push(`cache ${k}`);
        return true;
      },
    },
    location: {
      origin: "https://northwind.vyre.run",
      reload: () => {
        reloads++;
      },
    },
    sessionStorage: {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => {
        store[k] = v;
      },
    },
  };
  return { env, gone, store, reloads: () => reloads };
}
const asServer = { fetch: (async () => html()) as typeof fetch };
const asRelay = { fetch: (async () => json(200, INFO)) as typeof fetch };
const offline = {
  fetch: (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch,
};

test("the relay's worker on an address that is a Space server now is stale; on a name the relay still holds it fits", async () => {
  assert.equal(await staleWorker(page({ worker: "/__vyre/sw.js" }).env, asServer), "relay-worker");
  assert.equal(await staleWorker(page({ worker: "/__vyre/sw.js" }).env, asRelay), null);
});

test("the app's worker on a name the relay holds now is stale; on a Space server it fits", async () => {
  assert.equal(await staleWorker(page({ worker: "/sw.js" }).env, asRelay), "app-worker");
  assert.equal(await staleWorker(page({ worker: "/sw.js" }).env, asServer), null);
});

test("nothing is called stale on a guess: no worker in charge, or an address that cannot be asked", async () => {
  assert.equal(await staleWorker(page({}).env, asServer), null);
  assert.equal(await staleWorker(page({ worker: "/__vyre/sw.js" }).env, offline), null);
});

test("clearing old data removes workers and cached pages and nothing else", async () => {
  const p = page({ worker: "/sw.js", caches: ["vyre-shell-v2"], store: { "vyre.session.v1": "kept" } });
  assert.equal(await hasOldData(p.env), true);
  assert.deepEqual(await clearOldData(p.env), { workers: 1, caches: 1 });
  assert.deepEqual(p.gone, ["worker /sw.js", "cache vyre-shell-v2"]);
  assert.equal(p.store["vyre.session.v1"], "kept", "a saved sign-in is never old data");
  assert.equal(await hasOldData(page({}).env), false);
});

test("a stale worker is removed and the page loads again once; a second failure in the same tab does not loop", async () => {
  const p = page({ worker: "/__vyre/sw.js", caches: ["vyre-old"] });
  assert.equal(await healStaleWorker(p.env, asServer), true);
  assert.deepEqual(p.gone, ["worker /__vyre/sw.js", "cache vyre-old"]);
  assert.equal(p.reloads(), 1);
  assert.equal(await healStaleWorker(p.env, asServer), false, "once per tab");
  assert.equal(p.reloads(), 1);
});

test("a worker that fits is left alone", async () => {
  const p = page({ worker: "/sw.js" });
  assert.equal(await healStaleWorker(p.env, asServer), false);
  assert.deepEqual(p.gone, []);
  assert.equal(p.reloads(), 0);
});

test("only the caches Vyre made are cleared; another cache of the origin stays", async () => {
  const p = page({ worker: "/sw.js", caches: ["vyre-shell-v2", "someone-else"] });
  assert.deepEqual(await clearOldData(p.env), { workers: 1, caches: 1 });
});
