// Unsent text per chat, on this device, per person and per Space: kept, cleared on send or empty, bounded, never read by another person on the same browser, forgotten at sign-out.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DRAFTS_PREFIX,
  MAX_CHARS,
  MAX_DRAFTS,
  OLD_DRAFTS_KEY,
  draftOf,
  draftScope,
  draftThreads,
  forgetDrafts,
  resetRetired,
  scopeOf,
  setDraft,
  subscribeDrafts,
} from "./drafts.ts";

const fake = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
    m,
  };
};
const A = draftScope("usr_ana");
const B = draftScope("usr_ben");

test("a typed line is kept per chat and read back", () => {
  const st = fake();
  setDraft("t1", "Hello there", A, st);
  setDraft("t2", "Other", A, st);
  assert.equal(draftOf("t1", A, st), "Hello there");
  assert.deepEqual([...draftThreads(A, st)].sort(), ["t1", "t2"]);
  assert.equal(draftOf("nope", A, st), "");
});

test("two people on one browser: each sees only their own drafts and pencils, even for the same chat", () => {
  const st = fake();
  setDraft("t1", "Ana's private line", A, st);
  assert.equal(draftOf("t1", B, st), "", "Ben does not read Ana's text");
  assert.deepEqual([...draftThreads(B, st)], [], "and has no pencil");
  setDraft("t1", "Ben's line", B, st);
  assert.equal(draftOf("t1", A, st), "Ana's private line");
  assert.equal(draftOf("t1", B, st), "Ben's line");
});

test("sign-out forgets the drafts of the people who sign out; signing out of everything forgets everyone's", () => {
  const st = fake();
  setDraft("t1", "x", A, st);
  setDraft("t1", "y", B, st);
  forgetDrafts(st, ["usr_ana"]);
  assert.equal(draftOf("t1", A, st), "");
  assert.equal(draftOf("t1", B, st), "y", "another person's drafts stay");
  forgetDrafts(st);
  assert.equal(draftOf("t1", B, st), "");
  assert.deepEqual(
    [...st.m.keys()].filter((k) => k.startsWith(DRAFTS_PREFIX)),
    [],
  );
});

test("the device's first shared store is deleted on the first read, and its text is never moved into anyone's drafts", () => {
  const st = fake();
  st.setItem(OLD_DRAFTS_KEY, JSON.stringify({ t1: { t: "someone's old line", at: 1 } }));
  resetRetired();
  assert.equal(draftOf("t1", A, st), "", "not attributed to the person who opens the app");
  assert.equal(st.getItem(OLD_DRAFTS_KEY), null, "deleted");
  st.setItem(OLD_DRAFTS_KEY, "again");
  forgetDrafts(st, ["usr_nobody"]);
  assert.equal(st.getItem(OLD_DRAFTS_KEY), null, "and a sign-out removes it too");
});

test("nobody signed in (no person) keeps no draft", () => {
  const st = fake();
  setDraft("t1", "x", scopeOf(undefined), st);
  assert.equal(st.m.size, 0);
});

test("an empty or blank line clears it (a send leaves the composer empty)", () => {
  const st = fake();
  setDraft("t1", "Hello", A, st);
  setDraft("t1", "   ", A, st);
  assert.equal(draftOf("t1", A, st), "");
  assert.deepEqual([...draftThreads(A, st)], []);
});

test("bounded: long text is cut, and the oldest chats go past the limit", () => {
  const st = fake();
  setDraft("big", "x".repeat(MAX_CHARS + 500), A, st, 1);
  assert.equal(draftOf("big", A, st).length, MAX_CHARS);
  for (let i = 0; i < MAX_DRAFTS + 5; i++) setDraft(`t${i}`, "a", A, st, 10 + i);
  assert.equal(draftThreads(A, st).size, MAX_DRAFTS);
  assert.ok(!draftThreads(A, st).has("big"), "the oldest went first");
});

test("nothing breaks without storage or with a broken value; listeners hear a change once", () => {
  assert.equal(draftOf("t", A, null), "");
  setDraft("t", "x", A, null);
  const st = fake();
  st.setItem(`${DRAFTS_PREFIX}${A}`, "{not json");
  assert.equal(draftOf("t", A, st), "");
  let n = 0;
  const off = subscribeDrafts(() => n++);
  setDraft("t", "x", A, st);
  setDraft("t", "", A, st);
  setDraft("t", "", A, st);
  off();
  assert.equal(n, 2, "a clear of nothing is not a change");
});
