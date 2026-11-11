// A Terminal tab's live view (12 Nov round, audit item 14): terminal.read with `since` counts lines from the session's first one, so it keeps going past the scrollback it reads and past tmux dropping
// old history; the line being typed on is sent again until it is finished, so a prompt or a line that changes between two reads is never lost; and a tab left open neither wakes a sleeping workspace
// nor keeps it awake. tmux is the stand-in (fixtures/fake-tmux.ts), which keeps a history with a limit and a cursor line the way tmux does. The tab's own drawing of the answers (the app's poll source on
// ui/Terminal's buffer) is tested beside it in apps/app/src/places/chats/terminal/poll.test.ts; here the answers are drawn the same way by a few lines of code.
import test from "node:test";
import assert from "node:assert/strict";
import { createDockerApi } from "../../../sandbox/src/docker.ts";
import { createShellHost, createTmuxHost } from "../impl.ts";
import { createWorkspaceManager, createWorkspaceTerminalHost, workspaceName } from "../workspace.ts";
import { fakeTmux } from "../fixtures/fake-tmux.ts";
import { fakeDocker } from "../fixtures/fake-docker.ts";

const target = { host: "space_server" as const };

/** Read the way a tab does: each answer replaces the line the screen ends on (the unfinished one) and adds the rest. */
function tab(read: (since: number) => Promise<{ text: string; next: number }>, start: number, replay: string) {
  const rows = replay.split("\n");
  let cursor = start;
  return {
    text: (): string => rows.join("\n"),
    async poll(n = 1): Promise<void> {
      for (let i = 0; i < n; i++) { const r = await read(cursor); cursor = r.next; if (r.text === "") continue; rows.pop(); rows.push(...r.text.split("\n")); }
    },
  };
}

test("the live read keeps going past 5,000 lines and across tmux dropping old history: every line arrives once, in order", async () => {
  const tm = fakeTmux({ historyLimit: 1000 });
  const host = createTmuxHost({ exec: tm.exec });
  await host.open({ terminalId: "t1", target, name: "x", cols: 80, rows: 24, folders: [] });
  const at = await host.read("t1", { lines: 1 });
  const seen: string[] = [];
  let cursor = at.next;
  let n = 0;
  for (let round = 0; round < 40; round++) {
    // 170 lines between two reads: more than a tenth of the history limit, so tmux drops history while the tab looks away
    for (let i = 0; i < 170; i++) tm.write("vyre-t1", `line ${++n}`);
    const r = await host.read("t1", { lines: 200, since: cursor });
    const got = r.text.split("\n");
    // the first line of an answer is the line the last answer ended on (the cursor's), sent again; keep the finished ones
    seen.push(...got.slice(0, -1).filter((l, i) => !(i === 0 && seen.length > 0 && l === "") && l !== ""));
    cursor = r.next;
  }
  assert.equal(n, 6800);
  const want = Array.from({ length: n }, (_, i) => `line ${i + 1}`);
  assert.deepEqual(seen, want, "nothing lost or repeated past 5,000 lines and through the drops");
});

test("a line that changes between two reads (a prompt, then what is typed on it) is drawn as it is now, and a finished line is not drawn twice", async () => {
  const tm = fakeTmux();
  const host = createTmuxHost({ exec: tm.exec });
  await host.open({ terminalId: "t2", target, name: "x", cols: 80, rows: 24, folders: [] });
  tm.write("vyre-t2", "welcome");
  const at = await host.read("t2", { lines: 50 });
  const t = tab((since) => host.read("t2", { lines: 200, since }), at.next, `${at.text}\n`);
  await host.input("t2", "ls -");
  await t.poll();
  assert.equal(t.text(), "welcome\nls -");
  await host.input("t2", "la");
  await t.poll(3);
  assert.equal(t.text(), "welcome\nls -la", "the typed line as it is now, once");
  // the line is finished and output follows
  tm.sessions.get("vyre-t2")!.typed = "";
  tm.write("vyre-t2", "ls -la");
  tm.write("vyre-t2", "a.txt");
  await t.poll(2);
  assert.equal(t.text(), "welcome\nls -la\na.txt\n", "each line once, the cursor on the new empty line");
});

test("a plain session on a computer without tmux reads the same way: past its 5,000 kept lines, with the unfinished line sent again", async () => {
  let print: ((t: string) => void) | null = null;
  let finish: (() => void) | null = null;
  const host = createShellHost({ home: "/h", run: async (a) => { print = a.onData; await new Promise<void>((r) => { finish = r; }); return { exitCode: 0 }; } });
  await host.open({ terminalId: "p1", target, name: "x", cols: 80, rows: 24, folders: [] });
  const running = host.run("p1", { command: "seq", env: {}, timeoutMs: 60_000 });
  await new Promise((r) => setTimeout(r, 5));
  let cursor = (await host.read("p1", { lines: 1 })).next;
  const seen: string[] = [];
  let n = 0;
  for (let round = 0; round < 12; round++) {
    let chunk = "";
    for (let i = 0; i < 600; i++) chunk += `n${++n}\n`;
    print!(chunk);
    const r = await host.read("p1", { lines: 1, since: cursor });
    seen.push(...r.text.split("\n").filter((l) => /^n\d+$/.test(l)));
    cursor = r.next;
  }
  finish!();
  await running;
  assert.deepEqual(seen, Array.from({ length: n }, (_, i) => `n${i + 1}`));
});

test("a tab left open neither wakes a sleeping workspace nor keeps it awake: its reads are not use", async () => {
  const dk = fakeDocker({ tmux: { scripts: { "echo hi": { out: "hi", code: 0 } } } });
  const clock = { t: 1_000_000 };
  const m = createWorkspaceManager({ api: createDockerApi(dk.http), http: dk.http, idleMs: 600_000, now: () => clock.t });
  const h = createWorkspaceTerminalHost({ manager: m, sleep: async () => undefined });
  await h.open({ terminalId: "w1", target: { host: "agent_computer", agentId: "agt_dex" }, name: "agent", cols: 80, rows: 24, folders: [] });
  await h.run("w1", { command: "echo hi", env: {}, timeoutMs: 5000 });
  const at = await h.read("w1", { lines: 50 });
  assert.match(at.text, /^hi$/m);
  let cursor = at.next;
  // the person watches for eleven minutes, a read every 400 ms
  for (let i = 0; i < (11 * 60_000) / 400; i += 25) { clock.t += 400 * 25; cursor = (await h.read("w1", { lines: 200, since: cursor })).next; }
  assert.deepEqual(await m.sweep(), ["agt_dex"], "watching is not working: it sleeps after its idle time");
  const name = workspaceName("agt_dex");
  const execs = dk.ops("exec").length;
  const r = await h.read("w1", { lines: 200, since: cursor });
  assert.deepEqual(r, { text: "", next: cursor }, "asleep: nothing new to show");
  assert.equal(dk.box(name).running, false, "and the read did not wake it");
  assert.equal(dk.ops("exec").length, execs, "nothing ran in it");
  // typing wakes it, as any use does
  await h.input("w1", "ls\n");
  assert.equal(dk.box(name).running, true);
  m.close();
});
