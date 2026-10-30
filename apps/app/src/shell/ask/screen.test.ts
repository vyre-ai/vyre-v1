// The screen context Ask Vyre sends: derived from the place and the tab hash, extended by the place, dropped when the person leaves, and carried only by Ask panes.
import test from "node:test";
import assert from "node:assert/strict";
import { addScreen, carriesScreen, currentScreen, noteThreadKind, screenFromHash, setScreenContext } from "./screen.ts";

test("the hash says the place, the screen and the open object, and a place with a focus skill names it", () => {
  assert.deepEqual(screenFromHash("records", "screen=records.record-page&subject=record%3Arec_a1"), { place: "records", title: "records.record-page", open: [{ type: "record", id: "rec_a1" }], focus: "focus-records" });
  assert.deepEqual(screenFromHash("home", ""), { place: "home" });
});

test("what a place adds stays until the person leaves the page", () => {
  setScreenContext(screenFromHash("records", "subject=record%3Arec_a1"));
  addScreen({ rows: { shown: 25, total: 137 }, filters: { stage: "New" } });
  assert.deepEqual(currentScreen()?.rows, { shown: 25, total: 137 });
  assert.equal(currentScreen()?.place, "records");
  setScreenContext(screenFromHash("files", ""));
  assert.equal(currentScreen()?.rows, undefined);
  setScreenContext(null);
  assert.equal(currentScreen(), null);
});

test("only an Ask pane carries the screen", () => {
  noteThreadKind("thr_ask", "ask");
  noteThreadKind("thr_chat", "chat");
  assert.equal(carriesScreen("thr_ask"), true);
  assert.equal(carriesScreen("thr_chat"), false);
  assert.equal(carriesScreen("thr_unknown"), false);
});
