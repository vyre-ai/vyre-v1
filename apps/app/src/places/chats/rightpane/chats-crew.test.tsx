// Chats right pane > Crew (DESIGN-crew.md, step 3): the tab appears only where teammates work for the chat, one row per teammate with what it is on, a finished one offers Merge and a running one Stop, and a failed
// write becomes one quiet line. Rendered from the sample Space through the live screen query.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatRightPane } from "./ChatRightPane.tsx";
import { crewMerge, crewStop } from "./actions.ts";
import type { PaneDeps } from "./actions.ts";
import { canMerge, canStop } from "./CrewTab.tsx";
import { crewNote, tabsOf } from "./model.ts";
import type { CrewJob, TabKey } from "./model.ts";
import { SAMPLE_NOW, createSample } from "./sample.ts";
import type { Sample } from "./sample.ts";

const ALL = { start: 0, end: 500 };
const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const html = (s: Sample, tab: TabKey): string => clean(renderToStaticMarkup(<ChatRightPane data={s.data} open onToggle={() => undefined} tab={tab} window={ALL} paneWidth={640} />));
const deps = (s: Sample): { d: PaneDeps; notes: string[] } => {
  const notes: string[] = [];
  return { notes, d: { call: s.data.call, note: (text) => notes.push(text) } };
};

test("the Crew tab sits after Threads, and only when teammates work for the chat", () => {
  assert.deepEqual(tabsOf(false).map((t) => t.title), ["Computer", "Threads", "Files", "Knows", "Routines"]);
  assert.deepEqual(tabsOf(false, true).map((t) => t.title), ["Computer", "Threads", "Crew", "Files", "Knows", "Routines"]);
  assert.ok(!html(createSample(), "threads").includes(">Crew<"), "no crew, no tab");
  assert.ok(html(createSample("northwind", { crew: true }), "threads").includes(">Crew<"));
});

test("one row per teammate: its name and job, how it stands, and Merge or Stop where they apply", () => {
  const out = html(createSample("northwind", { crew: true }), "crew");
  for (const needle of ["Ember · Dark mode", "Working · started 12 min ago", "Rowan · Footer links", "Done 5 min ago · 2 files", "Quill · Docs", "Merged"]) assert.ok(out.includes(needle), needle);
  assert.ok(out.includes('data-testid="crew-merge-crw_2"'), "a finished teammate offers Merge");
  assert.ok(!out.includes('data-testid="crew-merge-crw_1"') && !out.includes('data-testid="crew-merge-crw_3"'), "only a finished one does");
  assert.ok(out.includes('data-testid="crew-stop-crw_1"') && !out.includes('data-testid="crew-stop-crw_2"'), "only a running one offers Stop");
});

test("a wait on checks is a live row with its progress", () => {
  const out = html(createSample("northwind", { crew: true }), "crew");
  assert.ok(out.includes("Checks of acme/site#12") && out.includes("Waiting · 12 of 40 done"));
  assert.ok(!html(createSample(), "crew").includes("Checks of"), "no wait, no row");
});

test("an empty crew says so in a few words", () => {
  assert.ok(html(createSample(), "crew").includes("No teammates working for this chat."));
});

test("the notes read in a few words", () => {
  const clock = { now: SAMPLE_NOW, zone: "UTC" } as never;
  const job = (over: Partial<CrewJob>): CrewJob => ({ jobId: "j", threadId: "t", leadThreadId: "l", projectId: "p", agentId: "a", title: "T", branch: "b", base: "main", state: "working", startedAt: SAMPLE_NOW - 60_000, ...over });
  assert.equal(crewNote(job({ state: "waiting" }), clock), "Waiting on you");
  assert.match(crewNote(job({ state: "failed", endedAt: SAMPLE_NOW }), clock), /^Could not finish/);
  assert.match(crewNote(job({ state: "stopped", endedAt: SAMPLE_NOW }), clock), /^Stopped/);
  assert.equal(canMerge(job({ state: "done" })), true);
  assert.equal(canMerge(job({ state: "merged" })), false);
  assert.equal(canStop(job({ state: "waiting" })), true);
});

test("Merge and Stop write through one capability each, change what the next render shows, and a failed write is one quiet line", async () => {
  const s = createSample("northwind", { crew: true });
  const { d, notes } = deps(s);
  assert.equal(await crewMerge(d, "crw_2", "Rowan", "crew/rowan-1"), true);
  assert.deepEqual(notes, ["Merged crew/rowan-1"]);
  assert.ok(html(s, "crew").includes("Rowan · Footer links") && !html(s, "crew").includes('data-testid="crew-merge-crw_2"'), "merged: no Merge any more");
  assert.equal(await crewStop(d, "crw_1", "Ember"), true);
  assert.equal(notes.at(-1), "Stopped Ember");
  s.failNext("engine.crew.merge");
  assert.equal(await crewMerge(d, "crw_3", "Quill", "crew/quill-1"), false);
  assert.equal(notes.at(-1), "Could not merge Quill's work. Try again.");
  assert.ok(s.calls.some((c) => c.cap === "engine.crew.merge" && (c.input as { idempotencyKey?: string }).idempotencyKey?.startsWith("rp-merge-")));
});

test("a Personal Space says its crew works while this computer is on; a team Space does not", () => {
  assert.ok(html(createSample("personal", { crew: true }), "crew").includes("Runs while this computer is on"));
  assert.ok(!html(createSample("northwind", { crew: true }), "crew").includes("Runs while this computer is on"));
});
