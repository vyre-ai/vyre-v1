// Unsent text per chat, on this device: kept, cleared on send or empty, bounded.
import test from "node:test";
import assert from "node:assert/strict";
import { DRAFTS_KEY, MAX_CHARS, MAX_DRAFTS, draftOf, draftThreads, setDraft, subscribeDrafts } from "./drafts.ts";

const fake = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

test("a typed line is kept per chat and read back", () => {
  const st = fake();
  setDraft("t1", "Hello there", st);
  setDraft("t2", "Other", st);
  assert.equal(draftOf("t1", st), "Hello there");
  assert.deepEqual([...draftThreads(st)].sort(), ["t1", "t2"]);
  assert.equal(draftOf("nope", st), "");
});

test("an empty or blank line clears it (a send leaves the composer empty)", () => {
  const st = fake();
  setDraft("t1", "Hello", st);
  setDraft("t1", "   ", st);
  assert.equal(draftOf("t1", st), "");
  assert.deepEqual([...draftThreads(st)], []);
});

test("bounded: long text is cut, and the oldest chats go past the limit", () => {
  const st = fake();
  setDraft("big", "x".repeat(MAX_CHARS + 500), st, 1);
  assert.equal(draftOf("big", st).length, MAX_CHARS);
  for (let i = 0; i < MAX_DRAFTS + 5; i++) setDraft(`t${i}`, "a", st, 10 + i);
  assert.equal(draftThreads(st).size, MAX_DRAFTS);
  assert.ok(!draftThreads(st).has("big"), "the oldest went first");
  assert.ok(draftThreads(st).has(`t${MAX_DRAFTS + 4}`));
});

test("nothing breaks without storage or with a broken value; listeners hear a change once", () => {
  assert.equal(draftOf("t", null), "");
  setDraft("t", "x", null);
  const st = fake();
  st.setItem(DRAFTS_KEY, "{not json");
  assert.equal(draftOf("t", st), "");
  let n = 0;
  const off = subscribeDrafts(() => n++);
  setDraft("t", "x", st);
  setDraft("t", "", st);
  setDraft("t", "", st);
  off();
  assert.equal(n, 2, "a clear of nothing is not a change");
});
