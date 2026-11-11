// Retiring the old per-agent desktop (6 Nov decision: a terminal in the agent's workspace, a browser in the Space browser). No agent makes a new desktop, and an agent that has none is told what
// it has instead, in plain words, never "Give it one first".
import test from "node:test";
import assert from "node:assert/strict";
import { provision } from "../handlers/lifecycle.ts";
import { bindSpaceBrowser } from "../sbrowser/port.ts";
import type { SpaceBrowser } from "../sbrowser/port.ts";
import { bindPersonalChrome } from "../projections.ts";
import { codeOf, DANA, harness } from "../fixtures/harness.ts";
import { tool } from "./tools.fixture.ts";

const say = (e: unknown): string => JSON.stringify(e);
const agentCtx = (id: string) => harness({ principal: { kind: "agent", id }, actingFor: DANA }).ctx;
const noBrowser = (): SpaceBrowser => ({ async available() { return false; } } as unknown as SpaceBrowser);
const off = (): void => { bindSpaceBrowser(null); bindPersonalChrome(null); };

test("an agent cannot make itself an old desktop: the refusal names what it has, and nothing is made", async () => {
  const h = harness({ principal: { kind: "agent", id: "agt_dex" }, actingFor: DANA });
  await assert.rejects(() => provision(h.ctx, { agentId: "agt_dex", idempotencyKey: "k1" }), (e) => {
    assert.equal(codeOf(e), "validation.precondition_failed");
    assert.match(say(e), /terminal/i);
    assert.match(say(e), /browser/i);
    assert.doesNotMatch(say(e), /Give it one|ask for a computer/i);
    return true;
  });
  assert.equal(h.rows("SELECT COUNT(*) AS n FROM computers_computers")[0]?.["n"], 0, "no row");
  assert.equal(h.fake.named("create").length, 0, "no container");
});

test("chrome tools in a Space with no browser say so plainly, and name what would give it one; they never tell the agent to ask for a computer", async () => {
  bindSpaceBrowser(noBrowser());
  try {
    await assert.rejects(() => tool["computers.chrome.state"]!(agentCtx("agt_dex"), {}), (e) => {
      assert.equal(codeOf(e), "validation.not_found", "the code stays");
      const s = say(e);
      assert.match(s, /no browser for agents/i);
      assert.match(s, /Docker/);
      assert.match(s, /Console > Computers/);
      assert.match(s, /own Chrome only if they ask/i, "the person's own Chrome is used only on request");
      assert.doesNotMatch(s, /Give it one|has no computer/i);
      return true;
    });
  } finally { off(); }
});

test("screen tools tell an agent with no desktop which tools work: the browser and the terminal", async () => {
  bindSpaceBrowser(noBrowser());
  try {
    for (const cap of ["computers.screen.screenshot", "computers.screen.click"]) {
      await assert.rejects(() => tool[cap]!(agentCtx("agt_dex"), { x: 1, y: 1 }), (e) => {
        assert.equal(codeOf(e), "validation.not_found");
        const s = say(e);
        assert.match(s, /no desktop screen/i);
        assert.match(s, /chrome_open/);
        assert.match(s, /terminal_run/);
        assert.doesNotMatch(s, /Give it one/i);
        return true;
      });
    }
  } finally { off(); }
});

test("file tools of the old desktop point an agent with none at Files and its terminal", async () => {
  try {
    await assert.rejects(() => tool["computers.files.list"]!(agentCtx("agt_dex"), {}), (e) => {
      assert.equal(codeOf(e), "validation.not_found");
      const s = say(e);
      assert.match(s, /files_list|Files tools/i);
      assert.match(s, /terminal_run/);
      assert.doesNotMatch(s, /Give it one/i);
      return true;
    });
  } finally { off(); }
});
