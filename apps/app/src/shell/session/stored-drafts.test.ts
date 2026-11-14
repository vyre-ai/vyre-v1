// @tsx
// Signing out forgets the unsent text kept for the people who sign out, whatever the app is served from: a browser tab (the app's origin is the Space's address) and the desktop app (it is not).
import test from "node:test";
import assert from "node:assert/strict";
import { clearStored, writeStored } from "./stored.ts";
import { OLD_DRAFTS_KEY, draftOf, scopeOf, setDraft } from "../../places/chats/conversation/drafts.ts";

const store = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
};
const def = { spaceId: "spc_nw", name: "Northwind" } as never;

for (const [shape, origin] of [
  ["a browser tab (served from the Space's own address)", "https://northwind.test"],
  ["the desktop app (served from another origin than the Space)", "app://vyre.local"],
] as const) {
  test(`sign-out clears the leaving person's drafts and no one else's, in ${shape}`, () => {
    (globalThis as { location?: unknown }).location = { origin };
    const st = store();
    writeStored({ baseUrl: "https://northwind.test", token: "a", def, personId: "usr_ana", marker: "m" }, st);
    writeStored({ baseUrl: "https://harbor.test", token: "b", def, personId: "usr_ben", marker: "m" }, st);
    setDraft("t1", "Ana's line", scopeOf("usr_ana"), st);
    setDraft("t1", "Ben's line", scopeOf("usr_ben"), st);
    st.setItem(OLD_DRAFTS_KEY, "{}");
    clearStored(st, "https://northwind.test");
    assert.equal(draftOf("t1", scopeOf("usr_ana"), st), "", "Ana signed out of Northwind: her line is gone");
    assert.equal(draftOf("t1", scopeOf("usr_ben"), st), "Ben's line", "Ben is still signed in to Harbor");
    assert.equal(st.getItem(OLD_DRAFTS_KEY), null);
    clearStored(st);
    assert.equal(draftOf("t1", scopeOf("usr_ben"), st), "", "signing out of everything clears every line");
    delete (globalThis as { location?: unknown }).location;
  });
}

test("sign-out forgets the Notes tab held for the person, so the next person starts on Notes", async () => {
  const { lastNotesTab, rememberNotesTab } = await import("../../places/chats/notes/notes-tab.ts");
  const st = store();
  rememberNotesTab("artifacts");
  assert.equal(lastNotesTab(), "artifacts");
  clearStored(st);
  assert.equal(lastNotesTab(), "notes");
});
