// P-L9b_02c: the Personal Space Home as the prototype draws it (Home, Personal Space): the greeting with "Your Personal Space, on this computer only", the Get started card with
// its four rows, no section that is empty, and the quick start row with the locked Ask box at the foot.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../../home/index.tsx";
import { homeBSlots } from "../../home/sections-b/index.ts";
import { createSampleHomeB } from "../../home/sections-b/sample.ts";

const html = (v: "personal" | "northwind", o: Parameters<typeof createSampleHomeB>[1] = {}): string => {
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

test("the Get started card has four setup rows and no project or import row", () => {
  const out = html("personal");
  assert.ok(has(out, ">Get started<") && has(out, ">0 of 4<"));
  for (const t of ["Connect an AI account", "Add a photo and title", "Connect your mailbox and calendar", "Meet your assistant"]) assert.ok(has(out, t), t);
  assert.ok(!has(out, "Open your first project") && !has(out, "Import your data"));
  assert.ok(has(out, "Connect an AI account first"), "the assistant row waits for an account");
  assert.ok(has(out, ">Locked<"));
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

test("the Get started card has no Hide link (the prototype has none): it goes when every row is done", () => {
  const out = html("personal");
  assert.ok(!has(out, ">Hide<") && !has(out, 'data-testid="first-hide"'));
});

test("the Ask pill (the shared AskButton) sits beside the locked composer, with Quick start above it", () => {
  const out = html("personal");
  assert.ok(has(out, 'data-testid="ask-agent"') && has(out, 'data-testid="ask-locked"'));
  assert.ok(out.indexOf('data-testid="quick-project"') < out.indexOf('data-testid="ask-agent"') && out.indexOf('data-testid="ask-agent"') < out.indexOf('data-testid="ask-locked"'));
});
