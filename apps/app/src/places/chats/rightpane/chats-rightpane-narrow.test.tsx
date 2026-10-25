// Chats right pane at 340 px and the routine actions added in P-L9b_09: the tab strip folds what does not fit behind a More tab (nothing is clipped, the open tab is always drawn),
// and a routine can be run now or handed to another person from the shared people picker. Rendered from the sample Space, like chats-rightpane.test.tsx.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatRightPane } from "./ChatRightPane.tsx";
import { RightPaneDataProvider } from "./data.tsx";
import type { ChatRightPaneData } from "./data.tsx";
import { RoutinesTab } from "./RoutinesTab.tsx";
import { delegateRoutine, runNow } from "./actions.ts";
import type { PaneDeps } from "./actions.ts";
import { HEADER_CHROME, MORE_KEY, PANE_WIDTH_GUESS, TABS, fitTabs, tabWidth } from "./model.ts";
import type { Routine, TabKey } from "./model.ts";
import { createSample } from "./sample.ts";
import type { Sample } from "./sample.ts";

const ALL = { start: 0, end: 500 };
const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const pane = (s: Sample, tab: TabKey, paneWidth?: number): string => clean(renderToStaticMarkup(<ChatRightPane data={s.data} open onToggle={() => undefined} tab={tab} window={ALL} {...(paneWidth ? { paneWidth } : {})} />));
const has = (s: string, needle: string): boolean => s.includes(needle);
const deps = (s: Sample): { d: PaneDeps; notes: { text: string; undo?: () => Promise<void> | void }[] } => {
  const notes: { text: string; undo?: () => Promise<void> | void }[] = [];
  return { notes, d: { call: s.data.call, note: (text, undo) => notes.push(undo ? { text, undo } : { text }) } };
};
const routinesNow = (s: Sample): Routine[] => s.replica.rows("routines") as unknown as Routine[];
const routineView = (s: Sample, routineId: string, mode: "view" | "delegate"): string => {
  const { d } = deps(s);
  return clean(renderToStaticMarkup(<RightPaneDataProvider value={s.data}><RoutinesTab deps={d} window={ALL} initial={{ routineId, mode }} /></RightPaneDataProvider>));
};

/* ---------- the strip at 340 px ---------- */

test("at 340 px the strip shows what fits and folds the rest behind More; no tab is clipped", () => {
  assert.equal(PANE_WIDTH_GUESS, 340);
  const out = pane(createSample(), "computer");
  for (const shown of ["Computer", "Threads", "Files"]) assert.ok(has(out, `>${shown}<`), `${shown} is drawn`);
  assert.ok(has(out, ">More<"), "the fold is a More tab");
  assert.ok(!has(out, ">Memory<") && !has(out, ">Routines<"), "the folded ones are not drawn half-cut");
});

test("every layout keeps the strip inside the room the header leaves", () => {
  for (const width of [280, 300, 340, 400, 500, 640]) {
    for (const active of TABS) {
      const { shown, hidden } = fitTabs(TABS, active.key, width);
      const used = shown.reduce((n, t) => n + tabWidth(t.title), 0) + (hidden.length > 0 ? tabWidth("More") + 2 : 0);
      assert.ok(used <= width - HEADER_CHROME || shown.length === 1, `${width} px, ${active.key}: ${used} fits ${width - HEADER_CHROME}`);
      assert.ok(shown.some((t) => t.key === active.key), "the open tab is always drawn");
      assert.deepEqual([...shown, ...hidden].map((t) => t.key).sort(), TABS.map((t) => t.key).sort(), "nothing is lost");
    }
  }
});

test("the open tab is drawn even when it is the last one; the others keep their order", () => {
  const out = pane(createSample(), "routines");
  assert.ok(has(out, ">Routines<") && has(out, ">More<"));
  assert.ok(out.indexOf(">Computer<") < out.indexOf(">Routines<"), "tabs keep their order");
  assert.deepEqual(fitTabs(TABS, "routines", 340).shown.map((t) => t.key), ["computer", "routines"]);
  assert.deepEqual(fitTabs(TABS, "routines", 340).hidden.map((t) => t.key), ["threads", "files", "memory"]);
});

test("wide enough, all five tabs show and there is no More", () => {
  const out = pane(createSample(), "computer", 640);
  for (const t of TABS) assert.ok(has(out, `>${t.title}<`), t.title);
  assert.ok(!has(out, ">More<"));
  assert.deepEqual(fitTabs(TABS, "files", 640).hidden, []);
  assert.equal(MORE_KEY, "more");
});

/* ---------- Run now ---------- */

test("Run now calls the routine's run capability once and says so; a failure is one quiet line", async () => {
  const s = createSample();
  const { d, notes } = deps(s);
  const r = routinesNow(s).find((x) => x.routineId === "r3")!;
  assert.equal(await runNow(d, r), true);
  assert.deepEqual(s.calls.map((c) => c.cap), ["agents.routine.run_now"]);
  const input = s.calls[0]!.input as { agentId: string; routineId: string; idempotencyKey: string };
  assert.equal(input.routineId, "r3");
  assert.equal(input.agentId, r.agentId);
  assert.ok(input.idempotencyKey.length > 0, "an idempotency key goes with it");
  assert.equal(notes.at(-1)?.text, `Running ${r.title}`);
  s.failNext("agents.routine.run_now");
  assert.equal(await runNow(d, r), false);
  assert.equal(notes.at(-1)?.text, "Could not run it. Try again.");
});

test("the routine page offers Run Now beside Change by Asking", () => {
  const out = routineView(createSample(), "r3", "view");
  assert.ok(has(out, 'data-testid="routine-run"') && has(out, ">Run Now<"));
  assert.ok(out.indexOf(">Run Now<") < out.indexOf(">Change by Asking<"));
  assert.ok(has(out, 'data-testid="routine-owner"') && has(out, ">Omar Haddad<"), "the owner is named");
});

/* ---------- Delegate ---------- */

test("Delegate lists the Space's people from the shared picker, without the current owner", () => {
  const out = routineView(createSample(), "r3", "delegate");
  assert.ok(has(out, ">Give this routine to<"));
  assert.ok(has(out, 'data-testid="delegate-usr_irfad"') && has(out, ">Irfad Imtiaz<"));
  assert.ok(has(out, 'data-testid="delegate-usr_maya"') && has(out, ">Maya Chen<"));
  assert.ok(!has(out, 'data-testid="delegate-usr_omar"'), "the owner is not offered");
  assert.ok(has(out, 'data-testid="delegate-cancel"'));
});

test("Delegate with no directory says it is loading", () => {
  const s = createSample();
  const rest: ChatRightPaneData = { ...s.data };
  delete rest.people;
  const out = clean(renderToStaticMarkup(<RightPaneDataProvider value={rest}><RoutinesTab deps={deps(s).d} window={ALL} initial={{ routineId: "r3", mode: "delegate" }} /></RightPaneDataProvider>));
  assert.ok(has(out, 'data-testid="delegate-empty"') && has(out, "The directory is still loading."));
});

test("delegating changes the owner, says so, and Undo gives it back", async () => {
  const s = createSample();
  const { d, notes } = deps(s);
  const r = routinesNow(s).find((x) => x.routineId === "r3")!;
  assert.equal(await delegateRoutine(d, r, "usr_maya", "Maya Chen"), true);
  assert.equal(routinesNow(s).find((x) => x.routineId === "r3")!.ownerId, "usr_maya");
  assert.equal(notes.at(-1)?.text, `${r.title} now belongs to Maya Chen`);
  await notes.at(-1)!.undo!();
  assert.equal(routinesNow(s).find((x) => x.routineId === "r3")!.ownerId, "usr_omar");
});

test("delegating to the current owner does nothing; a failed hand-over is one quiet line", async () => {
  const s = createSample();
  const { d, notes } = deps(s);
  const r = routinesNow(s).find((x) => x.routineId === "r3")!;
  assert.equal(await delegateRoutine(d, r, r.ownerId, "Omar Haddad"), false);
  assert.equal(s.calls.length, 0);
  s.failNext("agents.routine.delegate");
  assert.equal(await delegateRoutine(d, r, "usr_maya", "Maya Chen"), false);
  assert.equal(notes.at(-1)?.text, "Could not hand it over. Try again.");
  assert.equal(routinesNow(s).find((x) => x.routineId === "r3")!.ownerId, "usr_omar");
});
