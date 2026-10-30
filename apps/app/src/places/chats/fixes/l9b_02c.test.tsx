// P-L9b_02c: the Personal Space Home as the prototype draws it (Home, Personal Space): the greeting with "Your Personal Space, on this computer only", the setup card with
// the person's onboarding steps, no section that is empty, and the quick start row with the locked Ask box at the foot.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../../home/index.tsx";
import { homeBSlots } from "../../home/sections-b/index.ts";
import { createSampleHomeB } from "../../home/sections-b/sample.ts";
import { setSetupHidden } from "../../home/sections-b/Checklist.tsx";
import { publishProgress } from "../../../onboarding/store.ts";

const html = (v: "personal" | "northwind", o: Parameters<typeof createSampleHomeB>[1] = {}): string => {
  publishProgress({ flow: "personal", progress: {} });
  setSetupHidden(false);
  const h = createSampleHomeB(v, o);
  const { top, bottom } = homeBSlots(h.extras);
  return renderToStaticMarkup(<Home data={h.data} top={top} bottom={bottom} personal={v === "personal"} />).replaceAll("<!-- -->", "");
};
const has = (s: string, needle: string): boolean => s.includes(needle);

test("the subtitle reads Your Personal Space, on this computer only", () => {
  const out = html("personal");
  assert.ok(has(out, "Friday, October 24 · Your Personal Space"), "the date line carries the subtitle");
  assert.ok(has(out, " · Your Personal Space, on this computer only"));
  assert.ok(!has(out, "Nothing is waiting on you"));
});

test("the setup card lists the onboarding steps, with no separate Get started list", () => {
  const out = html("personal");
  assert.ok(has(out, ">Set up<") && has(out, ">0 of 8<"));
  for (const t of ["Connect your AI", "How you work", "Bring your sessions", "Local folders", "Chrome extension", "Your phone", "First win", "Add a team"]) assert.ok(has(out, t), t);
  assert.ok(!has(out, ">Get started<") && !has(out, "Add a photo and title") && !has(out, "Open your first project") && !has(out, "Import your data"));
});

test("sections with nothing in them are not drawn", () => {
  const out = html("personal");
  for (const id of ["s-needs", "s-work", "s-risk", "s-away", "s-routines", "s-today", "s-starred"]) assert.ok(!has(out, `data-testid="${id}"`), id);
  for (const t of ["Needs you", "My work", "While you were away", "Star a chat, record, file or terminal"]) assert.ok(!has(out, t), t);
});

test("the foot keeps the quick start row and the locked Ask box", () => {
  const out = html("personal");
  for (const id of ["quick-project", "quick-record", "quick-upload", "ask-locked"]) assert.ok(has(out, `data-testid="${id}"`), id);
  assert.ok(has(out, "Connect an AI account to ask your assistant"));
});

test("a Personal Space with starred things draws Starred, and a Team Space still draws every section", () => {
  const out = html("personal", { stars: [{ resource: { type: "thread", id: "thr_1" }, title: "Notes with Assistant", at: 1 }] });
  assert.ok(has(out, 'data-testid="s-starred"') && has(out, "Notes with Assistant"));
  const team = html("northwind");
  for (const id of ["s-needs", "s-work", "s-away", "s-routines", "s-today", "s-starred"]) assert.ok(has(team, `data-testid="${id}"`), id);
  assert.ok(!has(team, "Your Personal Space"));
});

test("the setup card has Hide checklist (the prototype's Home): it goes when every step is done", () => {
  const out = html("personal");
  assert.ok(has(out, "Hide checklist") && has(out, 'data-testid="first-hide"'));
});

test("the Ask pill (the shared AskButton) sits beside the locked composer, with Quick start above it", () => {
  const out = html("personal");
  assert.ok(has(out, 'data-testid="ask-agent"') && has(out, 'data-testid="ask-locked"'));
  assert.ok(out.indexOf('data-testid="quick-project"') < out.indexOf('data-testid="ask-agent"') && out.indexOf('data-testid="ask-agent"') < out.indexOf('data-testid="ask-locked"'));
});
