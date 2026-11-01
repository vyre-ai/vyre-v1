// The crew result card in the lead's chat (DESIGN-crew.md, step 3): what the teammate changed in a few words, Merge lands the branch and the card collapses to one line, Send back tells the teammate what to
// change, a failed write is one quiet line, and the card is right after a reload because it reads the job's state from the crew list.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import { CrewResultCard, cardOf, isCrewResult, statsLine } from "./crew-card.tsx";

installDom();

const block = (over: Record<string, unknown> = {}) => ({
  id: "blk_1", type: "crew_result", v: 1, state: "done", traceId: "t",
  data: { jobId: "crw_1", threadId: "thr_mate", agentId: "agt_ember", name: "Ember", title: "Dark mode", branch: "crew/ember-1", base: "main", state: "done", ahead: 2,
    files: [{ path: "theme.ts", added: 30, deleted: 4 }, { path: "theme.test.ts", added: 22, deleted: 0 }], text: "Added the toggle. The test passes.", ...over },
}) as never;

const job = (state: string) => ({ jobId: "crw_1", threadId: "thr_mate", leadThreadId: "thr_lead", projectId: "p", agentId: "agt_ember", title: "Dark mode", branch: "crew/ember-1", base: "main", state, startedAt: 1 });

function data(calls: { cap: string; input: unknown }[], o: { state?: string; fail?: string; landed?: boolean; held?: boolean; pushNote?: string } = {}) {
  const opened: string[] = [];
  return {
    opened,
    d: {
      call: async (cap: string, input: unknown) => {
        calls.push({ cap, input });
        if (o.fail === cap) throw new Error("no");
        if (cap === "engine.crew.list") return { jobs: [job(o.state ?? "done")] };
        if (cap === "engine.crew.merge") return { job: job(o.landed === false ? "done" : "merged"), landed: o.landed !== false, ref: "crew/ember-1", ...(o.landed === false ? { note: "The repository has uncommitted changes. The work is on crew/ember-1." } : {}) };
        if (cap === "engine.crew.message") return { sent: true };
        if (cap === "engine.crew.push") return o.held ? { status: "held", taskId: "tsk_1" } : { job: job("merged"), pushed: o.pushNote === undefined, ...(o.pushNote ? { note: o.pushNote } : {}) };
        return {};
      },
      nav: { openThread: (id: string) => opened.push(id) },
    } as never,
  };
}

test("the words: stats in a few words, a block read defensively", () => {
  assert.equal(statsLine({ commits: 2, files: [{ path: "a", added: 1, deleted: 0 }, { path: "b", added: 1, deleted: 0 }] }), "2 commits · 2 files");
  assert.equal(statsLine({ commits: 1, files: [{ path: "a", added: 1, deleted: 0 }] }), "1 commit · 1 file");
  assert.equal(statsLine({ commits: 0, files: [] }), "No changes");
  assert.equal(isCrewResult({ type: "crew_result" }), true);
  assert.deepEqual(cardOf({ data: null } as never), { jobId: "", threadId: "", name: "A teammate", title: "", branch: "", state: "done", commits: 0, files: [], text: "" });
});

test("the card says who finished what, how much changed and what the teammate said, and offers Merge, Send back and Open thread", async () => {
  const { d } = data([]);
  const root = await mount(createRoot, <CrewResultCard block={block()} leadThreadId="thr_lead" data={d} />);
  const t = textOf(find(root, "crew-card-crw_1"));
  for (const needle of ["Ember finished Dark mode", "crew/ember-1", "2 commits · 2 files", "theme.ts", "+30", "-4", "The test passes.", "Merge", "Send back", "Open thread"]) assert.ok(t.includes(needle), needle);
});

test("Merge lands the branch through one capability and the card collapses to one line", async () => {
  const calls: { cap: string; input: unknown }[] = [];
  const { d } = data(calls);
  const root = await mount(createRoot, <CrewResultCard block={block()} leadThreadId="thr_lead" data={d} />);
  await press(find(root, "crew-merge-crw_1"));
  await flush();
  const merge = calls.find((c) => c.cap === "engine.crew.merge")!;
  assert.equal((merge.input as { jobId: string }).jobId, "crw_1");
  assert.match((merge.input as { idempotencyKey: string }).idempotencyKey, /^card-merge-crw_1-/);
  assert.match(textOf(find(root, "crew-card-crw_1")), /Merged · Ember: Dark mode/);
  assert.equal(find(root, "crew-merge-crw_1"), null, "no buttons after the merge");
});

test("a merge that cannot land says why and leaves the card as it was", async () => {
  const { d } = data([], { landed: false });
  const root = await mount(createRoot, <CrewResultCard block={block()} leadThreadId="thr_lead" data={d} />);
  await press(find(root, "crew-merge-crw_1"));
  await flush();
  assert.match(textOf(find(root, "crew-line-crw_1")), /uncommitted changes/);
  assert.ok(find(root, "crew-merge-crw_1"), "Merge is still there");
});

test("a failed merge is one quiet line", async () => {
  const { d } = data([], { fail: "engine.crew.merge" });
  const root = await mount(createRoot, <CrewResultCard block={block()} leadThreadId="thr_lead" data={d} />);
  await press(find(root, "crew-merge-crw_1"));
  await flush();
  assert.match(textOf(find(root, "crew-line-crw_1")), /Could not merge/);
});

test("Send back takes the words and tells the teammate in its own thread", async () => {
  const calls: { cap: string; input: unknown }[] = [];
  const { d } = data(calls);
  const root = await mount(createRoot, <CrewResultCard block={block()} leadThreadId="thr_lead" data={d} />);
  await press(find(root, "crew-back-crw_1"));
  assert.equal(find(root, "crew-merge-crw_1"), null, "the buttons give way to the box");
  await typeInto(find(root, "crew-back-input-crw_1")!, "Use the system theme by default.");
  await press(find(root, "crew-back-send-crw_1"));
  await flush();
  assert.equal((calls.find((c) => c.cap === "engine.crew.message")!.input as { body: string }).body, "Use the system theme by default.");
  assert.match(textOf(find(root, "crew-line-crw_1")), /Sent back to Ember/);
});

test("Open thread opens the teammate's own thread; a failed teammate has no Merge", async () => {
  const { d, opened } = data([]);
  const root = await mount(createRoot, <CrewResultCard block={block({ state: "failed" })} leadThreadId="thr_lead" data={d} />);
  assert.equal(find(root, "crew-merge-crw_1"), null);
  assert.match(textOf(find(root, "crew-card-crw_1")), /Ember could not finish Dark mode/);
  await press(find(root, "crew-open-crw_1"));
  assert.deepEqual(opened, ["thr_mate"]);
});

test("after a reload the card reads the job and shows a merged one as one line", async () => {
  const { d } = data([], { state: "merged" });
  const root = await mount(createRoot, <CrewResultCard block={block()} leadThreadId="thr_lead" data={d} />);
  await flush();
  assert.match(textOf(find(root, "crew-card-crw_1")), /Merged · Ember: Dark mode/);
});

test("a merged card offers Push, which holds for approval and says so", async () => {
  const calls: { cap: string; input: unknown }[] = [];
  const { d } = data(calls, { state: "merged", held: true });
  const root = await mount(createRoot, <CrewResultCard block={block()} leadThreadId="thr_lead" data={d} />);
  await flush();
  assert.ok(find(root, "crew-push-crw_1"), "a merged card offers Push");
  await press(find(root, "crew-push-crw_1"));
  await flush();
  assert.equal((calls.find((c) => c.cap === "engine.crew.push")!.input as { jobId: string }).jobId, "crw_1");
  assert.match(textOf(find(root, "crew-line-crw_1")), /Waiting for approval\. It is in Needs you\./);
});

test("a push that lands says so, one that cannot says why", async () => {
  const ok = await mount(createRoot, <CrewResultCard block={block()} leadThreadId="thr_lead" data={data([], { state: "merged" }).d} />);
  await flush();
  await press(find(ok, "crew-push-crw_1"));
  await flush();
  assert.match(textOf(find(ok, "crew-card-crw_1")), /Merged · Ember: Dark mode/);
  const no = await mount(createRoot, <CrewResultCard block={block()} leadThreadId="thr_lead" data={data([], { state: "merged", pushNote: "The project repository has no remote called origin." }).d} />);
  await flush();
  await press(find(no, "crew-push-crw_1"));
  await flush();
  assert.match(textOf(find(no, "crew-line-crw_1")), /no remote called origin/);
});
