// ui/Row: hover and selection span the full width, the height is fixed, the note sits under the title.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Row, ROW_HEIGHT, ROW_HEIGHT_WITH_NOTE, ROW_HEIGHT_TALL, rowHeight } from "./index.tsx";

test("a selected row paints the selection token on the row itself, full width", () => {
  const html = renderToStaticMarkup(<Row id="a" title="Weekly sync" selected />);
  assert.match(html, /data-testid="row-a"/);
  assert.match(html, /background-color:var\(--sel\)/);
  assert.match(html, /r-width-/, "the row carries a width style");
  assert.doesNotMatch(html, /margin-(left|right|inline)/i, "no horizontal margin that would inset the paint");
});

test("a hovered row paints the hover token and an unselected row does not paint selection", () => {
  const hov = renderToStaticMarkup(<Row id="b" title="Inbox" hovered />);
  assert.match(hov, /background-color:var\(--hover\)/);
  const plain = renderToStaticMarkup(<Row id="c" title="Inbox" />);
  assert.doesNotMatch(plain, /var\(--sel\)|var\(--hover\)/);
});

test("the height is fixed: 28 for one line, 44 with a note", () => {
  assert.equal(rowHeight(), ROW_HEIGHT);
  assert.equal(rowHeight("Updated yesterday"), ROW_HEIGHT_WITH_NOTE);
  assert.match(renderToStaticMarkup(<Row title="One" />), /height:28px/);
  assert.match(renderToStaticMarkup(<Row title="One" note="Two" />), /height:44px/);
});

test("the note renders after the title in the same text column", () => {
  const html = renderToStaticMarkup(<Row title="Launch checklist" note="Updated yesterday" />);
  assert.ok(html.indexOf("Launch checklist") < html.indexOf("Updated yesterday"));
});

test("leading and trailing slots sit inside the painted row, around the text, with no overlay", () => {
  const html = renderToStaticMarkup(<Row id="s" title="Clients" selected leading={<i>L</i>} trailing={<b>T</b>} />);
  assert.match(html, /background-color:var\(--sel\)/);
  assert.ok(html.indexOf("<i>L</i>") < html.indexOf(">Clients<") && html.indexOf(">Clients<") < html.indexOf("<b>T</b>"));
  assert.match(html, /data-testid="row-s-leading"/);
  assert.match(html, /data-testid="row-s-trailing"/);
  assert.doesNotMatch(html, /position:absolute/);
  assert.match(html, /height:28px/);
});

test("a row without slots renders no slot wrappers", () => {
  const html = renderToStaticMarkup(<Row id="n" title="Inbox" />);
  assert.doesNotMatch(html, /row-n-leading|row-n-trailing/);
});

test("the two-line variant is 62 px and its note may take two lines; the default heights are unchanged", () => {
  assert.equal(ROW_HEIGHT_TALL, 62);
  assert.equal(rowHeight("x", true), 62);
  assert.equal(rowHeight(undefined, true), 62);
  assert.equal(rowHeight(), ROW_HEIGHT);
  assert.equal(rowHeight("x"), ROW_HEIGHT_WITH_NOTE);
  const html = renderToStaticMarkup(<Row id="a" title="Maya Chen" note="Can you move Tuesday? I have a conflict that morning." tall />);
  assert.match(html, /height:62px/);
});

test("a title suffix draws muted after the name on the same line, and rows without one render as before", () => {
  const html = renderToStaticMarkup(<Row id="a" title="Maya Chen" titleSuffix="Northwind" />);
  assert.ok(html.includes('data-testid="row-a-suffix"') && html.includes("Northwind") && html.includes("Maya Chen"));
  assert.ok(html.indexOf("Maya Chen") < html.indexOf("Northwind"), "the suffix follows the name");
  assert.ok(!renderToStaticMarkup(<Row id="a" title="Maya Chen" />).includes("-suffix"));
});

test("emphasis makes the title semibold, with or without a suffix; without it the weight is untouched", () => {
  const on = renderToStaticMarkup(<Row id="a" title="Intake channel" emphasis />);
  const withSuffix = renderToStaticMarkup(<Row id="a" title="Maya Chen" titleSuffix="Northwind" emphasis />);
  const off = renderToStaticMarkup(<Row id="a" title="Intake channel" />);
  assert.match(on, /font-weight:600/);
  assert.match(withSuffix, /font-weight:600/);
  assert.ok(!off.includes("font-weight:600"));
});

test("noteLead draws an accent lead-in before the note, only with a note; rows without it are unchanged", () => {
  const html = renderToStaticMarkup(<Row id="a" title="Rivera letter" note="Two edits left" noteLead="Draft ready" />);
  assert.ok(html.includes('data-testid="row-a-notelead"') && html.includes("Draft ready") && html.includes("Two edits left"));
  assert.ok(html.includes("Draft ready</span> \u00b7 ") || html.includes("\u00b7"), "a middle dot between the lead-in and the note, as the prototype writes it");
  assert.ok(html.indexOf("Draft ready") < html.indexOf("Two edits left"), "the lead-in comes first");
  assert.match(html, /color:var\(--accent\)/);
  assert.ok(!renderToStaticMarkup(<Row id="a" title="Rivera letter" noteLead="Draft ready" />).includes("notelead"), "no note, no lead-in");
  const plain = renderToStaticMarkup(<Row id="a" title="Rivera letter" note="Two edits left" />);
  assert.ok(!plain.includes("notelead") && plain.includes("Two edits left"));
  assert.equal(rowHeight("x"), ROW_HEIGHT_WITH_NOTE, "heights are unchanged");
});

test("titleMarks draw after the title and the suffix on the title line; rows without them are unchanged", () => {
  const html = renderToStaticMarkup(<Row id="a" title="Maya Chen" titleSuffix="Northwind" titleMarks={<span data-mark="star">S</span>} />);
  assert.ok(html.includes('data-testid="row-a-marks"') && html.includes('data-mark="star"'));
  assert.ok(html.indexOf("Maya Chen") < html.indexOf("Northwind") && html.indexOf("Northwind") < html.indexOf('data-mark="star"'), "title, then suffix, then marks");
  const only = renderToStaticMarkup(<Row id="a" title="Maya Chen" titleMarks={<span data-mark="dnd">D</span>} />);
  assert.ok(only.includes('data-testid="row-a-marks"') && !only.includes("-suffix") && only.indexOf("Maya Chen") < only.indexOf('data-mark="dnd"'), "marks work without a suffix");
  const plain = renderToStaticMarkup(<Row id="a" title="Maya Chen" />);
  assert.ok(!plain.includes("-marks"));
  assert.equal(rowHeight(), ROW_HEIGHT, "heights are unchanged");
});

test("noteLeadTone picks the lead-in colour: accent by default, warning on request; the note keeps its own colour", () => {
  const accent = renderToStaticMarkup(<Row id="a" title="Rivera" note="Maya Chen at Northwind" noteLead="Draft ready" />);
  const warn = renderToStaticMarkup(<Row id="a" title="Rivera" note="Maya Chen at Northwind" noteLead="Unsure match" noteLeadTone="warning" />);
  const explicit = renderToStaticMarkup(<Row id="a" title="Rivera" note="n" noteLead="Draft ready" noteLeadTone="accent" />);
  assert.match(accent, /color:var\(--accent\)/);
  assert.ok(!accent.includes("var(--warn)"), "the default is not the warning colour");
  assert.match(warn, /color:var\(--warn\)/);
  assert.ok(!warn.includes("color:var(--accent)"), "warning replaces the accent");
  assert.match(explicit, /color:var\(--accent\)/);
  assert.ok(warn.includes("Unsure match") && warn.includes("Maya Chen at Northwind"));
});
