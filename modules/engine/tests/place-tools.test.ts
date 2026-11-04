// A chat's place lists that place's core tools; every name is a real tool, each list is short, and a place with no entry adds nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLACE_SCOPES, placeTools } from "../place-tools.ts";

const names = new Set((JSON.parse(readFileSync(new URL("../../../generated/mcp-tools.json", import.meta.url), "utf8")) as { tools: { name: string }[] }).tools.map((t) => t.name));

test("every tool a place lists is a real tool, and each list stays short", () => {
  for (const s of PLACE_SCOPES) {
    const list = placeTools({ kind: "ask", scope: { type: s, id: "x" } });
    assert.ok(list.length > 0 && list.length <= 8, `${s}: ${list.length}`);
    assert.deepEqual(list.filter((n) => !names.has(n)), [], s);
  }
  assert.deepEqual(placeTools({ kind: "helper" }).filter((n) => !names.has(n)), []);
});

test("the goal, task, inbox and vault places list their own tools; an unknown place and a plain chat add nothing", () => {
  assert.ok(placeTools({ kind: "thread", scope: { type: "goal", id: "gol_1" } }).includes("goals_checkin_post"));
  assert.ok(placeTools({ kind: "thread", scope: { type: "task", id: "tsk_1" } }).includes("tasks_get"));
  assert.ok(placeTools({ kind: "ask", scope: { type: "place", id: "mail" } }).includes("inbox_mark_read"));
  assert.ok(placeTools({ kind: "ask", scope: { type: "place", id: "vault" } }).includes("vault_items_list"));
  assert.deepEqual(placeTools({ kind: "chat" }), []);
  assert.deepEqual(placeTools({ kind: "ask", scope: { type: "weird", id: "x" } }), []);
});
