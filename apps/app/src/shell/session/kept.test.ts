// @tsx
// What this device keeps of a Space between launches (kept.ts): one record per Space and person, only the reads on the list, capped, and gone at once when it is forgotten.
import test from "node:test";
import assert from "node:assert/strict";
import { KEPT_MAX_AGE_MS, KEPT_MAX_READS, createKept, keptKey, mayKeep, sealWith, unsealWith } from "./kept.ts";
import type { KeptSpace, KeptStore } from "./kept.ts";

function memoryStore(): KeptStore & { rows: Map<string, KeptSpace>; puts: number } {
  const rows = new Map<string, KeptSpace>();
  const s = {
    rows,
    puts: 0,
    get: async (key: string) => (rows.has(key) ? (JSON.parse(JSON.stringify(rows.get(key))) as KeptSpace) : null),
    put: async (v: KeptSpace) => {
      s.puts += 1;
      rows.set(v.key, JSON.parse(JSON.stringify(v)) as KeptSpace);
    },
    delete: async (key: string) => void rows.delete(key),
    clear: async () => rows.clear(),
  };
  return s;
}
function memoryLocal(): Pick<Storage, "getItem" | "setItem"> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}
const IMRAN = { baseUrl: "https://northwind.example", personId: "usr_imran", spaceId: "spc_north" };
const ANDREA = { baseUrl: "https://northwind.example", personId: "usr_andrea", spaceId: "spc_north" };
const BOOT = {
  who: { principal: { id: "usr_imran" } },
  space: { id: "spc_north" },
  switcher: null,
  kit: null,
  face: null,
  console: false,
};
const tick = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

/** A keeper whose writes run when the test says so. */
function keeper(o: { store?: KeptStore; local?: ReturnType<typeof memoryLocal>; now?: () => number } = {}) {
  const store = o.store ?? memoryStore();
  const local = o.local ?? memoryLocal();
  const waiting: (() => void)[] = [];
  const k = createKept({
    store,
    local,
    ...(o.now ? { now: o.now } : {}),
    later: (fn) => {
      waiting.push(fn);
      return () => {
        const at = waiting.indexOf(fn);
        if (at >= 0) waiting.splice(at, 1);
      };
    },
  });
  return { k, store: store as ReturnType<typeof memoryStore>, local, run: () => waiting.splice(0).forEach((f) => f()) };
}

test("only reads a person sees in a list or on a page are kept: never the Vault, keys, sign-in, invites or the Console", () => {
  for (const cap of ["chats.sidebar", "chat.recent", "channels.list", "files.list", "records.query", "goals.list"])
    assert.equal(mayKeep(cap), true, cap);
  for (const cap of [
    "vault.items.list",
    "vault.item.reveal",
    "identity.keys_get",
    "identity.whoami",
    "members.invites.list",
    "console.nav",
    "providers.list",
    "devices.list",
    "automations.webhook_url.get",
    "files.share_external",
    "chat.post",
  ])
    assert.equal(mayKeep(cap), false, cap);
});

test("an answer kept in one launch is there in the next, for the same person and Space only", async () => {
  const a = keeper();
  const s = a.k.session(IMRAN);
  s.saveBoot(BOOT);
  s.wrote("chats.sidebar", {}, { rail: 2 }, 10);
  s.wrote("vault.items.list", {}, { items: ["a secret's name"] }, 30);
  a.run();
  await tick();
  assert.equal(a.k.has(IMRAN), true, "the mark that a first screen is kept");
  // the next launch: a new keeper over the same store
  const b = keeper({ store: a.store, local: a.local });
  assert.equal(b.k.ready(IMRAN), null, "nothing is used before the store has been read");
  await b.k.warm(IMRAN);
  const again = b.k.session(IMRAN);
  assert.deepEqual(again.read("chats.sidebar", {}), { data: { rail: 2 } });
  assert.equal(again.read("vault.items.list", {}), undefined, "a Vault read was never kept");
  assert.deepEqual((again.boot() as { who: unknown }).who, BOOT.who);
  // another person at the same address, and the same person in another Space, read nothing of it
  await b.k.warm(ANDREA);
  assert.equal(b.k.session(ANDREA).read("chats.sidebar", {}), undefined);
  assert.equal(b.k.has(ANDREA), false);
  const other = { ...IMRAN, spaceId: "spc_other" };
  await b.k.warm(other);
  assert.equal(b.k.session(other).read("chats.sidebar", {}), undefined);
});

test("a Space on this computer is the same record on whatever port it answers; any other Space is named with its address", () => {
  assert.equal(
    keptKey({ baseUrl: "http://127.0.0.1:4100", personId: "p", spaceId: "s" }),
    keptKey({ baseUrl: "http://127.0.0.1:52000", personId: "p", spaceId: "s" }),
  );
  assert.notEqual(
    keptKey({ baseUrl: "https://a.example", personId: "p", spaceId: "s" }),
    keptKey({ baseUrl: "https://b.example", personId: "p", spaceId: "s" }),
  );
});

test("forgetting takes effect at once: the record is void before the stored copy is deleted, and a session opened before it writes nothing more", async () => {
  const a = keeper();
  const s = a.k.session(IMRAN);
  s.saveBoot(BOOT);
  s.wrote("chats.sidebar", {}, { rail: 2 }, 10);
  a.run();
  await tick();
  // a store that never finishes its delete: a tab closed in the middle of sign-out
  const stuck: KeptStore = {
    ...a.store,
    delete: () => new Promise<void>(() => undefined),
    clear: () => new Promise<void>(() => undefined),
  };
  const b = keeper({ store: stuck, local: a.local });
  await b.k.warm(IMRAN);
  const open = b.k.session(IMRAN);
  assert.deepEqual(open.read("chats.sidebar", {}), { data: { rail: 2 } });
  b.k.forget(IMRAN);
  assert.equal(b.k.has(IMRAN), false);
  assert.equal(open.read("chats.sidebar", {}), undefined, "the open session reads nothing of it any more");
  open.wrote("chats.sidebar", {}, { rail: 9 }, 10); // an answer that arrives after sign-out
  b.run();
  await tick();
  // the stored copy is still there (the delete never finished), and the next launch does not use it
  assert.ok(a.store.rows.has(keptKey(IMRAN)));
  const c = keeper({ store: stuck, local: a.local });
  assert.equal(await c.k.warm(IMRAN), null);
  assert.equal(c.k.session(IMRAN).read("chats.sidebar", {}), undefined);
  assert.equal(c.k.session(IMRAN).boot(), null);
});

test("forgetting everything voids every record", async () => {
  const a = keeper();
  a.k.session(IMRAN).wrote("chats.sidebar", {}, { rail: 2 }, 10);
  a.k.session(ANDREA).wrote("chats.sidebar", {}, { rail: 5 }, 10);
  a.run();
  await tick();
  a.k.forget();
  const b = keeper({ store: { ...a.store, clear: async () => undefined }, local: a.local });
  assert.equal(await b.k.warm(IMRAN), null);
  assert.equal(await b.k.warm(ANDREA), null);
});

test("an answer not read again for 7 days goes, and the record is capped, oldest first", async () => {
  let t = 1_000_000;
  const a = keeper({ now: () => t });
  const s = a.k.session(IMRAN);
  s.wrote("chat.thread", { threadId: "old" }, { title: "old" }, 10);
  t += KEPT_MAX_AGE_MS + 1;
  for (let i = 0; i < KEPT_MAX_READS + 20; i++) {
    t += 1;
    s.wrote("chat.thread", { threadId: `t${i}` }, { title: `t${i}` }, 10);
  }
  a.run();
  await tick();
  const b = keeper({ store: a.store, local: a.local, now: () => t });
  await b.k.warm(IMRAN);
  const again = b.k.session(IMRAN);
  assert.equal(again.read("chat.thread", { threadId: "old" }), undefined);
  assert.equal(
    again.read("chat.thread", { threadId: "t0" }),
    undefined,
    "the oldest went when the record was over its cap",
  );
  assert.deepEqual(again.read("chat.thread", { threadId: `t${KEPT_MAX_READS + 19}` }), {
    data: { title: `t${KEPT_MAX_READS + 19}` },
  });
});

test("a refused read is dropped from the record, and a browser without a store keeps nothing and breaks nothing", async () => {
  const a = keeper();
  const s = a.k.session(IMRAN);
  s.wrote("chat.thread", { threadId: "t1" }, { title: "Plans" }, 10);
  s.drop("chat.thread", { threadId: "t1" });
  a.run();
  await tick();
  const b = keeper({ store: a.store, local: a.local });
  await b.k.warm(IMRAN);
  assert.equal(b.k.session(IMRAN).read("chat.thread", { threadId: "t1" }), undefined);

  const none = createKept({ store: null, local: undefined });
  assert.equal(await none.warm(IMRAN), null);
  const ns = none.session(IMRAN);
  ns.wrote("chats.sidebar", {}, { rail: 1 }, 10);
  ns.flush();
  assert.equal(none.has(IMRAN), false);
  none.forget(IMRAN);
  none.forget();
});

test("the stored copy is encrypted: the text of an answer is not in it, another key or a changed copy opens nothing, and the age is seven days", async () => {
  assert.equal(KEPT_MAX_AGE_MS, 7 * 24 * 3_600_000);
  const k1 = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const k2 = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const rec = {
    v: 1 as const,
    key: "k",
    at: 5,
    reads: { r: { cap: "tasks.list", input: {}, data: { title: "Quarterly filing" }, at: 5, size: 10 } },
  };
  const sealed = await sealWith(k1, rec);
  assert.ok(!Buffer.from(sealed.ct).toString("utf8").includes("Quarterly"));
  assert.deepEqual(await unsealWith(k1, sealed), rec);
  assert.equal(await unsealWith(k2, sealed), null, "another key opens nothing");
  const changed = { ...sealed, ct: sealed.ct.slice(0) };
  new Uint8Array(changed.ct)[3]! ^= 1;
  assert.equal(await unsealWith(k1, changed), null, "a changed copy opens nothing");
  assert.equal(await unsealWith(k1, { v: 1 }), null);
});
