// @tsx
// The hover on a link and the click agree (owner, 4 Nov 2026): a person who can open a helper chat never reads "You cannot open this" when they hover it.
import test from "node:test";
import assert from "node:assert/strict";
import { preview } from "./attachments.tsx";

test("a helper chat the person may open previews with its title, even when search does not list it", async () => {
  const call = (async (cap: string) => {
    if (cap === "threads.get") return { thread: { threadId: "thr_h", title: "Crew test: subagent 2", kind: "helper" } };
    if (cap === "search.resolve") return { hit: null };
    throw new Error(cap);
  }) as never;
  const p = await preview({ call }, { kind: "helper", id: "thr_h", title: "subagent 2" });
  assert.deepEqual(p, { title: "Crew test: subagent 2", line: "Helper chat" });
});

test("a thread the person may not open previews as nothing, as before, and a file still asks search", async () => {
  const none = (async (cap: string) => { if (cap === "threads.get") throw new Error("no"); return { hit: null }; }) as never;
  assert.equal(await preview({ call: none }, { kind: "thread", id: "thr_x", title: "x" }), null);
  const file = (async (cap: string) => (cap === "search.resolve" ? { hit: { title: "brief.docx", path: "Files", snippet: "" } } : { thread: {} })) as never;
  assert.deepEqual(await preview({ call: file }, { kind: "file", id: "fil_1", title: "brief" }), { title: "brief.docx", line: "Files" });
});
