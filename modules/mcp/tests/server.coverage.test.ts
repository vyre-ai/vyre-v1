// Every capability a member can call is a tool, or has a stated reason (lane r42-mcp, 19 Nov 2026). A new capability that is neither fails here, so the gap is decided the day it appears.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MCP_HELD, MCP_TOOLS, NO_TOOL, noToolReason } from "../../../packages/contracts/src/mcp-coverage.ts";

const reg = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as {
  capabilities: Array<{ name: string; risk?: string; effects?: string; gate?: { act: string; when?: string }; surfaces?: { mcp?: unknown; agent?: unknown }; caller?: string }>;
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

test("a tool that deletes, erases or changes access, a connection or a key is held for a person when an agent calls it", () => {
  for (const [cap, act] of Object.entries(MCP_HELD)) {
    const c = reg.capabilities.find((x) => x.name === cap);
    assert.ok(c, `${cap} is in MCP_HELD and is not a capability`);
    assert.ok(MCP_TOOLS[cap], `${cap} is held and is not a tool`);
    assert.equal(c.gate?.act, act, `${cap} should be held as ${act}`);
    assert.match(c.gate?.when ?? "", /actor\.kind == 'agent'/, `${cap} holds an agent, never a person or the host's own press`);
  }
  // every tool that writes at high risk has a gate that is not "none"
  for (const cap of Object.keys(MCP_TOOLS)) {
    const c = reg.capabilities.find((x) => x.name === cap)!;
    if (c.effects !== "read" && c.risk === "high")
      assert.ok(c.gate && c.gate.act !== "none", `${cap} is a high-risk change with no hold for an agent`);
  }
});
