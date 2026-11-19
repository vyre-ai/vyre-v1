import test from "node:test";
import assert from "node:assert/strict";
import {
  forgetKnown,
  readKnown,
  rememberBrowserSpace,
  rememberSession,
  siblingSessions,
  yourSpaces,
} from "./known-spaces.ts";
import { clearStored, readStoredSessions, writeStored } from "./stored.ts";
import type { KeyValueStore, StoredSession } from "./stored.ts";
import { NORTHWIND, PERSONAL } from "../spaces/model.ts";

function memory(): KeyValueStore & { dump(): Record<string, string> } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}
const team = NORTHWIND;
const personal = PERSONAL;
const session = (over: Partial<StoredSession> = {}): StoredSession => ({
  baseUrl: "https://northwind.example",
  token: "vds_fixture",
  def: { ...team, spaceId: "spc_north", name: "Northwind" },
  personId: "per_imran",
  marker: "ab12",
  username: "imran",
  displayName: "Imran Ibarra",
  ...over,
});

test("a Space that was signed in to is remembered with the person's name, and stays after signing out", () => {
  const store = memory();
  const s = session();
  writeStored(s, store);
  rememberSession(s, store, 1000);
  assert.deepEqual(
    yourSpaces(store).map((r) => [r.name, r.person, r.state]),
    [["Northwind", "Imran Ibarra", "in"]],
  );
  clearStored(store, s.baseUrl);
  const after = yourSpaces(store);
  assert.deepEqual(
    after.map((r) => [r.name, r.person, r.username, r.state, r.address]),
    [["Northwind", "Imran Ibarra", "imran", "out", "https://northwind.example"]],
    "signing out keeps the row: one press goes to its sign-in",
  );
  assert.equal(JSON.stringify(store.dump()).includes("vds_fixture"), false, "a remembered Space never holds a token");
});

test("a saved sign-in from before the list existed shows without ever having been remembered", () => {
  const store = memory();
  writeStored(session(), store);
  assert.deepEqual(
    yourSpaces(store).map((r) => [r.name, r.state]),
    [["Northwind", "in"]],
  );
});

test("the most recently used Space comes first; this computer's Personal Space is one row whatever port it ran on", () => {
  const store = memory();
  const mine = session({
    baseUrl: "http://127.0.0.1:8421",
    def: { ...personal, spaceId: "spc_mine", name: "Personal" },
  });
  writeStored(session(), store);
  writeStored(mine, store);
  rememberSession(session(), store, 1000);
  rememberSession(mine, store, 2000);
  // the daemon took a new port: the session is saved again at the new address, the remembered row follows the Space, not the port
  clearStored(store, mine.baseUrl);
  const moved = { ...mine, baseUrl: "http://127.0.0.1:9000" };
  writeStored(moved, store);
  rememberSession(moved, store, 3000);
  assert.deepEqual(
    yourSpaces(store).map((r) => [r.name, r.address, r.state]),
    [
      ["Personal", "http://127.0.0.1:9000", "in"],
      ["Northwind", "https://northwind.example", "in"],
    ],
  );
});

test("a relay Space the app opened in the browser is a row that opens there, and signing in to it in the app later makes it an app row", () => {
  const store = memory();
  rememberBrowserSpace({ address: "https://lakeside.vyre.run", name: "Lakeside" }, store, 500);
  assert.deepEqual(
    yourSpaces(store).map((r) => [r.name, r.state, r.address]),
    [["Lakeside", "browser", "https://lakeside.vyre.run"]],
  );
  // the Space moved to an address of its own and the person signed in from the app
  const s = session({
    baseUrl: "https://lakeside.vyre.run",
    def: { ...team, spaceId: "spc_lake", name: "Lakeside" },
  });
  writeStored(s, store);
  rememberSession(s, store, 900);
  assert.deepEqual(
    yourSpaces(store).map((r) => [r.name, r.state]),
    [["Lakeside", "in"]],
  );
});

test("a saved sign-in whose Space moved to the relay keeps its sign-in and opens in the browser", () => {
  const store = memory();
  const s = session({ baseUrl: "https://northwind.vyre.run" });
  writeStored(s, store);
  rememberSession(s, store, 100);
  rememberBrowserSpace({ address: "https://northwind.vyre.run", name: "Northwind" }, store, 200);
  const [row] = yourSpaces(store);
  assert.equal(row?.state, "browser");
  assert.equal(row?.person, "Imran Ibarra", "the row still knows whose it is");
  assert.ok(row?.session, "the saved sign-in is not deleted");
});

test("broken or foreign stored data reads as nothing, and forgetting one Space leaves the others", () => {
  const store = memory();
  store.setItem("vyre.spaces.v1", "{not json");
  assert.deepEqual(readKnown(store), []);
  store.setItem(
    "vyre.spaces.v1",
    JSON.stringify({ spaces: [{ address: "javascript:alert(1)", name: "x", via: "app", usedAt: 1 }, 7, null] }),
  );
  assert.deepEqual(readKnown(store), []);
  rememberBrowserSpace({ address: "https://lakeside.vyre.run", name: "Lakeside" }, store, 1);
  rememberBrowserSpace({ address: "https://harbor.vyre.run", name: "Harbor" }, store, 2);
  forgetKnown("https://lakeside.vyre.run", store);
  assert.deepEqual(
    readKnown(store).map((k) => k.name),
    ["Harbor"],
  );
});

test("two tabs share one store: signing out in one makes the row sign-in-with-username in the other; cleared storage leaves an empty list; a revoked device is the same as signing out", () => {
  const store = memory(); // both tabs read and write the same browser storage
  const s = session();
  writeStored(s, store);
  rememberSession(s, store, 1000);
  const tabA = () => yourSpaces(store),
    tabB = () => yourSpaces(store);
  assert.equal(tabA()[0]!.state, "in");
  clearStored(store, s.baseUrl); // tab B signs out, or the Space revoked this device and the gate cleared the session
  const row = tabA()[0]!;
  assert.deepEqual([row.state, row.username, row.session], ["out", "imran", null]);
  assert.equal(tabB()[0]!.state, "out");
  for (const k of Object.keys(store.dump())) store.removeItem(k); // storage cleared
  assert.deepEqual(yourSpaces(store), []);
});

test("two saved sign-ins with one Space id are one row, the one used last; the other stays saved", () => {
  const store = memory();
  const old = session({ baseUrl: "http://127.0.0.1:4101", def: { ...personal, spaceId: "spc_me", name: "Personal" } });
  const now = session({ baseUrl: "http://127.0.0.1:4202", def: { ...personal, spaceId: "spc_me", name: "Personal" } });
  writeStored(old, store);
  writeStored(now, store);
  rememberSession(old, store, 1000);
  rememberSession(now, store, 2000);
  const rows = yourSpaces(store);
  assert.deepEqual(
    rows.map((r) => r.address),
    ["http://127.0.0.1:4202"],
  );
});

test("the other saved sign-ins of one Space id are found, and never deleted", () => {
  const store = memory();
  const a = session({ baseUrl: "https://old.example", def: { ...team, spaceId: "spc_x", name: "X" } });
  const b = session({ baseUrl: "https://new.example", def: { ...team, spaceId: "spc_x", name: "X" } });
  const c = session({ baseUrl: "https://else.example", def: { ...team, spaceId: "spc_y", name: "Y" } });
  for (const s of [a, b, c]) writeStored(s, store);
  assert.deepEqual(
    siblingSessions(a, store).map((s) => s.baseUrl),
    ["https://new.example"],
  );
  assert.deepEqual(siblingSessions(c, store), []);
  assert.equal(readStoredSessions(store).length, 3);
});
