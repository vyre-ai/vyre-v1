// P-L1_16 (spec 2.23, ARCH 5.11): Star and Follow are synced entities in every profile and converge across devices; the flags they set keep a starred row on a phone whatever its age, admit a starred or
// followed record the person does not own, and survive a restart; the toggle is optimistic and queued offline.
import test from "node:test";
import assert from "node:assert/strict";
import { createNodeDriver, loadCatalog, openReplica } from "../src/replica/index.ts";
import type { ReplicaStore } from "../src/replica/index.ts";
import { createStarred } from "../src/starred/index.ts";
import type { Starred } from "../src/starred/index.ts";

const ME = "prs_me";
const NOW = 1_700_000_000_000;
let tick = 0;
const hlc = (): string => `${(NOW + ++tick).toString(16).padStart(12, "0")}-0001-dev1`;

function device(cls: "phone" | "desktop" | "web", driver = createNodeDriver()): { store: ReplicaStore; driver: ReturnType<typeof createNodeDriver>; st: Starred } {
  const store = openReplica({ driver, deviceClass: cls, registryHash: "h1", personId: ME, clock: () => NOW });
  let n = 0;
  const st = createStarred({
    store, person: ME, actor: ME, clock: () => NOW, hlc, newId: () => `op-${cls}-${++n}`, newTrace: () => String(++n).padStart(32, "0"), recordEntities: () => ["contact"],
  });
  return { store, driver, st };
}

test("star and follow are synced in every profile: all three device classes hold the rows", () => {
  const cat = loadCatalog();
  for (const key of ["star", "follow"]) {
    const e = cat.get(key);
    assert.ok(e, `${key} is a synced entity`);
    assert.deepEqual(e.profile, { desktop: "all", phone: "all", web: "all" });
    assert.equal(e.ownerField, "person");
  }
});

test("a toggle writes the row and queues stars.toggle at once, offline; unstar queues the opposite; Also follow shows the follow immediately", () => {
  const { store, st } = device("phone");
  const r = { type: "thread", id: "thr_1" };
  st.toggleStar(r, true);
  assert.equal(st.isStarred(r), true);
  assert.equal(store.read("star", "str_thread.thr_1")?.resourceId, "thr_1");
  assert.equal(store.pendingCount(), 1);
  assert.deepEqual(store.isKept("thread", "thr_1"), { starred: true, follows: false });
  st.toggleStar(r, false);
  assert.equal(st.isStarred(r), false);
  assert.notEqual(store.read("star", "str_thread.thr_1")?.deleted_at, null);
  assert.equal(store.pendingCount(), 2);
  assert.deepEqual(store.isKept("thread", "thr_1"), { starred: false, follows: false });
  const person = { type: "record", id: "rec_co" };
  st.toggleStar(person, true, true);
  assert.equal(st.isFollowing(person), true);
  assert.deepEqual(st.starred().map((x) => x.id), ["rec_co"]);
  st.toggleFollow({ type: "thread", id: "thr_2" }, true);
  assert.deepEqual(st.following().map((x) => x.id).sort(), ["rec_co", "thr_2"]);
});

test("a star made on one device converges on the others: the server's row, applied through onRow, sets the flags", () => {
  const phone = device("phone"), desk = device("desktop");
  const r = { type: "thread", id: "thr_9" };
  desk.st.toggleStar(r, true);
  const row = desk.store.read("star", "str_thread.thr_9");
  assert.ok(row);
  // The server echoes the row to the phone.
  assert.equal(phone.store.write({ entity: "star", id: "str_thread.thr_9", fields: { person: ME, resourceType: "thread", resourceId: "thr_9", createdAt: NOW }, hlc: hlc(), actor: ME, origin: "mirror" }).applied, true);
  phone.st.onRow("star", { person: ME, resourceType: "thread", resourceId: "thr_9" });
  assert.equal(phone.st.isStarred(r), true);
  assert.deepEqual(phone.store.isKept("thread", "thr_9"), { starred: true, follows: false });
  // Unstar on the desktop: the removal reaches the phone.
  desk.st.toggleStar(r, false);
  phone.st.onRow("star", { person: ME, resourceType: "thread", resourceId: "thr_9", deleted_at: NOW });
  assert.equal(phone.st.isStarred(r), false);
  assert.deepEqual(phone.store.isKept("thread", "thr_9"), { starred: false, follows: false });
  // Another person's row is not mine.
  phone.st.onRow("star", { person: "prs_other", resourceType: "thread", resourceId: "thr_x" });
  assert.equal(phone.st.isStarred({ type: "thread", id: "thr_x" }), false);
});

test("on a phone a starred thread outlives the 200-row window, and a starred or followed record the person does not own is admitted", () => {
  const { store, st } = device("phone");
  const old = { type: "thread", id: "thr_000" };
  st.toggleStar(old, true);
  for (let i = 0; i < 205; i++) {
    const id = `thr_${String(i).padStart(3, "0")}`;
    store.write({ entity: "thread", id, fields: { title: id, createdAt: NOW + i * 1000, updated_at: NOW + i * 1000 }, hlc: hlc(), actor: ME, origin: "mirror" });
  }
  assert.ok(store.read("thread", "thr_000"), "the oldest thread is starred and stays");
  assert.equal(store.read("thread", "thr_001"), null, "an unstarred old thread was trimmed");
  assert.ok(store.read("thread", "thr_204"));

  const other = (id: string) => store.write({ entity: "contact", id, fields: { name: id, owner: "prs_other" }, hlc: hlc(), actor: ME, origin: "mirror" });
  assert.equal(other("rec_a").reason, "not_owned");
  st.toggleStar({ type: "record", id: "rec_b" }, true);
  st.toggleFollow({ type: "record", id: "rec_c" }, true);
  assert.equal(other("rec_b").applied, true, "starred before it arrived");
  assert.equal(other("rec_c").applied, true, "followed before it arrived");
  assert.equal(other("rec_a").reason, "not_owned");
});

test("refresh rebuilds the flags from the rows after a restart, and recheck flags a record that arrived after its star", () => {
  const driver = createNodeDriver();
  const first = device("phone", driver);
  first.st.toggleStar({ type: "thread", id: "thr_s" }, true);
  first.st.toggleFollow({ type: "record", id: "rec_f" }, true);
  first.st.toggleStar({ type: "thread", id: "thr_gone" }, true);
  first.st.toggleStar({ type: "thread", id: "thr_gone" }, false);
  const second = device("phone", driver);
  assert.deepEqual(second.store.isKept("thread", "thr_s"), { starred: true, follows: false }, "the store reloads replica_keep");
  second.st.refresh(driver);
  assert.deepEqual(second.st.starred().map((x) => x.id), ["thr_s"]);
  assert.deepEqual(second.st.following().map((x) => x.id), ["rec_f"]);
  assert.deepEqual(second.store.isKept("contact", "rec_f"), { starred: false, follows: true });
  assert.deepEqual(second.store.isKept("thread", "thr_gone"), { starred: false, follows: false });
  second.st.recheck();
});
