import test from "node:test";
import assert from "node:assert/strict";
import { lastNotesTab, rememberNotesTab } from "./notes-tab.ts";

test("the page opens on the tab used last; Notes the first time, and when storage is absent or broken", () => {
  const m = new Map<string, string>();
  const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  assert.equal(lastNotesTab(st), "notes");
  rememberNotesTab("artifacts", st);
  assert.equal(lastNotesTab(st), "artifacts");
  rememberNotesTab("notes", st);
  assert.equal(lastNotesTab(st), "notes");
  assert.equal(lastNotesTab(null), "notes");
  rememberNotesTab("artifacts", null);
  assert.equal(
    lastNotesTab({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined,
    }),
    "notes",
  );
});
