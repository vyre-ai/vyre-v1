// P-L9_32: the new-tab page. Start, Chat with, Recent, Record types and Folders draw while the field is empty; every control leads somewhere; typing is the Cmd-K search.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { NewTabPage } from "./NewTabPage.tsx";
import { START, faceLabel } from "./model.ts";
import { createSampleNewTab } from "./sample.ts";

const html = (): string => renderToStaticMarkup(<NewTabPage data={createSampleNewTab().data} />).replaceAll("<!-- -->", "");
const at = (s: string, needle: string): number => { const i = s.indexOf(needle); assert.ok(i >= 0, `expected ${needle}`); return i; };

test("the sections draw in the prototype's order under the field", () => {
  const out = html();
  const order = ["Open anything, or start something", "Start", "Chat with", "Recent", "Record types", "Folders"].map((t) => at(out, t));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  for (const s of START) assert.ok(out.includes(s.label), s.label);
});

test("faces are first names for people and the agent's name for agents", () => {
  const out = html();
  assert.ok(out.includes(">Maya<") && out.includes(">Intake<"));
  assert.equal(faceLabel({ kind: "person", id: "p", title: "Maya Chen", link: "x", score: 1 }), "Maya");
});

test("Recent carries a kind label at the right; record types are chips", () => {
  const out = html();
  assert.ok(out.includes("Chats") && out.includes("Files"));
  for (const t of ["Agents", "Projects", "Invoices"]) assert.ok(out.includes(t), t);
});

test("Start tiles and record types lead to their place", () => {
  const { data, went } = createSampleNewTab();
  data.start("task");
  data.start("folder");
  data.openType("Hires");
  assert.deepEqual(went, ["home#new=task", "files#new=folder", "records#type=Hires"]);
});

test("every control is a labelled button", () => {
  const out = html();
  for (const l of ["New chat", "Chat with Intake", "Message Maya Chen", "Open Projects"]) assert.ok(out.includes(`aria-label="${l}"`), l);
});
