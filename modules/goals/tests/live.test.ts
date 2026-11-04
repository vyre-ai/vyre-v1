// Goals goes live: the handler table equals the manifest, capability for capability, so the loader finds a handler for every one and none is left over.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registry } from "../../../generated/registry.ts";
import { handlers } from "../impl.ts";

const mine = registry.capabilities.filter((c) => c.module === "goals").map((c) => c.name).sort();
const toolName = (c: { name: string; surfaces?: { mcp?: { name?: string } } }): string => c.surfaces?.mcp?.name ?? c.name.replaceAll(".", "_");
const tools = new Set((registry.capabilities as unknown as Array<{ name: string; surfaces?: { mcp?: { name?: string } } }>).filter((c) => c.surfaces?.mcp).map(toolName));

test("goals live: the handler map equals the manifest's 27 capabilities", () => {
  assert.equal(mine.length, 27);
  assert.deepEqual(Object.keys(handlers).sort(), mine);
});

test("goals: agents see the goal tools by the names the skill teaches", () => {
  for (const n of ["goals_get", "goals_progress_read", "goals_plan_update", "goals_checkin_post", "goals_ask", "goals_mark_stuck", "goals_complete", "goals_search_past", "goals_sources", "goals_step", "goals_folder", "goals_create"]) assert.ok(tools.has(n), n);
  const skill = readFileSync(new URL("../../../agent/skills/working-on-goals/SKILL.md", import.meta.url), "utf8");
  const named = [...skill.matchAll(/`([a-z]+_[a-z_]+)`/g)].map((m) => m[1]!).filter((n) => n !== "tool_search");
  assert.deepEqual([...new Set(named.filter((n) => !tools.has(n)))], [], "every tool the skill names exists");
});
