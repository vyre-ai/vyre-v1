// terminal.request and the red-always-asks gate on a booted daemon (rc.8). The terminal host is an in-memory stand-in bound in this process; the chat, the engine, the Gate and the terminal module are live.
// 1 an agent asks the person to run a command: a card appears in the chat (command, why, risk), Run types it into a session, the person's Enter runs it, and the output goes back to the agent as the answer.
// 2 an agent's terminal_run of a destructive command is held at the Gate in Auto mode, a read-only one runs.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, connect, newAgent, seededDir, waitFor } from "./memory-live-kit.ts";
import { bindHost } from "../modules/terminal/impl.ts";
import type { TerminalHost } from "../modules/terminal/projections.ts";
import { answerOf, sessionFor, typeCommand, waitForRun } from "../apps/app/src/places/chats/terminal/request.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

/** A shell that holds what was typed; the test presses Enter by calling `enter`. */
function fakeHost() {
  const screens = new Map<string, string>();
  const state = new Map<string, "idle" | "running">();
  const typed: string[] = [];
  const host: TerminalHost = {
    async open(a) { screens.set(a.terminalId, ""); state.set(a.terminalId, "idle"); return { cwd: "/home/olivia", title: "This computer" }; },
    async input(id, data) { typed.push(data); screens.set(id, (screens.get(id) ?? "") + data); },
    async interrupt() {}, async resize() {},
    async read(id, o) { const all = screens.get(id) ?? ""; const since = o.since ?? 0; return { text: o.lines === 1 && o.since === undefined ? "" : all.slice(since), next: all.length }; },
    async run(_id, o) { return { exitCode: 0, output: `ran: ${o.command}`, truncated: false, durationMs: 5 }; },
    async status(ids) { return ids.map((id) => ({ terminalId: id, state: state.get(id) ?? "idle", exitCode: null })); },
    async close() {}, async health() { return { ok: true, sessions: screens.size }; },
  };
  return {
    host, typed,
    enter(id: string, output: string): void { state.set(id, "running"); setTimeout(() => { screens.set(id, (screens.get(id) ?? "") + `\r\n${output}\r\n$ `); state.set(id, "idle"); }, 40); },
  };
}

let keys = 0;
const ok = async (d: Daemon, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `tr-${cap}-${++keys}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};
const messages = async (d: Daemon, threadId: string): Promise<any[]> => (await call(d, "chat.messages.list", { threadId })).data.messages;   // eslint-disable-line @typescript-eslint/no-explicit-any

test("terminal live: an agent asks the person to run a command, the card carries it, Run types it and the output returns to the agent", async () => {
  const fake = fakeHost();
  bindHost(fake.host);
  const d = await boot(seededDir());
  try {
    await connect(d);
    const agent = await newAgent(d, "Keeper");
    const threadId = (await ok(d, "chat.start", { kind: "chat", agentIds: [agent.id] })).thread.threadId as string;
    await ok(d, "threads.set_mode", { threadId, mode: "auto" });
    const request = { threadId, command: "sudo apt install ffmpeg", why: "ffmpeg is needed to cut the clip", host: "device" };
    await ok(d, "chat.post", { threadId, body: `TOOL terminal_request ${JSON.stringify(request)}`, mentions: [{ kind: "agent", id: agent.id }] });

    // the card: a waiting question block that carries the command, the reason and its risk
    const block = await waitFor(async () => {
      await d.hooks?.pump?.();
      for (const m of await messages(d, threadId)) for (const b of m.blocks ?? []) if (b.type === "question" && b.data?.card?.kind === "terminal") return b;
      return null;
    });
    assert.equal(block.state, "waiting");
    assert.deepEqual(block.data.card, { kind: "terminal", command: "sudo apt install ffmpeg", host: "device", risk: "danger" });
    assert.equal(block.data.prompt, "ffmpeg is needed to cut the clip");
    assert.deepEqual(block.data.options.map((o: { key: string }) => o.key), ["run", "copy", "decline"]);

    // Run in my terminal: the card's own flow, over the real capabilities
    const deps = { call: async (cap: string, input: unknown) => { const r = await call(d, cap, { idempotencyKey: `run-${++keys}`, ...(input as object) }); if (r.status !== 200) throw new Error(`${cap}: ${JSON.stringify(r.data)}`); return r.data; }, newKey: () => `k${++keys}`, sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 30))) };
    const terminalId = await sessionFor(deps, { host: "device", deviceId: "dev_macbook1" });
    const { cursor } = await typeCommand(deps, terminalId, request.command);
    assert.deepEqual(fake.typed, ["sudo apt install ffmpeg"], "typed without Enter: nothing has run");
    const waiting = waitForRun(deps, terminalId, cursor, { everyMs: 30, timeoutMs: 5000 });
    setTimeout(() => fake.enter(terminalId, "ffmpeg installed"), 100);   // the person presses Enter
    const finished = await waiting;
    assert.equal(finished.state, "done");
    assert.match(finished.output, /ffmpeg installed/);
    await ok(d, "chat.answer_block", { threadId, blockId: block.id, answer: answerOf(finished, request.command) });

    // the agent's turn goes on with what the command printed
    const told = await waitFor(async () => {
      await d.hooks?.pump?.();
      return (await messages(d, threadId)).find((m) => m.author?.kind === "agent" && /ffmpeg installed/.test(m.body ?? ""))?.body ?? null;
    });
    assert.match(told, /Ran in my terminal/);
  } finally { await d.stop(); bindHost(null); }
});

test("terminal live: a local tool follows the person's own mode: Ask holds `ls`, Auto runs it, a red command and a delete outside work/ are still held, a path out of the folder is refused", async () => {
  const fake = fakeHost();
  bindHost(fake.host);
  const d = await boot(seededDir());
  try {
    await connect(d);
    const agent = await newAgent(d, "Keeper");
    const threadId = (await ok(d, "chat.start", { kind: "chat", agentIds: [agent.id] })).thread.threadId as string;
    await ok(d, "threads.set_mode", { threadId, mode: "auto" });
    const terminalId = (await ok(d, "terminal.open", { host: "agent_computer", agentId: agent.id })).terminal.terminalId as string;
    let n = 0;
    const run = (command: string, extra: Record<string, unknown> = {}): Promise<unknown> => ok(d, "chat.post", { threadId, body: `TOOL terminal_run ${JSON.stringify({ terminalId, command, idempotencyKey: `tr-run-${++n}`, ...extra })}`, mentions: [{ kind: "agent", id: agent.id }] });
    const holdFor = (count: number): Promise<Array<{ act: string; capName: string }>> => waitFor(async () => {
      await d.hooks?.pump?.();
      const holds = ((await call(d, "gate.holds.list", { states: ["held"] })).data.holds as Array<{ act: string; capName: string }> | undefined)?.filter((h) => h.capName === "terminal.run") ?? [];
      return holds.length >= count ? holds : null;
    });
    const said = (re: RegExp): Promise<string> => waitFor(async () => {
      await d.hooks?.pump?.();
      return (await messages(d, threadId)).find((m) => m.author?.kind === "agent" && re.test(m.body ?? ""))?.body ?? null;
    });

    // the default is Ask: even a read-only command waits for a yes, held for the person to answer in the chat
    await run("ls -la");
    const first = await holdFor(1);
    assert.equal(first[0]!.act, "approve");
    assert.ok(!fake.typed.some((t) => /ls -la/.test(t)));

    // Auto, chosen by the person: ls runs at once
    await ok(d, "settings.set", { key: "security.terminal_mode", value: { base: "auto", spaces: {} } });
    await run("ls /work");
    assert.match(await said(/ran: ls \/work/), /TOOL RESULT ok/);

    // Auto still holds a red command (the Gate) and a delete outside work/ (always asks)
    await run("rm -rf /tmp/build");
    await holdFor(2);
    await run("rm /tmp/old.log");
    await holdFor(3);

    // a working folder that leaves the work folder is refused, never held
    await run("ls", { cwd: "/etc" });
    const refused = await said(/not allowed on this computer/);
    assert.match(refused, /outside the work folder/);
    assert.equal((await holdFor(3)).length, 3, "a refused call is not a hold");
  } finally { await d.stop(); bindHost(null); }
});
