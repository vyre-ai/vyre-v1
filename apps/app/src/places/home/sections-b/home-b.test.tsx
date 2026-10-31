// Home sections B: the screen. The first-run checklist sits above Needs you; Today, Starred and the Ask box follow the routines. Every row is a ui/Row with slots. The Personal
// Space variant hides what needs a connected account and says "Needs a Team Space" where a Team Space is required. Writes change what the next render shows.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { screensById } from "../../../../../../generated/screens.ts";
import Home from "../index.tsx";
import { homeBSlots } from "./index.ts";
import { startAsk, unstar } from "./actions.ts";
import { setSetupHidden } from "./Checklist.tsx";
import { publishProgress } from "../../../onboarding/store.ts";
import type { ActionDeps } from "./actions.ts";
import { createSampleHomeB } from "./sample.ts";
import type { SampleHomeB } from "./sample.ts";
import { asDevice } from "../../../onboarding/test-device.ts";

installComposerForTests(Composer);

// The setup card is the person's onboarding steps, read from the onboarding host's published progress (a Space whose host has not published draws none).
const setup = (flow: "personal" | "team" | "member" | null, progress: Record<string, "done" | "later"> = {}): void => { publishProgress(flow ? { flow, progress } : null); setSetupHidden(false); };
// These tests mean a browser: it has no sessions or folders, so the setup card counts six steps ("0 of 6"). The Mac app's eight are checked in chats/fixes/l9b_02c.test.tsx.
const html = (h: SampleHomeB): string => asDevice("web", () => {
  const { top, bottom } = homeBSlots(h.extras);
  return renderToStaticMarkup(<Home data={h.data} top={top} bottom={bottom} personal={h.extras.space.kind === "personal"} />).replaceAll("<!-- -->", "");
});
const at = (s: string, needle: string): number => {
  const i = s.indexOf(needle);
  assert.ok(i >= 0, `expected ${needle}`);
  return i;
};
const has = (s: string, needle: string): boolean => s.includes(needle);
const deps = (h: SampleHomeB): { d: ActionDeps; notes: { text: string; undo: () => Promise<void> | void }[] } => {
  const notes: { text: string; undo: () => Promise<void> | void }[] = [];
  return { notes, d: { call: h.data.call, note: (text, undo) => notes.push({ text, undo }) } };
};

test("the sections run: checklist on top, then Needs you down to Routines, then Today, Starred and the Ask box", () => {
  setup("member");
  const out = html(createSampleHomeB("firstrun"));
  const ids = ["s-first", "s-needs", "s-work", "s-away", "s-routines", "s-today", "s-starred", "s-ask"].map((id) => at(out, `data-testid="${id}"`));
  assert.deepEqual([...ids].sort((a, b) => a - b), ids);
  setup("member", { mine: "done", ai: "done", apps: "done", interview: "done", agents: "done", personal: "done" });
  const done = html(createSampleHomeB("northwind"));
  assert.ok(!has(done, 'data-testid="s-first"'), "a finished checklist leaves the page");
  assert.ok(at(done, 'data-testid="s-routines"') < at(done, 'data-testid="s-today"') && at(done, 'data-testid="s-today"') < at(done, 'data-testid="s-starred"') && at(done, 'data-testid="s-starred"') < at(done, 'data-testid="s-ask"'));
});

// the test page is a browser, so the steps are the six a browser shows (no sessions or folders)
test("Home draws the person's onboarding steps and the count follows their progress", () => {
  setup("personal");
  const h = createSampleHomeB("personal");
  assert.ok(has(html(h), ">0 of 6<"));
  setup("personal", { ai: "done" });
  const out = html(h);
  assert.ok(has(out, ">1 of 6<"));
  assert.ok(has(out, 'data-testid="first-setup-interview"') && has(out, 'data-testid="first-go-setup-interview"'));
  assert.ok(!has(out, 'data-testid="first-go-setup-ai"'), "a done step has no button");
  setup("personal", { ai: "done", interview: "later" });
  assert.ok(has(html(h), "Skipped") && has(html(h), ">Resume<"), "a step put off says so and offers Resume");
});

test("Today shows the day in order with Now, Next and Join, and the past event is quiet without a Join", () => {
  const out = html(createSampleHomeB());
  for (const title of ["Team standup", "Pruitt retainer check-in", "Rivera intake call", "Review Q4 billing", "Weekly planning"]) assert.ok(has(out, title), title);
  const order = ["Team standup", "Pruitt retainer check-in", "Rivera intake call", "Review Q4 billing", "Weekly planning"].map((t) => at(out, `>${t}<`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(has(out, "4 left"));
  assert.ok(has(out, ">Now<") && has(out, ">Next<"));
  assert.ok(!has(out, 'data-testid="today-join-evt_stand"'), "the 9:00 standup is over: no Join");
  assert.ok(has(out, 'data-testid="today-join-evt_rivera"') && has(out, 'data-testid="today-join-evt_bill"'));
  assert.ok(has(out, "11:30 am to 12:00 pm · Zoom"));
});

test("Today draws every row with ui/Row and its slots, never an overlay", () => {
  const out = html(createSampleHomeB());
  assert.ok(has(out, 'data-testid="row-today:evt_rivera"'));
  assert.ok(has(out, 'data-testid="row-today:evt_rivera-leading"') && has(out, 'data-testid="row-today:evt_rivera-trailing"'));
  assert.ok(has(out, 'data-testid="row-star:terminal:trm_dev-leading"'));
});

test("Today says so when the day is empty", () => {
  const out = html(createSampleHomeB("northwind", { events: [] }));
  assert.ok(has(out, "Nothing on your calendar today"));
});

test("Starred shows a terminal's live status and the kind of everything else, six first and Show all for the rest", () => {
  const out = html(createSampleHomeB());
  assert.ok(has(out, "Running · ready on http://localhost:3000"));
  assert.ok(has(out, 'data-testid="star-live-trm_dev"'), "a running terminal carries the live dot");
  assert.ok(has(out, "Exited 1 · Error: column amount_cents is missing") && has(out, ">Failed<"));
  assert.ok(has(out, "Exited 0 · Backed up 4,212 files"));
  assert.ok(has(out, ">Chat<") && has(out, ">Project<"));
  assert.ok(has(out, "Show all 8"));
  assert.ok(!has(out, "Weekly billing run"), "the seventh and eighth wait behind Show all");
});

test("an empty Starred section says how to fill it", () => {
  const out = html(createSampleHomeB("northwind", { stars: [] }));
  assert.ok(has(out, "Star a chat, record, file or terminal and it shows here"));
});

test("unstarring removes the row and Undo stars it again", async () => {
  const h = createSampleHomeB();
  const { d, notes } = deps(h);
  assert.ok(has(html(h), "Dev server"));
  assert.equal(await unstar(d, { type: "terminal", id: "trm_dev" }, "Dev server"), true);
  assert.ok(!has(html(h), "Running · ready on http://localhost:3000"));
  assert.equal(notes.at(-1)?.text, "Removed the star from Dev server");
  await notes.at(-1)!.undo();
  assert.ok(has(html(h), "Running · ready on http://localhost:3000"));
  assert.deepEqual(h.calls.map((c) => c.cap), ["stars.toggle", "stars.toggle"]);
});

test("a failed unstar becomes a quiet line, not a thrown error", async () => {
  const h = createSampleHomeB();
  const { d, notes } = deps(h);
  d.call = () => Promise.reject(new Error("offline"));
  assert.equal(await unstar(d, { type: "thread", id: "thr_rivera" }, "Elena Rivera"), false);
  assert.equal(notes.at(-1)?.text, "Could not remove that star. Try again.");
});

test("there is one setup card: the onboarding steps, with no separate Get started list", () => {
  setup("member");
  const out = html(createSampleHomeB("firstrun"));
  assert.ok(has(out, ">Set up<") && has(out, ">0 of 6<"));
  assert.ok(!has(out, ">Get started<") && !has(out, "Add a photo and title") && !has(out, "Connect your mailbox and calendar") && !has(out, "Meet your assistant"));
  assert.equal(out.split('data-testid="s-first"').length - 1, 1, "one card");
  for (const k of ["mine", "ai", "apps", "interview", "agents", "personal"]) assert.ok(has(out, `data-testid="first-go-setup-${k}"`), k);
});

test("each setup row is a ui/Row that grows with its content and lays out by itself: icon tile, title and note stacked, button on the right", () => {
  setup("personal");
  const out = html(createSampleHomeB("personal"));
  const row = out.slice(at(out, 'data-testid="row-first-setup-ai"'));
  assert.match(row.slice(0, 400), /min-height:44px/);
  assert.doesNotMatch(row.slice(0, 400), /[;"]height:44px/);
  assert.ok(at(row, 'data-testid="row-first-setup-ai-leading"') < at(row, ">Connect your AI<") && at(row, ">Connect your AI<") < at(row, 'data-testid="row-first-setup-ai-trailing"'));
});

test("the card goes once every step is done", () => {
  setup("personal", { ai: "done", interview: "done", sessions: "done", folders: "done", chrome: "done", phone: "done", win: "done", team: "done" });
  assert.ok(!has(html(createSampleHomeB("personal")), 'data-testid="s-first"'));
});

test("hiding the setup card leaves an Undo line, and Undo brings it back", () => {
  setup("personal");
  const h = createSampleHomeB("personal");
  assert.ok(has(html(h), 'data-testid="first-hide"'));
  setSetupHidden(true);
  assert.ok(has(html(h), "Setup hidden") && has(html(h), 'data-testid="first-undo"') && !has(html(h), 'data-testid="first-go-setup-ai"'));
  setSetupHidden(false);
  assert.ok(has(html(h), 'data-testid="first-go-setup-ai"'));
});

test("the Ask box starts a chat with the assistant and returns the thread to open", async () => {
  const h = createSampleHomeB();
  const { d } = deps(h);
  const thread = await startAsk(d, "agt_assistant", "What is waiting on me?", 1_000);
  assert.equal(thread, "thr_new1");
  const call = h.calls.find((c) => c.cap === "chat.start")!.input as { kind: string; agentIds: string[]; first: string; idempotencyKey: string };
  assert.deepEqual([call.kind, call.agentIds, call.first], ["chat", ["agt_assistant"], "What is waiting on me?"]);
  assert.match(call.idempotencyKey, /^home-ask-1000-\d+$/);
  const again = await startAsk(d, "agt_assistant", "Another", 1_000);
  assert.notEqual(again, null);
  const keys = h.calls.filter((c) => c.cap === "chat.start").map((c) => (c.input as { idempotencyKey: string }).idempotencyKey);
  assert.equal(new Set(keys).size, 2, "two asks never share a key");
});

test("a failed ask returns null and says so", async () => {
  const h = createSampleHomeB();
  const { d, notes } = deps(h);
  d.call = () => Promise.reject(new Error("no"));
  assert.equal(await startAsk(d, "agt_assistant", "Hello", 5), null);
  assert.equal(notes.at(-1)?.text, "Could not start that chat. Try again.");
});

test("the Ask box is a composer for the assistant; without an AI account it is locked and says how to unlock", () => {
  const open = html(createSampleHomeB());
  assert.ok(has(open, 'data-testid="ask-box"') && has(open, "Ask your assistant…"));
  assert.ok(has(open, 'data-testid="ask-agent"') && !has(open, "will reply"), "the agent is the Ask pill beside the box, not a line under it");
  assert.ok(!has(open, 'data-testid="ask-locked"'));
  const locked = html(createSampleHomeB("firstrun"));
  assert.ok(has(locked, 'data-testid="ask-locked"') && has(locked, "Connect an AI account to ask your assistant"));
  assert.ok(!has(locked, 'data-testid="ask-box"'));
  for (const id of ["quick-project", "quick-record", "quick-upload"]) assert.ok(has(open, `data-testid="${id}"`), id);
});

test("Personal Space: no Today without a calendar, no project row, and the assistant stays locked until an account is connected", () => {
  setup("personal");
  const out = html(createSampleHomeB("personal"));
  assert.ok(!has(out, 'data-testid="s-today"'), "Today needs a connected calendar");
  assert.ok(has(out, 'data-testid="s-first"') && !has(out, "Open your first project"));
  assert.ok(has(out, ">0 of 6<"));
  assert.ok(has(out, 'data-testid="ask-locked"'));
});

test("Personal Space with a calendar connected draws Today again", () => {
  const out = html(createSampleHomeB("personal", { calendarConnected: true, events: [] }));
  assert.ok(has(out, 'data-testid="s-today"') && has(out, "Nothing on your calendar today"));
});

test("Personal Space shows Needs a Team Space where a starred thing needs one, and keeps the rest", () => {
  const out = html(createSampleHomeB("personal", {
    stars: [
      { resource: { type: "computer", id: "cmp_1" }, title: "Intake computer", at: 3 },
      { resource: { type: "campaign", id: "cmp_2" }, title: "Spring mailer", at: 2 },
      { resource: { type: "terminal", id: "trm_1" }, title: "Local shell", at: 1 },
    ],
    terminals: [{ terminalId: "trm_1", state: "running", exitCode: null }],
  }));
  assert.ok(has(out, 'data-testid="needs-team-space"'));
  assert.ok(has(out, "Needs a Team Space") && has(out, "Agent computers and campaigns"));
  assert.ok(has(out, "Create or join a Team Space"));
  assert.ok(!has(out, "Intake computer") && !has(out, "Spring mailer"));
  assert.ok(has(out, "Local shell") && has(out, "Running"));
});

test("a Team Space never shows the Needs a Team Space line", () => {
  const out = html(createSampleHomeB("northwind", { stars: [{ resource: { type: "computer", id: "cmp_1" }, title: "Intake computer", at: 3 }] }));
  assert.ok(!has(out, "Needs a Team Space") && has(out, "Intake computer"));
});

test("Harbor Studio draws its own day and stars", () => {
  const out = html(createSampleHomeB("harbor"));
  assert.ok(has(out, "Moreno kickoff") && has(out, "Studio visit with Abel") && has(out, "Moreno rebrand"));
  assert.ok(!has(out, "Pruitt retainer check-in"));
});

test("the sections draw from the kept copy: offline changes nothing in Today, Starred or the checklist", () => {
  setup("member");
  const h = createSampleHomeB("firstrun", { online: false });
  const out = html(h);
  assert.ok(has(out, "Offline, showing your saved copy"));
  assert.ok(has(out, 'data-testid="s-first"') && has(out, 'data-testid="s-today"') && has(out, 'data-testid="s-starred"'));
});

test("no copy on the page uses an em dash", () => {
  const dash = String.fromCharCode(0x2014);
  for (const v of ["northwind", "harbor", "personal", "firstrun"] as const) assert.ok(!html(createSampleHomeB(v)).includes(dash), v);
});
