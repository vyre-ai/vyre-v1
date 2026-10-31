// The Terminal tab of the chat pane (rc.8): which session it starts on.
import test from "node:test";
import assert from "node:assert/strict";
import { startSession } from "./TerminalPaneTab.tsx";

const row = (o: Record<string, unknown>) => ({ terminalId: "trm_1", host: "device", state: "idle", lastActiveAt: 1, ...o }) as never;

test("the pane starts on the newest live session of the chat's agent computer, else this computer; an exited one is never picked", () => {
  const rows = [row({ terminalId: "a", host: "device", lastActiveAt: 5 }), row({ terminalId: "b", host: "agent_computer", computerId: "cmp_1", lastActiveAt: 3 }), row({ terminalId: "c", host: "agent_computer", computerId: "cmp_1", lastActiveAt: 4 }), row({ terminalId: "d", host: "agent_computer", computerId: "cmp_1", lastActiveAt: 9, state: "exited" })];
  assert.equal(startSession(rows, "cmp_1")?.terminalId, "c");
  assert.equal(startSession(rows, undefined)?.terminalId, "a");
  assert.equal(startSession(rows, "cmp_2")?.terminalId, "a", "no session there: this computer");
  assert.equal(startSession([row({ state: "exited" })], undefined), undefined);
});
