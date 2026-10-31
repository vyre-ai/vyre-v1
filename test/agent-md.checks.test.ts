// The AGENT.md every agent starts with passes the checks Files runs on it and the header shows over it: under 150 lines, Inherits VYRE.md, no overrides, nothing repeated, no secrets.
// It lives here, not beside the agents module, because it reaches across two modules and the app (modules are leaf nodes, boundary B1).
import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_MD_DEFAULT, ASSISTANT_AGENT_MD, GUIDE_MD } from "../modules/agents/projections.ts";
import { lintText } from "../modules/files/handlers/lint.ts";
import { lintItems } from "../apps/app/src/places/files/review/model.ts";

const cases: Array<[string, string]> = [
  ["the private assistant", ASSISTANT_AGENT_MD("Irfad’s Assistant")],
  ["the assistant through the default", AGENT_MD_DEFAULT("James’ Assistant", "assistant")],
  ["an agent with a role sentence", AGENT_MD_DEFAULT("Intake", "Use me when a new client form arrives.")],
  ["an agent with a bare role", AGENT_MD_DEFAULT("Scout", "Researcher")],
  ["an agent with no role", AGENT_MD_DEFAULT("Scout", undefined)],
];

for (const [label, text] of cases) {
  test(`${label}: every AGENT.md check passes with nothing to say`, () => {
    // the Space's VYRE.md is written by its admins; the guide every agent reads first stands in for it, so nothing here repeats what every agent is already told
    const out = lintText("agent_md", text, undefined, { vyreText: GUIDE_MD });
    assert.equal(out.state, "ok");
    assert.ok(out.lines <= 120, `${out.lines} lines, well under 150`);
    assert.equal(out.inherits, true);
    assert.deepEqual(out.overrides, []);
    assert.deepEqual(out.secrets, []);
    assert.deepEqual(out.problems, []);
    const items = lintItems(out, text);
    assert.deepEqual(items.map((i) => [i.label, i.sev]), [[`${out.lines} / 150 lines`, "ok"], ["Inherits VYRE.md", "ok"], ["No overrides", "ok"], ["Nothing repeated from agent.toml", "ok"], ["No secrets", "ok"]]);
  });
}
