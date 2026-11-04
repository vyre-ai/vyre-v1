// ui/Time: the Space reading with the viewer's beside it, nothing extra for the same clock or a private place, both zones on a long press, and the plain-string forms.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { find, flush, installDom, mount, textOf } from "../testing/dom.ts";
import { LONG_PRESS_MS, When, ZonesProvider, dueText, whenText } from "./index.tsx";

const PT = "America/Los_Angeles", PK = "Asia/Karachi";
const NOW = Date.parse("2026-11-05T15:00:00Z");           // 7:00 AM Pacific, 8:00 PM Karachi
const NINE = Date.parse("2026-11-06T17:00:00Z");           // Fri 9:00 AM Pacific, 10:00 PM Karachi

test("a goal check-in reads 9:00 AM Pacific with 10:00 PM your time beside it for someone in Karachi", async () => {
  installDom();
  const root = await mount(createRoot, <ZonesProvider value={{ space: PT, viewer: PK }}><When at={NINE} now={NOW} testID="w" /></ZonesProvider>);
  assert.equal(textOf(find(root, "w")).replace(/\s+/g, " "), "Tomorrow 9:00 AM (10:00 PM your time)");
  assert.equal(textOf(find(root, "w-mine")).trim(), "(10:00 PM your time)");
});

test("the viewer in the Space's own zone sees one reading; a private place reads in the viewer's zone only", async () => {
  installDom();
  const same = await mount(createRoot, <ZonesProvider value={{ space: PT, viewer: PT }}><When at={NINE} now={NOW} testID="w" /></ZonesProvider>);
  assert.equal(textOf(find(same, "w")).trim(), "Tomorrow 9:00 AM");
  assert.equal(find(same, "w-mine"), null);
  const priv = await mount(createRoot, <ZonesProvider value={{ space: PT, viewer: PK }}><When at={NINE} now={NOW} personal testID="p" /></ZonesProvider>);
  assert.equal(textOf(find(priv, "p")).trim(), "Tomorrow 10:00 PM", "your own zone, nothing beside it");
});

test("a long press shows both zones and the full date; pressing the line closes it", async () => {
  installDom();
  const root = await mount(createRoot, <ZonesProvider value={{ space: PT, viewer: PK }}><When at={NINE} now={NOW} testID="w" /></ZonesProvider>);
  assert.equal(find(root, "w-full"), null);
  await act(async () => { (find(root, "w")!.props["onPointerDown"] as () => void)(); await new Promise((r) => setTimeout(r, LONG_PRESS_MS + 80)); });
  await flush();
  assert.match(textOf(find(root, "w-full")), /^Fri 6 Nov 2026, 9:00 AM Pacific Time\. Your time: Fri 6 Nov, 10:00 PM Pakistan/);
  assert.equal(find(root, "w")!.props["accessibilityLabel"] ?? find(root, "w")!.props["aria-label"], textOf(find(root, "w-full")), "the same words are the label");
  const quick = await mount(createRoot, <ZonesProvider value={{ space: PT, viewer: PK }}><When at={NINE} now={NOW} testID="q" /></ZonesProvider>);
  await act(async () => { (find(quick, "q")!.props["onPointerDown"] as () => void)(); (find(quick, "q")!.props["onPointerUp"] as () => void)(); await new Promise((r) => setTimeout(r, LONG_PRESS_MS + 80)); });
  assert.equal(find(quick, "q-full"), null, "a tap is not a long press");
});

test("the plain string forms: a check-in line and a deadline line, each with the viewer's time in brackets", () => {
  assert.equal(whenText(NINE, NOW, { space: PT, viewer: PK }), "Tomorrow 9:00 AM (10:00 PM your time)");
  assert.equal(whenText(NINE, NOW, { space: PT, viewer: PT }), "Tomorrow 9:00 AM");
  const due = Date.parse("2026-11-07T21:00:00Z");   // Sat 7 Nov 1:00 PM Pacific, 2:00 AM Sunday Karachi
  assert.equal(dueText(due, { space: PT, viewer: PK }), "Sat 7 Nov, 1:00 PM (2:00 AM, Sun 8 Nov your time)");
  assert.equal(dueText(due, { space: PT, viewer: PT }), "Sat 7 Nov, 1:00 PM");
});
