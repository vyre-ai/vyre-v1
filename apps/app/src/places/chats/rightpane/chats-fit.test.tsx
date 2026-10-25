// P-L9b_09b: the agent page's tab strip folds like the right pane's, through the same fit (rightpane/fit.ts). At the phone width (390 px) Settings never clips: what does not fit
// goes behind More, the open tab stays drawn, and the page still lists every tab on a wide screen.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { TABS as PAGE_TABS } from "../agentpage/model.ts";
import { AgentPage } from "../agentpage/AgentPage.tsx";
import { createSample } from "../agentpage/sample.ts";
import { delegateRoutine, runNow } from "./actions.ts";
import { createSample as createPaneSample } from "./sample.ts";
import type { Routine } from "./model.ts";
import { HEADER_CHROME, MORE_KEY, fitTabs, tabWidth } from "./model.ts";

test("at 390 px the page column (358 px) folds the last tabs behind More and never clips", () => {
  const col = 390 - 32;
  const { shown, hidden } = fitTabs(PAGE_TABS, "chats", col);
  assert.ok(hidden.length > 0, "five tabs do not fit the room a phone leaves");
  const used = shown.reduce((n, t) => n + tabWidth(t.title), 0) + tabWidth("More") + 2;
  assert.ok(used <= col - HEADER_CHROME, `${used} fits ${col - HEADER_CHROME}`);
  assert.ok(hidden.some((t) => t.key === "settings"), "Settings waits behind More");
  assert.equal(MORE_KEY, "more");
});

test("the open tab is always drawn, even when it is one of the last", () => {
  const { shown, hidden } = fitTabs(PAGE_TABS, "settings", 390 - 32);
  assert.ok(shown.some((t) => t.key === "settings"));
  assert.deepEqual([...shown, ...hidden].map((t) => t.key).sort(), PAGE_TABS.map((t) => t.key).sort());
});

test("on a wide screen the agent page draws all five tabs and no More", () => {
  const s = createSample("owner");
  const out = renderToStaticMarkup(<AgentPage data={s.data} window={{ start: 0, end: 500 }} />).replaceAll("<!-- -->", "");
  for (const t of ["Chats", "Memory", "Files", "Computer", "Settings"]) assert.ok(out.includes(`>${t}<`), t);
  assert.ok(!out.includes(">More<"));
});

test("Run now and Delegate call the P-CC_20 capabilities with their real inputs", async () => {
  const s = createPaneSample();
  const notes: { text: string; undo?: () => Promise<void> | void }[] = [];
  const d = { call: s.data.call, note: (text: string, undo?: () => Promise<void> | void) => notes.push(undo ? { text, undo } : { text }) };
  const rows = (): Routine[] => s.replica.rows("routines") as unknown as Routine[];
  const r = rows().find((x) => x.routineId === "r3")!;
  assert.equal(await runNow(d, r), true);
  const run = s.calls.find((c) => c.cap === "agents.routine.run_now")!;
  assert.deepEqual({ ...(run.input as object), idempotencyKey: "k" }, { agentId: r.agentId, routineId: "r3", idempotencyKey: "k" });
  assert.ok(typeof (run.input as { idempotencyKey: string }).idempotencyKey === "string");
  assert.equal(await delegateRoutine(d, r, "usr_maya", "Maya Chen"), true);
  const del = s.calls.find((c) => c.cap === "agents.routine.delegate")!;
  assert.deepEqual(del.input, { agentId: r.agentId, routineId: "r3", to: { kind: "person", id: "usr_maya" } });
  assert.equal(rows().find((x) => x.routineId === "r3")!.ownerId, "usr_maya");
  await notes.at(-1)!.undo!();
  assert.deepEqual(s.calls.at(-1)!.input, { agentId: r.agentId, routineId: "r3", undo: true });
  assert.equal(rows().find((x) => x.routineId === "r3")!.ownerId, r.ownerId, "undo gives it back");
});
