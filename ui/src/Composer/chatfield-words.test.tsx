// The composer's field keeps its empty words up to date (owner walk, 12 Nov 2026): the editor is made once, and a chat that finished its turn still said "Steer Assistant…" because the placeholder was only
// read when the editor was made. The browser proof is apps/app/tests/owner-walk.polish.live.test.ts; this checks the attribute update itself.
import test from "node:test";
import assert from "node:assert/strict";
import { syncFieldWords } from "./ChatField.tsx";

function fakeDom(init: Record<string, string>): { attrs: Map<string, string>; writes: number; getAttribute(k: string): string | null; setAttribute(k: string, v: string): void } {
  const d = { attrs: new Map(Object.entries(init)), writes: 0, getAttribute: (k: string) => d.attrs.get(k) ?? null, setAttribute: (k: string, v: string) => { d.writes += 1; d.attrs.set(k, v); } };
  return d;
}

test("the empty field's words follow the chat: Steer while it works, Message once it is done", () => {
  const dom = fakeDom({ "data-placeholder": "Steer Assistant…", "aria-label": "Message" });
  syncFieldWords(dom, "Message Assistant…", "Message");
  assert.equal(dom.attrs.get("data-placeholder"), "Message Assistant…");
  assert.equal(dom.writes, 1, "an unchanged name is not written again");
  syncFieldWords(dom, "Message Assistant…", "Message");
  assert.equal(dom.writes, 1, "nothing changed, nothing written");
});
