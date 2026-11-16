// @reads /generated/mcp-tools.json
// @reads /docs/frozen/agent-tools.md
// The connect card is OFF by default (lib/connect-switch.ts, rc.28). What an agent is offered: vault_request is in the default listed set as on rc.27, vault_connect and the card's other tools are not listed and not found
// with tool_search, the default count is the 65 the frozen tests pinned before the connect work, and no skill an agent loads names vault_connect. This file never turns the switch on; it sets it to 0.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { offerable } from "../src/tools/catalog.ts";
import { toolsFor, searchTools } from "../src/tools/access.ts";
import { ctx, loadGenerated } from "../src/tools/harness.ts";
import { connectCardOn, skillTextFor, CONNECT_CAPS } from "../../lib/connect-switch.ts";

// the switch is on by default from rc.29; this file tests it OFF, so it turns it off for itself (VYRE_CONNECT_CARD=0)
process.env["VYRE_CONNECT_CARD"] = "0";

const g = loadGenerated();
const offered = offerable(g.catalog, () => false);
const deps = { catalog: offered, defaults: g.defaults, levelFor: () => "manage" as const, canEngineer: () => false };
const set = toolsFor(deps as never, ctx());

test("the switch is off in this suite (set to 0 above)", () => assert.equal(connectCardOn(), false));

test("the default listed set is the rc.27 one: 65 tools, vault_request in, vault_connect out", () => {
  assert.equal(g.defaults.size, 65, `the default listed set has ${g.defaults.size} tools`);
  assert.ok(g.defaults.has("vault_request"));
  assert.equal(g.defaults.has("vault_connect"), false);
  const doc = readFileSync(new URL("../../docs/frozen/agent-tools.md", import.meta.url), "utf8");
  assert.match(doc, /## Default listed toolset \(65 tools\)/);
});

test("vault_request is listed on the first turn; no connect tool is listed or searchable", () => {
  const names = (a: { name: string }[]): string[] => a.map((t) => t.name);
  assert.ok(names(set.listed).includes("vault_request"));
  for (const t of [...set.listed, ...set.searchable]) assert.equal(CONNECT_CAPS.has(t.cap), false, t.name);
  assert.equal(names(set.listed).includes("vault_connect"), false);
  for (const q of [
    "vault connect",
    "connect service card",
    "fathom connect",
    "discard new key",
    "check key for service",
  ])
    for (const t of searchTools(set.searchable, q, 50))
      assert.equal(CONNECT_CAPS.has(t.cap), false, `${q} found ${t.name}`);
});

test("a call by name still resolves to the tool, so the server refuses it instead of the agent seeing an unknown tool", () => {
  assert.equal(offered.byName("vault_connect")?.cap, "vault.connect");
});

test("vault.item.discard_new is no tool at all", () => {
  assert.equal(
    g.catalog.all.some((t) => t.cap === "vault.item.discard_new"),
    false,
  );
});

test("no built-in skill and no tool description an agent reads tells it to call vault_connect", async () => {
  for (const name of ["working-in-vyre", "focus-vault"]) {
    const text = readFileSync(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf8");
    assert.equal(skillTextFor(name, text), text, name);
    assert.equal(/vault_connect/.test(text), false, name);
  }
  const req = g.catalog.byName("vault_request")!;
  assert.equal(/vault_connect/.test(req.summary), false, req.summary);
  const { REPLY_FORMAT } = await import("../../lib/reply-format.ts");
  assert.equal(/vault_connect/.test(REPLY_FORMAT), false);
});
