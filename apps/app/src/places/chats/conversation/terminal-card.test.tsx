// The Run this card (rc.8): command, why and risk; Run types it and waits for Enter and hands the output back; Copy and Decline answer; a normal question stays a normal question.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { TerminalCard } from "./TerminalCard.tsx";
import { terminalAskOf } from "./model.ts";

installDom();

test("a question carries a terminal card only when it says so", () => {
  assert.deepEqual(terminalAskOf({ card: { kind: "terminal", command: "sudo apt install ffmpeg", host: "device", risk: "danger" } }), { command: "sudo apt install ffmpeg", risk: "danger", host: "device" });
  assert.equal(terminalAskOf({ card: { kind: "terminal", command: "" } }), null);
  assert.equal(terminalAskOf({ prompt: "Which?" }), null);
  assert.equal(terminalAskOf({ card: { kind: "terminal", command: "ls", risk: "nonsense" } })?.risk, "change");
});

function deps(calls: string[], states: string[] = ["idle", "running", "idle"]) {
  let i = 0;
  return {
    call: async (cap: string): Promise<unknown> => {
      calls.push(cap);
      if (cap === "terminal.list") return { terminals: [{ terminalId: "trm_1", host: "device", state: "idle", lastActiveAt: 1 }] };
      if (cap === "terminal.read") return { text: "ffmpeg installed", next: 7 };
      if (cap === "terminal.status") return { rows: [{ state: states[Math.min(i++, states.length - 1)] }] };
      return {};
    },
    newKey: () => "k",
    sleep: async () => undefined,
  };
}

test("Run in my terminal types the command, waits for Enter, answers with the output and collapses", async () => {
  const calls: string[] = [];
  const answers: unknown[] = [];
  const shown: string[] = [];
  const root = await mount(createRoot, <TerminalCard id="blk_1" why="ffmpeg is needed to cut the clip" command="sudo apt install ffmpeg" risk="danger" host="device" deps={deps(calls)} copy={() => undefined} openTerminal={(t) => shown.push(t)} answer={(_i, a) => answers.push(a)} />);
  assert.match(textOf(find(root, "terminal-card-command-blk_1")), /sudo apt install ffmpeg/);
  assert.ok(find(root, "risk-danger"), "the dot is red");
  await press(find(root, "terminal-card-run-blk_1"));
  await flush();
  await flush();
  assert.ok(calls.includes("terminal.input"), "typed");
  assert.deepEqual(shown, ["trm_1"], "the terminal is shown beside the chat");
  assert.deepEqual(answers, [{ other: "Ran in my terminal.\n$ sudo apt install ffmpeg\nffmpeg installed" }]);
  assert.match(textOf(find(root, "terminal-card-done-blk_1")), /Ran in your terminal/);
});

test("Copy and Decline answer at once", async () => {
  const answers: unknown[] = [];
  const copied: string[] = [];
  const a = await mount(createRoot, <TerminalCard id="b" why="w" command="ls" risk="read" deps={deps([])} copy={(t) => copied.push(t)} openTerminal={() => undefined} answer={(_i, x) => answers.push(x)} />);
  assert.ok(find(a, "risk-read"));
  await press(find(a, "terminal-card-copy-b"));
  const b = await mount(createRoot, <TerminalCard id="c" why="w" command="ls" risk="read" deps={deps([])} copy={() => undefined} openTerminal={() => undefined} answer={(_i, x) => answers.push(x)} />);
  await press(find(b, "terminal-card-decline-c"));
  assert.deepEqual(answers, ["copy", "decline"]);
  assert.deepEqual(copied, ["ls"]);
});
