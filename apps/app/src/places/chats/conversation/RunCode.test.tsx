// The Run bar under a one-line shell block (rc.9): the machine chip, the risk dot, Run on a read-only command shows its output under the block, and a command that changes something is typed and says to press Enter.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { RunCode } from "./RunCode.tsx";
import type { RunCodeConfig } from "./RunCode.tsx";

function cfg(risk: "read" | "change" | "danger") {
  const calls: Array<{ cap: string; input: unknown }> = [];
  const opened: string[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input });
    switch (cap) {
      case "devices.mine": return { devices: [{ id: "dev_1", name: "Mac", class: "desktop", current: true, lastSeenAt: 1 }] };
      case "computers.list": return { computers: [] };
      case "terminal.risk": return { risk, verdict: "none", why: "" };
      case "terminal.list": return { terminals: [{ terminalId: "t1", host: "device", deviceId: "dev_1", state: "idle", lastActiveAt: 1 }] };
      case "terminal.run": return { exitCode: 0, output: "file-a\nfile-b" };
      case "terminal.read": return { next: 3, text: "" };
      case "terminal.status": return { rows: [{ state: "idle" }] };
      default: return {};
    }
  };
  const c: RunCodeConfig = { deps: { call, newKey: () => "k", sleep: async () => undefined }, team: false, nameOf: (id) => id, now: () => 10, copy: () => undefined, openTerminal: (id) => void opened.push(id) };
  return { c, calls, opened };
}

test("a read-only command: the bar shows the machine and the risk, Run brings the output back under the block", async () => {
  const restore = installDom();
  try {
    const r = cfg("read");
    const root = await mount(createRoot, <RunCode command="ls" cfg={r.c} />);
    await flush();
    assert.match(textOf(find(root, "run-code-host")), /This computer/);
    assert.ok(find(root, "risk-read"), "the dot says it only reads");
    await press(find(root, "run-code-run"));
    await flush();
    assert.match(textOf(find(root, "run-code-out")), /file-a/);
    assert.ok(r.calls.some((c) => c.cap === "terminal.run"));
  } finally { restore(); }
});

test("a command that changes something is typed into the terminal, which opens, and no run is made", async () => {
  const restore = installDom();
  try {
    const r = cfg("change");
    const root = await mount(createRoot, <RunCode command="npm install" cfg={r.c} />);
    await flush();
    assert.ok(find(root, "risk-change"));
    await press(find(root, "run-code-run"));
    await flush();
    assert.ok(!r.calls.some((c) => c.cap === "terminal.run"));
    assert.deepEqual(r.calls.find((c) => c.cap === "terminal.input")?.input, { terminalId: "t1", data: "npm install" });
    assert.deepEqual(r.opened, ["t1"]);
  } finally { restore(); }
});

test("with no machine to run on the bar is not drawn", async () => {
  const restore = installDom();
  try {
    const r = cfg("read");
    const c: RunCodeConfig = { ...r.c, deps: { ...r.c.deps, call: async (cap) => (cap === "devices.mine" ? { devices: [] } : { risk: "read" }) } };
    const root = await mount(createRoot, <RunCode command="ls" cfg={c} />);
    await flush();
    assert.equal(find(root, "run-code"), null);
  } finally { restore(); }
});

test("a code block gets the bar only when it is finished, and only where the caller draws one", async () => {
  const { MarkdownBlocks } = await import("../../../../../../ui/src/stream/index.ts");
  const { parseChunk } = await import("../../../../../../ui/src/stream/markdown.ts");
  const { commandOf } = await import("../terminal/runthis.ts");
  const restore = installDom();
  try {
    const blocks = parseChunk("Try this:\n\n```bash\nls -la\n```\n\n```python\nprint(1)\n```", 0);
    const render = (c: (b: { lang: string; text: string; closed: boolean }) => string | null) =>
      (b: { lang: string; text: string; closed: boolean }) => { const cmd = c(b); return cmd ? <RunCode command={cmd} cfg={cfg("read").c} /> : null; };
    const withBar = await mount(createRoot, <MarkdownBlocks blocks={blocks} renderCode={render((b) => commandOf(b.lang, b.text, b.closed))} />);
    await flush();
    assert.ok(find(withBar, "run-code"), "the shell block has its bar");
    const plain = await mount(createRoot, <MarkdownBlocks blocks={blocks} />);
    assert.equal(find(plain, "run-code"), null, "no renderCode, no bar");
    const open = parseChunk("```bash\nls -la", 0);
    const streaming = await mount(createRoot, <MarkdownBlocks blocks={open} streaming renderCode={render((b) => commandOf(b.lang, b.text, b.closed))} />);
    assert.equal(find(streaming, "run-code"), null, "a block still being written has none");
  } finally { restore(); }
});
