// The composer's field keeps its empty words up to date (owner walk, 12 Nov 2026): the editor is made once, and a chat that finished its turn still said "Steer Assistant…" because the placeholder was only
// read when the editor was made. The browser proof is test/ownerwalk.polish.live.test.ts step 3; this checks that ChatField itself keeps the words in step when its props change.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { act, createElement } from "react";
import { createRoot } from "test-renderer";
import { syncFieldWords, useFieldWords } from "./ChatField.tsx";

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

test("the hook rewrites a made editor's words when the composer's placeholder changes, and ChatField uses it", async () => {
  const dom = fakeDom({ "data-placeholder": "Steer Assistant…", "aria-label": "Message" });
  const ed = { current: { view: { dom } } };
  const Probe = ({ ph }: { ph: string }) => { useFieldWords(ed as never, ph, "Message"); return null; };
  const root = createRoot();
  await act(async () => { root.render(createElement(Probe, { ph: "Steer Assistant…" })); });
  await act(async () => { root.render(createElement(Probe, { ph: "Message Assistant…" })); });
  assert.equal(dom.attrs.get("data-placeholder"), "Message Assistant…", "a change of placeholder reaches the made editor");
  // the wiring itself: ChatField calls the hook with its own editor and props (a field made once and never told again was the bug)
  const src = fs.readFileSync(new URL("./ChatField.tsx", import.meta.url), "utf8");
  assert.match(src, /useFieldWords\(ed, p\.placeholder, p\.label\)/, "ChatField keeps its editor's words in step");
});
