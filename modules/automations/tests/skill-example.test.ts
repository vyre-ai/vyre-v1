// The example in the connector-builder skill is a definition the save call accepts: it passes the same rules a saved connector passes.
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeConnector } from "../connector-def.ts";

const skill = readFileSync(new URL("../../../agent/skills/connector-builder/SKILL.md", import.meta.url), "utf8");

test("the skill's example definition passes the rules of a saved connector", () => {
  const block = /```json\n([\s\S]*?)\n```/.exec(skill)![1]!;
  const input = JSON.parse(block) as { definition: unknown };
  const r = normalizeConnector(input.definition);
  assert.equal(r.ok, true, JSON.stringify(r));
  if (r.ok) {
    assert.equal(r.def.triggers.length, 2);
    assert.equal(r.def.actions.find((a) => a.key === "create_order")!.effect, "outward");
  }
});
