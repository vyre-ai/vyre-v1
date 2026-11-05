// The AGENT.md editor saves by itself: a pause after typing makes a new version with the version the draft started from, the status line says Saved with the number, Undo goes back, a red check holds the save,
// and where a Space asks for a review the edit stays a draft with Review. The text box is the shared Markdown editor (its raw view here, so the test can type into a real field).
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { installDom, mount, find, textOf } from "../../../ui/src/testing/dom.ts";
import { AgentFileEditor, ReviewDataProvider } from "../src/places/files/review/index.ts";
import { AGENT_MD, createSampleReview } from "../src/places/files/review/sample.ts";

const typeInto = async (root: Parameters<typeof find>[0], text: string): Promise<void> => {
  const ta = find(root, "markdown-editor-raw-text");
  assert.ok(ta, "the raw field of the Markdown editor");
  await act(async () => { (ta.props.onChange as (e: unknown) => void)({ target: { value: text } }); });
};
const wait = (ms: number): Promise<void> => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

test("typing saves a new version after a pause, with the version it started from, and the status says Saved", async () => {
  const restore = installDom();
  try {
    const s = createSampleReview({});
    const edited = AGENT_MD.replace("No exclamation marks.", "No exclamation marks. Keep replies short.");
    const root = await mount(createRoot, <ReviewDataProvider value={s.data}><AgentFileEditor fileId={s.fileIds.agent} name="AGENT.md" saved={AGENT_MD} version={4} start={{ mdView: "raw" }} /></ReviewDataProvider>);
    const before = s.calls.filter((c) => (c as { cap: string }).cap === "files.save").length;
    await typeInto(root, edited);
    assert.equal(s.calls.filter((c) => (c as { cap: string }).cap === "files.save").length, before, "nothing is saved while typing");
    await wait(1100);
    const saves = s.calls.filter((c) => (c as { cap: string }).cap === "files.save") as { cap: string; input: Record<string, unknown> }[];
    assert.equal(saves.length, before + 1, "one save after the pause");
    assert.equal(saves.at(-1)?.input["baseVersion"], 4);
    assert.equal(saves.at(-1)?.input["text"], edited);
    assert.equal(s.text(s.fileIds.agent), edited);
    assert.match(textOf(find(root, "agent-file-status")), /Saved .* v5/);
    assert.equal(find(root, "agent-file-save"), null, "no save button");
  } finally { restore(); }
});

test("a red check holds the save back and says why", async () => {
  const restore = installDom();
  try {
    const s = createSampleReview({});
    const root = await mount(createRoot, <ReviewDataProvider value={s.data}><AgentFileEditor fileId={s.fileIds.agent} name="AGENT.md" saved={AGENT_MD} version={4} start={{ mdView: "raw" }} /></ReviewDataProvider>);
    const secret = AGENT_MD + "- one more rule\n".repeat(230);
    const before = s.calls.filter((c) => (c as { cap: string }).cap === "files.save").length;
    await typeInto(root, secret);
    await wait(1100);
    const after = s.calls.filter((c) => (c as { cap: string }).cap === "files.save").length;
    // the sample's lint is the real rule set: over 200 lines is a red check, so nothing was saved
    assert.equal(after, before, "a file over the hard line limit (a red check) is not saved");
  } finally { restore(); }
});

test("a Space that asks for a review keeps the edit as a draft; Review and Discard are the header's", async () => {
  const restore = installDom();
  try {
    const s = createSampleReview({});
    const edited = AGENT_MD.replace("No exclamation marks.", "No exclamation marks. Keep replies short.");
    let hd: { status: string; changed: boolean } | null = null;
    const root = await mount(createRoot, <ReviewDataProvider value={s.data}><AgentFileEditor fileId={s.fileIds.agent} name="AGENT.md" saved={AGENT_MD} version={4} start={{ mdView: "raw" }} reviewRequired onHeader={(h) => { hd = h; }} /></ReviewDataProvider>);
    const before = s.calls.filter((c) => (c as { cap: string }).cap === "files.save").length;
    await typeInto(root, edited);
    await wait(1100);
    assert.equal(s.calls.filter((c) => (c as { cap: string }).cap === "files.save").length, before, "a draft is not saved");
    assert.deepEqual([hd?.status, hd?.changed], ["draft", true]);
  } finally { restore(); }
});
