// "Finish setup, Hide" is the person's own state on the Space (state.layout.*), not a key in the browser: the next person on a browser does not inherit it, and a second device of the same person reads it.
import test from "node:test";
import assert from "node:assert/strict";
import { SETUP_HIDDEN_KEY, hideSetup, loadHidden, retireOldHiddenKeys } from "./store.ts";

/** The Space's per-person layout store, as the state module answers it: one row per person and key. */
function space() {
  const rows = new Map<string, unknown>();
  const as = (person: string) => async (cap: string, input: unknown) => {
    const i = input as { key?: string; keys?: string[]; value?: unknown };
    if (cap === "state.layout.set") {
      rows.set(`${person}|${i.key}`, i.value);
      return { value: { key: i.key, value: i.value } };
    }
    if (cap === "state.layout.get") {
      return {
        values: (i.keys ?? []).flatMap((k) =>
          rows.has(`${person}|${k}`) ? [{ key: k, value: rows.get(`${person}|${k}`) }] : [],
        ),
      };
    }
    throw new Error(`${cap} is not asked`);
  };
  return { as, rows };
}

test("two people on one browser: what one hid is not hidden for the other", async () => {
  const sp = space();
  const ana = sp.as("usr_ana");
  const ben = sp.as("usr_ben");
  await hideSetup(ana as never, "team", {});
  assert.deepEqual(await loadHidden(ana as never), { team: true });
  assert.deepEqual(await loadHidden(ben as never), {}, "Ben's entry still shows");
});

test("one person on two devices: the second device reads that it is hidden, and hiding a second flow keeps the first", async () => {
  const sp = space();
  const laptop = sp.as("usr_ana");
  const phone = sp.as("usr_ana");
  await hideSetup(laptop as never, "team", {});
  const onPhone = await loadHidden(phone as never);
  assert.deepEqual(onPhone, { team: true });
  await hideSetup(phone as never, "personal", onPhone);
  assert.deepEqual(await loadHidden(laptop as never), { team: true, personal: true });
  assert.ok(sp.rows.has(`usr_ana|${SETUP_HIDDEN_KEY}`));
});

test("a read that fails says nothing is hidden: the entry shows, the safe side", async () => {
  const failing = async () => {
    throw new Error("offline");
  };
  assert.deepEqual(await loadHidden(failing as never), {});
});

test("the old browser-wide keys are deleted on load and never become anyone's hidden flag", async () => {
  const m = new Map<string, string>([
    ["vyre.setup.hidden.team", "1"],
    ["vyre.setup.hidden.personal", "1"],
    ["vyre.session.v1", "keep"],
  ]);
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
  try {
    retireOldHiddenKeys();
    assert.deepEqual([...m.keys()], ["vyre.session.v1"]);
    assert.deepEqual(await loadHidden(space().as("usr_ben") as never), {}, "not migrated into a person's state");
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
