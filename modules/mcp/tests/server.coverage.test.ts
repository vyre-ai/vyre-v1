// Every capability a member can call is a tool, or has a stated reason (lane r42-mcp, 19 Nov 2026). A new capability that is neither fails here, so the gap is decided the day it appears.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MCP_TOOLS, NO_TOOL, noToolReason } from "../../../packages/contracts/src/mcp-coverage.ts";

const reg = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as {
  capabilities: Array<{ name: string; surfaces?: { mcp?: unknown; agent?: unknown }; caller?: string }>;
};
const open = reg.capabilities.filter((c) => c.surfaces?.agent !== false && c.caller === undefined);
const names = new Set(reg.capabilities.map((c) => c.name));

test("no capability is without both a tool and a reason", () => {
  const gaps = open.filter((c) => !c.surfaces?.mcp && noToolReason(c.name) === null).map((c) => c.name);
  assert.deepEqual(gaps, [], "give each a tool (MCP_TOOLS) or a reason (NO_TOOL) in packages/contracts/src/mcp-coverage.ts");
});

test("a tool is never also on the no-tool list, and every tool named exists", () => {
  for (const cap of Object.keys(MCP_TOOLS)) {
    assert.ok(names.has(cap), `${cap} is not a capability`);
    assert.equal(noToolReason(cap), null, `${cap} is a tool and has a reason not to be`);
    assert.ok(reg.capabilities.find((c) => c.name === cap)?.surfaces?.mcp, `${cap} is in MCP_TOOLS and generated no tool`);
  }
});

test("every reason still matches something, so a stale reason cannot hide a gap", () => {
  for (const [re] of NO_TOOL)
    assert.ok(
      reg.capabilities.some((c) => re.test(c.name) && !c.surfaces?.mcp),
      `reason ${String(re).slice(0, 60)} matches no capability without a tool`,
    );
});
