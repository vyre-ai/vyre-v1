import test from "node:test";
import assert from "node:assert/strict";
import { findSpace, findSpaceQuietly, relayName } from "./find-space.ts";

const routes = async () => [
  { method: "POST", path: "/v1/identity/sign_in_options", cap: "identity.sign_in_options", v: 1 },
];
const json = (status: number, body: unknown, cors = false): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(cors ? { "access-control-allow-origin": "*" } : {}),
    },
  });
const html = (status: number): Response =>
  new Response("<!doctype html><title>Vyre</title>", { status, headers: { "content-type": "text/html" } });
const HEALTH = { ok: true, version: "1.0.0-rc.41", roles: ["space"], space: "spc_01NORTH", head: 1, startedAt: 1 };
const INFO = { name: "northwind", label: "Northwind", route: "r1", relay: "wss://relay.vyre.run", online: true };

type Answer = (url: string, init?: RequestInit) => Response | Promise<Response>;
function fake(answer: Answer): { fetch: typeof fetch; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      asked.push(`${init?.mode === "no-cors" ? "nocors " : ""}${new URL(url).pathname}`);
      return answer(url, init);
    }) as typeof fetch,
  };
}
/** A browser refuses to show a cross-origin answer with no CORS header: the read fails, a no-cors ask still resolves. */
const blocked = (init?: RequestInit): Response => {
  if (init?.mode === "no-cors") return new Response(null, { status: 200 });
  throw new TypeError("Failed to fetch");
};
const down = (): never => {
  throw new TypeError("Failed to fetch");
};

test("a Space server that answers at its own name is direct, whatever the name", async () => {
  const f = fake((url) => (url.endsWith("/healthz") ? json(200, HEALTH) : html(404)));
  assert.deepEqual(await findSpace("https://northwind.vyre.run", { fetch: f.fetch, routes }), { kind: "direct" });
  assert.deepEqual(await findSpace("https://space.northwind.example", { fetch: f.fetch, routes }), { kind: "direct" });
});

test("a name the relay holds is a relay Space, with its nickname and whether its computer is awake", async () => {
  const f = fake((url, init) => (url.endsWith("/__vyre/info.json") ? json(200, INFO, true) : blocked(init)));
  assert.deepEqual(await findSpace("https://northwind.vyre.run", { fetch: f.fetch, routes }), {
    kind: "relay",
    sure: true,
    label: "Northwind",
    online: true,
    seenAt: null,
  });
  const asleep = fake((url, init) =>
    url.endsWith("/__vyre/info.json")
      ? json(200, { ...INFO, online: false, computers: [{ label: "Office", online: false, seenAt: 1700 }] }, true)
      : blocked(init),
  );
  const got = await findSpace("https://northwind.vyre.run", { fetch: asleep.fetch, routes });
  assert.deepEqual(got, { kind: "relay", sure: true, label: "Northwind", online: false, seenAt: 1700 });
});

test("a relay from before it answered other pages: something answers at the name, so the name rule stands and it is said to be unsure", async () => {
  const f = fake((_url, init) => blocked(init));
  assert.deepEqual(await findSpace("https://northwind.vyre.run", { fetch: f.fetch, routes }), {
    kind: "relay",
    sure: false,
    label: "",
    online: true,
    seenAt: null,
  });
});

test("a name nobody holds is no Space, said for certain only when the relay says so", async () => {
  const f = fake((url, init) =>
    url.endsWith("/__vyre/info.json") ? json(404, { name: "northwnd", held: false }, true) : blocked(init),
  );
  assert.deepEqual(await findSpace("https://northwnd.vyre.run", { fetch: f.fetch, routes }), { kind: "none" });
});

test("nothing answers at all: offline, for a vyre.run name and for an address of its own", async () => {
  const f = fake(down);
  assert.deepEqual(await findSpace("https://northwind.vyre.run", { fetch: f.fetch, routes }), { kind: "offline" });
  assert.deepEqual(await findSpace("https://space.northwind.example", { fetch: f.fetch, routes }), {
    kind: "offline",
  });
  // an address of its own is never asked as a relay name
  assert.equal(
    f.asked.some((a) => a.includes("/__vyre/")),
    true,
  );
  const own = fake(down);
  await findSpace("https://space.northwind.example", { fetch: own.fetch, routes });
  assert.equal(
    own.asked.some((a) => a.includes("/__vyre/")),
    false,
  );
});

test("an address of its own that answers, but not as a Space this page can read, is there: not offline, not a Space", async () => {
  const f = fake((_url, init) => blocked(init));
  assert.deepEqual(await findSpace("https://www.northwind.example", { fetch: f.fetch, routes }), { kind: "there" });
});

test("the page's own address answering with a server error (the Space's server is down behind its proxy) is a Space that is not answering", async () => {
  const f = fake(() => new Response("Bad Gateway", { status: 502, headers: { "content-type": "text/plain" } }));
  assert.deepEqual(await findSpace("https://space.northwind.example", { fetch: f.fetch, routes }), {
    kind: "offline",
  });
});

test("an address that is not http or https is no Space", async () => {
  const f = fake(down);
  assert.deepEqual(await findSpace("ftp://northwind.vyre.run", { fetch: f.fetch, routes }), { kind: "none" });
  assert.deepEqual(f.asked, []);
});

test("relayName reads only what the relay says: a page of a Space server at the name is not the relay", async () => {
  const f = fake(() => html(200));
  assert.deepEqual(await relayName("https://northwind.vyre.run", { fetch: f.fetch }), { held: null, answered: true });
});

test("the quiet retry: offline is asked again before it is said, and the screen hears about each new try", async () => {
  let n = 0;
  // the Space answers its /healthz on the third ask (the no-cors "is anything there" ask is not one of them)
  const f = fake((url, init) => {
    if (url.endsWith("/healthz") && init?.mode !== "no-cors" && ++n >= 3) return json(200, HEALTH);
    throw new TypeError("Failed to fetch");
  });
  const heard: number[] = [];
  const waited: number[] = [];
  const got = await findSpaceQuietly("https://space.northwind.example", {
    fetch: f.fetch,
    routes,
    wait: async (ms) => void waited.push(ms),
    onRetry: (i) => heard.push(i),
  });
  assert.deepEqual(got, { kind: "direct" });
  assert.deepEqual(heard, [1, 2], "two quiet retries, each announced");
  assert.equal(waited.length, 2);
});

test("the quiet retry gives up after its tries and answers offline; a sure answer is never asked twice", async () => {
  const f = fake(down);
  const heard: number[] = [];
  const got = await findSpaceQuietly("https://space.northwind.example", {
    fetch: f.fetch,
    routes,
    wait: async () => undefined,
    onRetry: (i) => heard.push(i),
  });
  assert.deepEqual(got, { kind: "offline" });
  assert.deepEqual(heard, [1, 2]);
  const sure = fake((url, init) => (url.endsWith("/__vyre/info.json") ? json(200, INFO, true) : blocked(init)));
  const calls: number[] = [];
  await findSpaceQuietly("https://northwind.vyre.run", {
    fetch: sure.fetch,
    routes,
    wait: async () => undefined,
    onRetry: (i) => calls.push(i),
  });
  assert.deepEqual(calls, [], "a relay Space that answered is not retried");
});

test("a Space of its own that was slow to answer the first probe is not called a relay Space on the name alone", async () => {
  let health = 0;
  const f = fake((url) => {
    if (url.endsWith("/healthz")) return ++health === 1 ? down() : json(200, HEALTH);
    return html(200); // the Space's own page answers /__vyre/info.json with its app, which is no relay answer
  });
  assert.deepEqual(await findSpace("https://northwind.vyre.run", { fetch: f.fetch, routes }), { kind: "direct" });
  assert.equal(health, 2, "asked once more before it was called a relay Space");
});
