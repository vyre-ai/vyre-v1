// A run through one script in the machine (impl.ts RUN_SCRIPT, TmuxOptions.oneExec; lane r42-computer, 19 Nov): the same answers as the polling loop, in one exec instead of a round trip per look; the whole history is read
// once at the end for the kept output; a stop and a deadline still end it; and anything unexpected falls back to the loop without typing the line twice or never.
import test from "node:test";
import assert from "node:assert/strict";
import { createTmuxHost, parseRunScript, RUN_SCRIPT, STOPPED_LINE } from "../impl.ts";
import type { Exec } from "../impl.ts";
import { fakeTmux } from "../fixtures/fake-tmux.ts";
import type { FakeTmuxOptions } from "../fixtures/fake-tmux.ts";

function rig(o: FakeTmuxOptions = {}, extra: { maxOutput?: number; scrollback?: number; oneExec?: boolean; wrap?: (exec: Exec) => Exec } = {}) {
  const tm = fakeTmux(o);
  const clock = { t: 0 };
  const host = createTmuxHost({
    exec: extra.wrap ? extra.wrap(tm.exec) : tm.exec,
    control: tm.control,
    now: () => clock.t,
    sleep: async (ms) => {
      clock.t += ms;
    },
    pollMs: 50,
    oneExec: extra.oneExec ?? true,
    ...(extra.maxOutput === undefined ? {} : { maxOutput: extra.maxOutput }),
    ...(extra.scrollback === undefined ? {} : { scrollback: extra.scrollback }),
  });
  return { tm, host, clock };
}
const open = (host: ReturnType<typeof createTmuxHost>, id = "trm_a1") =>
  host.open({ terminalId: id, target: { host: "agent_computer", agentId: "agt_intake" }, name: "build", cols: 100, rows: 30, folders: [] });
const run = (host: ReturnType<typeof createTmuxHost>, command: string, timeoutMs = 5000, signal?: AbortSignal) =>
  host.run("trm_a1", { command, env: {}, timeoutMs, ...(signal ? { signal } : {}) });

const SCRIPTS: FakeTmuxOptions["scripts"] = {
  "git status": { out: "On branch main\nnothing to commit", code: 0 },
  false: { out: "", code: 1 },
  make: { out: "cc a.c\ncc b.c\nerror: b.c:3", code: 2 },
  tput: { out: "drawn over the marker", code: 3 },
};

test("a run through the script answers exactly what the polling loop answers, for every outcome", async () => {
  for (const command of ["git status", "false", "make", "tput"]) {
    const a = rig({ scripts: SCRIPTS, overwriteEnd: ["drawn over the marker"] }, { oneExec: false });
    const b = rig({ scripts: SCRIPTS, overwriteEnd: ["drawn over the marker"] }, { oneExec: true });
    await open(a.host);
    await open(b.host);
    const x = await run(a.host, command);
    const y = await run(b.host, command);
    assert.deepEqual({ exitCode: y.exitCode, output: y.output, truncated: y.truncated }, { exitCode: x.exitCode, output: x.output, truncated: x.truncated }, command);
  }
});

test("a quick command is one script exec: after the prompt check and the buffer sweep nothing but the script is asked of the machine", async () => {
  const execs: string[][] = [];
  const { host } = rig({ scripts: SCRIPTS }, { wrap: (exec) => async (argv, x) => (execs.push([...argv]), exec(argv, x)) });
  await open(host);
  execs.length = 0;
  await run(host, "git status");
  const scripts = execs.filter((c) => c[0] === "sh" && c[2]?.startsWith("# vyre-run"));
  assert.equal(scripts.length, 1);
  // what the host asked of the machine: the prompt check (display-message, ps, capture of the cursor line), the buffer sweep, and the script; no typing, no looking, no clearing of the exit code of its own
  assert.deepEqual(execs.filter((c) => c[0] === "tmux").map((c) => c[1]).sort(), ["capture-pane", "display-message", "list-buffers"]);
  assert.equal(execs.length, 5, `five execs for one quick command, not eight: ${execs.map((c) => c.slice(0, 2).join(" ")).join(" | ")}`);
  // the script's arguments carry the line and the markers, never a shell's chance to read them as code
  assert.equal(scripts[0]![3], "sh");
  assert.ok(scripts[0]![5]!.includes("git status"));
  assert.ok(RUN_SCRIPT.startsWith("# vyre-run"));
});

test("the whole history is read once at the end: the kept copy holds far more than the answer, from the command's own first line, and the answer is still cut", async () => {
  const big = Array.from({ length: 400 }, (_, i) => `line ${i} ${"x".repeat(40)}`).join("\n");
  const { host } = rig({ scripts: { big: { out: big, code: 0 } } }, { maxOutput: 5000 });
  await open(host);
  const r = await run(host, "big");
  assert.equal(r.truncated, true);
  assert.equal(r.output.length, 5000);
  assert.ok(r.full !== undefined);
  assert.ok(r.full!.startsWith("line 0 "), "from the command's first line");
  assert.ok(r.full!.endsWith("line 399 " + "x".repeat(40)));
  assert.equal(r.full!.split("\n").length, 400);
});

test("the stored exit code ends a run whose marker row was drawn over; a command that ends in a timeout is interrupted with Ctrl-C and the session is usable after", async () => {
  const a = rig({ scripts: { ...SCRIPTS, "sleep 999": { hang: true } }, overwriteEnd: ["drawn over the marker"] });
  await open(a.host);
  const r = await run(a.host, "tput");
  assert.deepEqual([r.exitCode, r.output], [3, "drawn over the marker"]);
  await assert.rejects(() => run(a.host, "sleep 999", 1000), (e: unknown) => (e as { code?: string }).code === "timeout");
  assert.ok(a.tm.calls.some((c) => c[1] === "send-keys" && c.at(-1) === "C-c"), "Ctrl-C was sent");
  assert.equal(a.tm.sessions.get("vyre-trm_a1")!.hung, false);
  assert.equal((await run(a.host, "git status")).exitCode, 0);
});

test("a stopped turn ends a waiting script at once: the cancel file is made, the shell gets Ctrl-C, and the run answers 130 with what it printed and the line that says it was stopped", async () => {
  const { tm, host } = rig({ scripts: { "sleep 999": { hang: true } } });
  await open(host);
  const ac = new AbortController();
  const pending = run(host, "sleep 999", 60_000, ac.signal);
  setTimeout(() => ac.abort(), 20);
  const r = await pending;
  assert.equal(r.exitCode, 130);
  assert.ok(r.output.endsWith(STOPPED_LINE));
  assert.ok(tm.calls.some((c) => c[0] === "sh" && c[2]?.startsWith(": > ")), "the cancel file was made");
  assert.ok(tm.calls.some((c) => c[1] === "send-keys" && c.at(-1) === "C-c"));
});

test("a script that could not type the line lets the loop type it, once; one that typed it and then failed lets the loop go on watching without typing again", async () => {
  const hostTyped = (execs: string[][]): number => execs.filter((c) => c[0] === "tmux" && c[1] === "send-keys" && c.includes("-l")).length;
  // nothing typed (no sentinel): the loop types
  const execs1: string[][] = [];
  const none = rig({ scripts: SCRIPTS }, { wrap: (exec) => async (argv, x) => {
    execs1.push([...argv]);
    return argv[0] === "sh" && argv[2]?.startsWith("# vyre-run") ? { code: 90, stdout: "", stderr: "" } : exec(argv, x);
  } });
  await open(none.host);
  execs1.length = 0;
  const a = await run(none.host, "git status");
  assert.equal(a.exitCode, 0);
  assert.equal(hostTyped(execs1), 1, "typed once, by the loop");
  // the script ran (it typed the line in the machine) and then its answer was lost: the loop only watches
  const execs2: string[][] = [];
  let ranScript = 0;
  const lost = rig({ scripts: SCRIPTS }, { wrap: (exec) => async (argv, x) => {
    execs2.push([...argv]);
    if (argv[0] === "sh" && argv[2]?.startsWith("# vyre-run")) {
      ranScript += 1;
      await exec(argv, x);
      return { code: 1, stdout: "garbage", stderr: "__VYRE_SENT__\ndocker: connection lost" };
    }
    return exec(argv, x);
  } });
  await open(lost.host);
  execs2.length = 0;
  const b = await run(lost.host, "make");
  assert.deepEqual([b.exitCode, b.output], [2, "cc a.c\ncc b.c\nerror: b.c:3"]);
  assert.equal(ranScript, 1);
  assert.equal(hostTyped(execs2), 0, "never typed a second time");
});

test("parseRunScript takes the script's output apart, and says null for anything else", () => {
  const out = "screen line\nmore\n__VYRE_RC__:7\n__VYRE_DONE__:done\n__VYRE_FULL__\nfull one\nfull two\n";
  assert.deepEqual(parseRunScript(out), { screen: "screen line\nmore\n", rc: "7", status: "done", full: "full one\nfull two\n" });
  assert.deepEqual(parseRunScript("a\n__VYRE_RC__:\n__VYRE_DONE__:timeout\n"), { screen: "a\n", rc: "", status: "timeout" });
  assert.equal(parseRunScript("nothing of ours"), null);
  assert.equal(parseRunScript("x\n__VYRE_RC__:1\nno done line"), null);
});

test("a machine that cannot run the script (no sh, an exec that refuses) typed nothing: the loop types the line, once, and the run answers as before", async () => {
  const { tm, host } = rig({ scripts: SCRIPTS }, { wrap: (exec) => async (argv, x) => (argv[0] === "sh" ? { code: 127, stdout: "", stderr: "sh: not found" } : exec(argv, x)) });
  await open(host);
  const r = await run(host, "git status");
  assert.deepEqual([r.exitCode, r.output], [0, "On branch main\nnothing to commit"]);
  assert.equal(tm.calls.filter((c) => c[1] === "send-keys" && c.includes("-l") && c.at(-1)!.includes("git status")).length, 1, "typed once");
});
