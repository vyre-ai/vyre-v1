// Taking the keyboard is off in rc.28 (re-sent keys are not idempotent yet): the sheet is a watching view. No Take over, no bar of who is typing; the screen, the name and Close stay, and so do the ended state.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { TerminalSheet } from "./TerminalSheet.tsx";
import { terminalBar } from "./work-model.ts";

const data = {
  call: async () => ({}),
  connection: { get: () => "online", subscribe: () => () => undefined },
  nav: { openTerminal() {}, closeTab() {} },
} as never;
const sessions = [{ name: "agent", terminalId: "trm_1", state: "idle", owner: { kind: "agent" } }] as never;

test("with take-over off the sheet has no Take over control and no 'Nobody is typing' bar", async () => {
  const off = installDom();
  try {
    const root = await mount(
      createRoot,
      <TerminalSheet
        data={data}
        agentName="Desk"
        asleep={false}
        watchOnly
        sessions={sessions}
        start="trm_1"
        onClose={() => undefined}
      />,
    );
    await flush();
    const t = textOf(root);
    assert.ok(find(root, "terminal-popup"), "the sheet is there");
    assert.equal(find(root, "terminal-take"), null);
    assert.equal(find(root, "terminal-give"), null);
    assert.equal(find(root, "terminal-popup-bar"), null);
    assert.ok(!/Take over|Nobody is typing|is typing|keyboard/.test(t), t);
    assert.ok(find(root, "terminal-popup-close"), "Close stays");
  } finally {
    off();
  }
});

test("with take-over off the ended and the reconnecting states keep their bar", () => {
  const base = {
    agentName: "Desk",
    known: true,
    asleep: false,
    ready: true,
    mine: false,
    asking: false,
    hidden: false,
    watchOnly: true,
  };
  assert.deepEqual(terminalBar({ ...base, online: true, state: "exited" }).action, "newtab");
  assert.equal(terminalBar({ ...base, online: false, state: "idle" }).title, "Reconnecting");
  assert.deepEqual(terminalBar({ ...base, online: true, state: "idle" }), { title: "", action: null, tone: "quiet" });
});
