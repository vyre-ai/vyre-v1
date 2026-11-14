// The Notes tab used last is the person's own state on the Space: Notes the first time and when the read fails, the same on every device of one person, never inherited by another person on the browser; the old browser key is deleted.
import test from "node:test";
import assert from "node:assert/strict";
import {
  NOTES_TAB_KEY,
  forgetNotesTab,
  lastNotesTab,
  loadNotesTab,
  rememberNotesTab,
  retireOldNotesTabKey,
} from "./notes-tab.ts";

/** The Space's per-person layout store, as the state module answers it. */
function space() {
  const rows = new Map<string, unknown>();
  const as =
    (person: string) =>
    async (cap: string, input: Record<string, unknown>): Promise<unknown> => {
      if (cap === "state.layout.set") {
        rows.set(`${person}|${String(input["key"])}`, input["value"]);
        return {};
      }
      if (cap === "state.layout.get")
        return {
          values: ((input["keys"] as string[]) ?? []).flatMap((k) =>
            rows.has(`${person}|${k}`) ? [{ key: k, value: rows.get(`${person}|${k}`) }] : [],
          ),
        };
      throw new Error(`${cap} is not asked`);
    };
  return { as, rows };
}

test("Notes the first time, and when the read fails", async () => {
  forgetNotesTab();
  assert.equal(lastNotesTab(), "notes");
  assert.equal(
    await loadNotesTab((async () => {
      throw new Error("offline");
    }) as never),
    "notes",
  );
});

test("one person on two devices: the tab used on the laptop is the tab the phone opens on", async () => {
  const sp = space();
  forgetNotesTab();
  rememberNotesTab("artifacts", sp.as("usr_ana") as never);
  await Promise.resolve();
  assert.equal(sp.rows.get(`usr_ana|${NOTES_TAB_KEY}`), "artifacts");
  forgetNotesTab(); // the phone has held nothing yet
  assert.equal(await loadNotesTab(sp.as("usr_ana") as never), "artifacts");
  assert.equal(lastNotesTab(), "artifacts");
});

test("two people on one browser: the next person starts on Notes, not on the first person's tab", async () => {
  const sp = space();
  forgetNotesTab();
  rememberNotesTab("artifacts", sp.as("usr_ana") as never);
  await Promise.resolve();
  assert.equal(lastNotesTab(), "artifacts", "Ana's page holds her tab");
  assert.equal(
    await loadNotesTab(sp.as("usr_ben") as never),
    "notes",
    "Ben has none: his sidebar's read replaces what Ana's left",
  );
  assert.equal(lastNotesTab(), "notes");
});

test("remembering without a call only holds the tab for this page", () => {
  forgetNotesTab();
  rememberNotesTab("artifacts");
  assert.equal(lastNotesTab(), "artifacts");
  forgetNotesTab();
});

test("the old browser-wide key is deleted, never moved", async () => {
  const m = new Map<string, string>([["vyre.notes_tab.v1", "artifacts"]]);
  (globalThis as { localStorage?: unknown }).localStorage = {
    removeItem: (k: string) => void m.delete(k),
    getItem: (k: string) => m.get(k) ?? null,
  };
  try {
    forgetNotesTab();
    retireOldNotesTabKey();
    assert.equal(m.size, 0);
    assert.equal(lastNotesTab(), "notes", "its value is not anyone's tab");
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test("a read that fails does not leave the person before's tab: Notes until it answers", async () => {
  forgetNotesTab();
  rememberNotesTab("artifacts");
  assert.equal(
    await loadNotesTab((async () => {
      throw new Error("offline");
    }) as never),
    "notes",
  );
});

test("the tab is written only when it changed", async () => {
  const writes: unknown[] = [];
  const call = (async (cap: string, input: Record<string, unknown>) => {
    if (cap === "state.layout.set") writes.push(input["value"]);
    return {};
  }) as never;
  forgetNotesTab();
  rememberNotesTab("artifacts", call);
  rememberNotesTab("artifacts", call);
  rememberNotesTab("notes", call);
  rememberNotesTab("notes", call);
  assert.deepEqual(writes, ["artifacts", "notes"]);
  forgetNotesTab();
});
