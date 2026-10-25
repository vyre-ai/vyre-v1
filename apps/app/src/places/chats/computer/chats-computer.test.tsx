// Computer popup: the screen. About 90 percent of the window over a dimmed veil, the only controls icons on the side (Take over / Give back, Record while you are in control, Chat,
// Close), Esc closes; taking over sends your clicks and keys to the agent's desktop; recording ends in one sheet that asks what the agent should do with it, any of four things.
// Rendered from the sample computer through the live screen query. (Mapped from apps/app/tests/chats-computer.test.tsx: lane L9b owns only apps/app/src/places/chats/.)
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ComputerPopup, ComputerPopupLoading } from "./ComputerPopup.tsx";
import type { PopupInitial } from "./ComputerPopup.tsx";
import { createForwarder, discardRecording, giveBack, keepRecording, sendRecording, startRecording, stopRecording, takeOver, wake } from "./actions.ts";
import type { PopupDeps } from "./actions.ts";
import {
  DEFAULT_INTENTS, DISPLAY, DOUBLE_MS, MASKED_NOTE, NO_CAPTURE, captureLine, captureParts, keyInput, mmss, options, orderedIntents, popupView, railItems, toDisplay, toggleIntent,
} from "./model.ts";
import type { Computer, Intent, Recording } from "./model.ts";
import { COMPUTER, SAMPLE_NOW, createSample } from "./sample.ts";
import type { Sample, Variant } from "./sample.ts";

const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const html = (s: Sample, initial?: PopupInitial): string => clean(renderToStaticMarkup(<ComputerPopup data={s.data} {...(initial ? { initial } : {})} />));
const at = (s: string, needle: string): number => {
  const i = s.indexOf(needle);
  assert.ok(i >= 0, `expected ${needle}`);
  return i;
};
const has = (s: string, needle: string): boolean => s.includes(needle);
const inOrder = (s: string, needles: string[]): void => {
  const idx = needles.map((n) => at(s, n));
  assert.deepEqual([...idx].sort((a, b) => a - b), idx, `in the order ${needles.join(" > ")}`);
};
const tagOf = (out: string, testid: string): string => {
  const i = at(out, `data-testid="${testid}"`);
  return out.slice(out.lastIndexOf("<", i), out.indexOf(">", i) + 1);
};
const deps = (s: Sample): { d: PopupDeps; notes: string[] } => {
  const notes: string[] = [];
  return { notes, d: { call: s.data.call, note: (t) => notes.push(t) } };
};
const computerNow = (s: Sample): Computer => {
  const snap = s.data.screens.query("chats.computer-popup", "computer", { computerId: COMPUTER }).getSnapshot();
  assert.equal(snap.status, "ready");
  return (snap as { data: { computer: Computer } }).data.computer;
};
const saved = (): Recording => ({ recordingId: "rec_9", computerId: COMPUTER, agentId: "agt_intake", startedAt: SAMPLE_NOW - 23_000, endedAt: SAMPLE_NOW, durationMs: 23_000, folderPath: "Agents/Intake/work/recordings/2025-10-24-1000", state: "saved", intents: [] });
const SHEET: PopupInitial = { sheet: { recording: saved(), capture: { clicks: 14, pages: 3, requests: 52 }, secs: 23 } };

test("a working computer: the veil, the window with Intake working, and four icons on the side in order", () => {
  const out = html(createSample("working"));
  assert.ok(has(out, 'role="dialog"') && has(out, "Intake's computer") && has(out, 'data-testid="popup-window"'));
  assert.ok(has(out, ">Intake is working<") && has(out, 'data-testid="desk-live"'));
  inOrder(out, ['data-testid="popup-rail"', 'data-testid="rail-take"', 'data-testid="rail-chat"', 'data-testid="rail-close"']);
  assert.ok(!has(out, 'data-testid="rail-record"'), "Record appears only once you are in control");
  assert.ok(has(out, 'aria-label="Take over"') && has(out, 'aria-label="Show chat"') && has(out, 'aria-label="Close"'));
  assert.ok(!has(out, 'data-testid="record-sheet"') && !has(out, 'data-testid="popup-chat"') && !has(out, 'data-testid="popup-capture"'));
  assert.ok(!has(out, String.fromCharCode(0x2014)), "no em dash in any copy");
});

test("asleep: the last frame is dimmed with Wake, and Take over is out of reach", () => {
  const out = html(createSample("asleep"));
  assert.ok(has(out, ">Intake's computer is asleep<") && has(out, 'data-testid="desk-asleep"') && has(out, 'data-testid="popup-wake"') && has(out, ">Wake<"));
  assert.ok(has(out, "Wake Intake's computer"));
  assert.ok(has(tagOf(out, "rail-take"), 'aria-disabled="true"'), "Take over is disabled");
});

test("in your control: the pill says so, the icon flips to Give back, Record joins the rail", () => {
  const out = html(createSample("takeover"));
  assert.ok(has(out, ">You're in control · Intake is waiting<"));
  assert.ok(has(out, 'aria-label="Give back control"') && !has(out, 'aria-label="Take over"'));
  inOrder(out, ['data-testid="rail-take"', 'data-testid="rail-record"', 'data-testid="rail-chat"', 'data-testid="rail-close"']);
  assert.ok(has(out, 'aria-label="Record"'));
});

test("recording: the pill counts the time, the screen gets a red edge's counter, Record becomes Stop with a timer", () => {
  const s = createSample("takeover");
  s.capture.set({ clicks: 14, pages: 3, requests: 52 });
  const out = html(s, { recording: { recordingId: "rec_1", startedAt: SAMPLE_NOW - 23_000 } });
  assert.ok(has(out, ">Recording · 0:23<"));
  assert.ok(has(out, 'aria-label="Stop recording"') && has(out, 'data-testid="rail-timer"') && has(out, ">0:23<"));
  inOrder(out, ['data-testid="popup-capture"', ">14 clicks<", ">3 pages<", ">52 network calls<", ">Video<"]);
  assert.ok(has(tagOf(out, "rail-take"), 'aria-disabled="true"'), "Give back waits until you stop");
});

test("the sheet after a recording: what it holds, that secrets are masked, and four things the agent can do with it", () => {
  const out = html(createSample("takeover"), SHEET);
  assert.ok(has(out, 'data-testid="record-sheet"') && has(out, "Recording · 0:23") && has(out, 'data-testid="sheet-dur"'));
  assert.ok(has(out, "Video, 14 clicks and keystrokes, 3 pages, 52 network calls.") && has(out, MASKED_NOTE));
  assert.ok(has(out, "What should Intake do with it?"));
  inOrder(out, ['data-testid="opt-make_skill"', 'data-testid="opt-learn_routine"', 'data-testid="opt-work_out_backend_calls"', 'data-testid="opt-learn_workflow"']);
  for (const t of ["Make a skill", "Learn a routine", "Understand the app", "Copy my workflow exactly"]) assert.ok(has(out, `>${t}<`), t);
  assert.ok(has(out, "Turn what you did into a skill Intake can run on its own, with the steps written down."));
  inOrder(out, ['data-testid="sheet-discard"', 'data-testid="sheet-save"', 'data-testid="sheet-send"']);
  assert.ok(has(out, ">Discard<") && has(out, ">Save Only<") && has(out, ">Send to Intake<"));
  assert.ok(has(tagOf(out, "opt-make_skill"), 'aria-checked="true"'), "Make a skill is picked to start with");
  assert.ok(has(tagOf(out, "opt-learn_routine"), 'aria-checked="false"'), "the others are not");
});

test("the chat icon opens the chat beside the screen, on the left, with the shell's conversation in it", () => {
  const s = createSample("working");
  const out = clean(renderToStaticMarkup(<ComputerPopup data={{ ...s.data, renderChat: (a) => <span data-testid="shell-chat">{`chat with ${a.name}`}</span> }} initial={{ chat: true }} />));
  inOrder(out, ['data-testid="popup-chat"', 'data-testid="shell-chat"', 'data-testid="popup-window"']);
  assert.ok(has(out, "chat with Intake") && has(out, 'aria-label="Hide chat"'));
  const bare = html(s, { chat: true });
  assert.ok(has(bare, "Talk to Intake while you watch."));
});

test("offline, the popup still draws the computer from the device", () => {
  const out = html(createSample("working", { online: false }));
  assert.ok(has(out, ">Intake is working<") && has(out, 'data-testid="popup-rail"'));
});

test("before data the popup draws the veil and an empty window of the right size", () => {
  assert.ok(has(clean(renderToStaticMarkup(<ComputerPopupLoading />)), 'data-testid="popup-loading"'));
  assert.ok(has(clean(renderToStaticMarkup(<ComputerPopup />)), 'data-testid="popup-loading"'));
});

/* ---------- writes ---------- */

test("Take over then Give back changes the computer's state and tells you", async () => {
  const s = createSample("working");
  const { d, notes } = deps(s);
  assert.equal(await takeOver(d, COMPUTER, "Intake"), true);
  assert.equal(computerNow(s).state, "takeover");
  assert.ok(has(html(s), "You're in control"));
  assert.equal(await giveBack(d, COMPUTER, "Intake"), true);
  assert.equal(computerNow(s).state, "working");
  assert.deepEqual(s.calls.map((c) => c.cap), ["computers.take_over", "computers.give_back"]);
  assert.deepEqual(notes, ["You're in control. Intake waits.", "Control given back to Intake"]);
});

test("Wake wakes an asleep computer", async () => {
  const s = createSample("asleep");
  const { d } = deps(s);
  assert.equal(await wake(d, COMPUTER, "Intake"), true);
  assert.equal(computerNow(s).state, "working");
});

test("Record starts a recording and Stop returns the saved one for the sheet", async () => {
  const s = createSample("takeover");
  const { d, notes } = deps(s);
  const id = await startRecording(d, COMPUTER);
  assert.equal(id, "rec_1");
  assert.equal(computerNow(s).recording, true);
  s.clock.now += 23_000;
  const r = await stopRecording(d, COMPUTER);
  assert.ok(r && r.state === "saved" && r.durationMs === 23_000);
  assert.equal(computerNow(s).recording, false);
  assert.deepEqual(s.calls.map((c) => c.cap), ["computers.record_start", "computers.record_stop"]);
  assert.equal(notes[0], "Recording. Everything you do on this screen is captured.");
});

test("Send asks the agent to process the recording with any of the four intents, in the sheet's order, and a task tracks it", async () => {
  const s = createSample("takeover");
  const { d, notes } = deps(s);
  await startRecording(d, COMPUTER);
  await stopRecording(d, COMPUTER);
  const picked = toggleIntent(toggleIntent(toggleIntent(DEFAULT_INTENTS, "learn_workflow"), "work_out_backend_calls"), "learn_routine");
  const intents = orderedIntents(picked, "Intake");
  assert.deepEqual(intents, ["make_skill", "learn_routine", "work_out_backend_calls", "learn_workflow"]);
  const task = await sendRecording(d, "rec_1", intents, "Intake");
  assert.match(task ?? "", /^tsk_rec/);
  const call = s.calls[s.calls.length - 1]!;
  assert.equal(call.cap, "computers.recording.process");
  assert.deepEqual((call.input as { intents: Intent[] }).intents, ["make_skill", "learn_routine", "work_out_backend_calls", "learn_workflow"]);
  assert.equal((call.input as { recordingId: string }).recordingId, "rec_1");
  assert.match((call.input as { idempotencyKey: string }).idempotencyKey, /^rec-rec_1-/);
  assert.equal(notes[notes.length - 1], "Sent to Intake. A task tracks it.");
});

test("each of the four intents alone is a valid send; none picked sends nothing", async () => {
  for (const key of ["make_skill", "learn_routine", "work_out_backend_calls", "learn_workflow"] as const) {
    const s = createSample("takeover");
    const { d } = deps(s);
    await startRecording(d, COMPUTER);
    await stopRecording(d, COMPUTER);
    assert.ok(await sendRecording(d, "rec_1", [key], "Intake"), key);
    assert.deepEqual((s.calls[s.calls.length - 1]!.input as { intents: string[] }).intents, [key]);
  }
  const s = createSample("takeover");
  const { d } = deps(s);
  assert.equal(await sendRecording(d, "rec_1", [], "Intake"), null);
  assert.equal(s.calls.length, 0);
});

test("Save Only keeps the recording where it is; Discard deletes it", async () => {
  const s = createSample("takeover");
  const { d, notes } = deps(s);
  keepRecording(d, "Agents/Intake/work/recordings/2025-10-24-1000");
  assert.equal(notes[0], "Saved to Agents/Intake/work/recordings/2025-10-24-1000");
  assert.equal(s.calls.length, 0, "keeping calls nothing: it is already saved");
  assert.equal(await discardRecording(d, "rec_9"), true);
  assert.deepEqual(s.calls, [{ cap: "computers.recording.delete", input: { recordingId: "rec_9" } }]);
});

test("a failed write is one quiet line, not a thrown error", async () => {
  const s = createSample("working");
  const { d, notes } = deps(s);
  s.failNext("computers.take_over");
  assert.equal(await takeOver(d, COMPUTER, "Intake"), false);
  assert.equal(computerNow(s).state, "working");
  s.failNext("computers.record_start");
  assert.equal(await startRecording(d, COMPUTER), null);
  s.failNext("computers.recording.process");
  assert.equal(await sendRecording(d, "rec_1", ["make_skill"], "Intake"), null);
  assert.deepEqual(notes, ["Could not take over. Try again.", "Could not start recording. Try again.", "Could not send the recording. Try again."]);
});

/* ---------- input while you are in control ---------- */

test("a press becomes a click at the matching point on the display; two quick presses are a double-click", async () => {
  const s = createSample("takeover");
  const { d } = deps(s);
  const f = createForwarder(d, COMPUTER);
  await f.press(320, 200, { width: 640, height: 400 }, 1000);
  await f.press(320, 200, { width: 640, height: 400 }, 1000 + DOUBLE_MS - 1);
  await f.press(320, 200, { width: 640, height: 400 }, 5000);
  assert.deepEqual(s.calls.map((c) => c.input), [
    { computerId: COMPUTER, x: 640, y: 400 },
    { computerId: COMPUTER, x: 640, y: 400, double: true },
    { computerId: COMPUTER, x: 640, y: 400 },
  ]);
});

test("typing collects into one call; a key combination sends what was typed first, then itself", async () => {
  const s = createSample("takeover");
  const { d } = deps(s);
  const f = createForwarder(d, COMPUTER);
  for (const ch of "hello") await f.key({ key: ch });
  assert.equal(s.calls.length, 0, "nothing goes until a flush or a combination");
  await f.key({ key: "l", ctrlKey: true });
  await f.key({ key: "Escape" });
  await f.key({ key: "x" });
  await f.flush();
  await f.flush();
  assert.deepEqual(s.calls.map((c) => [c.cap, c.input]), [
    ["computers.screen.type", { computerId: COMPUTER, text: "hello" }],
    ["computers.screen.key", { computerId: COMPUTER, combo: "ctrl+l" }],
    ["computers.screen.type", { computerId: COMPUTER, text: "x" }],
  ]);
});

test("a failed key or click is one quiet line", async () => {
  const s = createSample("takeover");
  const { d, notes } = deps(s);
  const f = createForwarder(d, COMPUTER);
  s.failNext("computers.screen.click");
  await f.press(1, 1, { width: 10, height: 10 }, 0);
  assert.deepEqual(notes, ["Could not send that to the screen. Try again."]);
});

/* ---------- the rules behind it ---------- */

test("pointer positions map onto the display and stay inside it", () => {
  assert.deepEqual(toDisplay(0, 0, { width: 640, height: 400 }), { x: 0, y: 0 });
  assert.deepEqual(toDisplay(640, 400, { width: 640, height: 400 }), { x: DISPLAY.width - 1, y: DISPLAY.height - 1 });
  assert.deepEqual(toDisplay(160, 100, { width: 640, height: 400 }), { x: 320, y: 200 });
  assert.deepEqual(toDisplay(-5, 9999, { width: 640, height: 400 }), { x: 0, y: DISPLAY.height - 1 });
  assert.deepEqual(toDisplay(5, 5, { width: 0, height: 0 }), { x: 0, y: 0 });
  assert.deepEqual(toDisplay(50, 50, { width: 100, height: 100 }, { width: 200, height: 100 }), { x: 100, y: 50 });
});

test("keys: text for what you type, combinations for the rest; Escape is never forwarded", () => {
  assert.deepEqual(keyInput({ key: "a" }), { kind: "text", text: "a" });
  assert.deepEqual(keyInput({ key: "A", shiftKey: true }), { kind: "text", text: "A" });
  assert.deepEqual(keyInput({ key: "Enter" }), { kind: "combo", combo: "Return" });
  assert.deepEqual(keyInput({ key: "ArrowDown", shiftKey: true }), { kind: "combo", combo: "shift+Down" });
  assert.deepEqual(keyInput({ key: "l", ctrlKey: true }), { kind: "combo", combo: "ctrl+l" });
  assert.deepEqual(keyInput({ key: "T", ctrlKey: true, shiftKey: true }), { kind: "combo", combo: "ctrl+shift+t" });
  assert.deepEqual(keyInput({ key: "c", metaKey: true }), { kind: "combo", combo: "super+c" });
  assert.equal(keyInput({ key: "Escape" }), null);
  assert.equal(keyInput({ key: "Shift", shiftKey: true }), null);
});

test("the pill and the rail follow the computer's state", () => {
  const base: Computer = { computerId: "c", agentId: "a", state: "working", tabs: 1, tabLimit: 8, host: "server", recording: false };
  assert.deepEqual(popupView(base, "Intake", null), { screen: "live", pill: "Intake is working" });
  assert.deepEqual(popupView({ ...base, state: "asleep" }, "Intake", null), { screen: "asleep", pill: "Intake's computer is asleep" });
  assert.equal(popupView({ ...base, state: "takeover" }, "Intake", null).pill, "You're in control · Intake is waiting");
  assert.equal(popupView({ ...base, state: "takeover" }, "Intake", 83).pill, "Recording · 1:23");
  assert.equal(popupView({ ...base, state: "error" }, "Intake", null).screen, "error");
  assert.deepEqual(railItems(base, null, false).map((r) => r.key), ["take", "chat", "close"]);
  assert.deepEqual(railItems({ ...base, state: "takeover" }, null, false).map((r) => r.key), ["take", "record", "chat", "close"]);
  const rec = railItems({ ...base, state: "takeover" }, 5, true);
  assert.deepEqual(rec.map((r) => [r.key, r.on, r.disabled]), [["take", true, true], ["record", true, false], ["chat", true, false], ["close", false, false]]);
  assert.equal(rec[1]?.timer, "0:05");
  assert.equal(railItems({ ...base, state: "asleep" }, null, false)[0]?.disabled, true);
  assert.equal(railItems({ ...base, state: "waking" }, null, false)[0]?.disabled, true);
});

test("words for the recording", () => {
  assert.equal(mmss(0), "0:00");
  assert.equal(mmss(75), "1:15");
  assert.equal(mmss(-3), "0:00");
  assert.deepEqual(captureParts({ clicks: 1, pages: 1, requests: 1 }), ["1 click", "1 page", "1 network call", "Video"]);
  assert.deepEqual(captureParts(NO_CAPTURE), ["0 clicks", "1 page", "0 network calls", "Video"]);
  assert.equal(captureLine({ clicks: 14, pages: 3, requests: 52 }), "Video, 14 clicks and keystrokes, 3 pages, 52 network calls.");
  assert.deepEqual(options("Intake").map((o) => o.key), ["make_skill", "learn_routine", "work_out_backend_calls", "learn_workflow"]);
});

test("the sheet's choices: any of them, never none", () => {
  assert.deepEqual(toggleIntent(["make_skill"], "make_skill"), ["make_skill"], "the last one stays");
  assert.deepEqual(toggleIntent(["make_skill"], "learn_routine"), ["make_skill", "learn_routine"]);
  assert.deepEqual(toggleIntent(["make_skill", "learn_routine"], "make_skill"), ["learn_routine"]);
  assert.deepEqual(orderedIntents(["learn_workflow", "make_skill"], "Intake"), ["make_skill", "learn_workflow"]);
});

test("variants exist for the screenshots", () => {
  const variants: Variant[] = ["working", "asleep", "takeover"];
  for (const v of variants) assert.ok(createSample(v).data.computerId.length > 0, v);
});
