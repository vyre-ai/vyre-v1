// P-L9b_07c: the Chats right pane content as the prototype draws it. Files is a tree with counts and locks, Memory leads with the MAP.md block and shows proposed facts as cards,
// Routines has its second routine (a watcher) with green switches, Threads is the worked-in thread then its chats with their times. The rules behind each are tested in
// rightpane/chats-rightpane.test.tsx; this file asserts every listed element on the screen.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatRightPane } from "../rightpane/ChatRightPane.tsx";
import { MAP_LIMIT, parseMap } from "../rightpane/model.ts";
import type { TabKey } from "../rightpane/model.ts";
import { createSample } from "../rightpane/sample.ts";

const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const pane = (tab: TabKey): string => clean(renderToStaticMarkup(<ChatRightPane data={createSample().data} open onToggle={() => undefined} tab={tab} window={{ start: 0, end: 500 }} paneWidth={420} />));
const has = (s: string, needle: string): boolean => s.includes(needle);
const tagOf = (out: string, testid: string): string => {
  const i = out.indexOf(`data-testid="${testid}"`);
  assert.ok(i >= 0, testid);
  return out.slice(out.lastIndexOf("<", i), out.indexOf(">", i) + 1);
};

test("Files: a tree with the prototype's folders in its order, counts, and locks on logs and chats", () => {
  const out = pane("files");
  let at = -1;
  for (const n of [">AGENT.md<", ">agent.toml<", ">memory<", ">MAP.md<", ">notes<", ">proposed<", ">recipes<", ">journal<", ">skills<", ">routines<", ">knowledge<", ">inbox<", ">work<", ">downloads<", ">logs<", ">chats<"]) {
    const i = out.indexOf(n, at + 1);
    assert.ok(i > at, `${n} in order`);
    at = i;
  }
  for (const id of ["fld_memory", "fld_skills", "fld_routines", "fld_knowledge", "fld_work"]) assert.ok(has(out, `data-testid="count-${id}"`), `count on ${id}`);
  for (const id of ["fld_logs", "fld_chats"]) assert.ok(has(out, `data-testid="lock-${id}"`), `lock on ${id}`);
  assert.ok(!has(out, 'data-testid="lock-fld_work"'));
});

test("Memory: MAP.md reads as key rows with its count against 200; proposed facts are cards with where from and when", () => {
  const map = parseMap("- `elena-rivera` client referred by Maya\n- `consult-rules` length, host and fee");
  assert.deepEqual(map.rows.map((r) => r.key), ["elena-rivera", "consult-rules"]);
  assert.equal(MAP_LIMIT, 200);
  const out = pane("memory");
  for (const id of ["p1", "p2", "p3"]) assert.ok(has(out, `data-testid="proposed-${id}"`), id);
  assert.ok(has(out, "Rivera intake") && has(out, " · 9:31") && has(out, "#intake"));
  assert.ok(has(out, "Proposed · 3"));
});

test("Routines: the watcher is the second routine, switches are green when on, the paused one says so", () => {
  const out = pane("routines");
  assert.ok(out.indexOf("Morning lead sweep") < out.indexOf("Watch #intake for new clients") && out.indexOf("Watch #intake for new clients") < out.indexOf("Chase missing intake forms"));
  assert.ok(has(out, "weekdays 8:00 · next Mon Oct 27") && has(out, "on new messages") && has(out, "Paused · Every day at 17:00"));
  assert.ok(has(tagOf(out, "routine-switch-r3"), "background-color:var(--ok)") && has(tagOf(out, "routine-switch-r4"), "background-color:var(--ok)"));
  assert.ok(!has(tagOf(out, "routine-switch-r5"), "background-color:var(--ok)"));
});

test("Threads: the thread it worked in, then its chats with their times", () => {
  const out = pane("threads");
  assert.ok(out.indexOf("#intake · Omar Haddad") < out.indexOf("Rivera intake") && out.indexOf("Rivera intake") < out.indexOf("Weekly lead report"));
  assert.ok(has(out, ">9:31<") && has(out, ">Mon<"));
});
