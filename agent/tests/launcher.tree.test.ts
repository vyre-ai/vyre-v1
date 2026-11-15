// Stop on a turn that runs on a person's own computer: the engine and what it started are gone with the wrapper (F71).
import test from "node:test";
import assert from "node:assert/strict";
import { createLocalLauncher } from "../src/drivers/cli/index.ts";
import { treeKiller, treeOf, windowsKill } from "../src/drivers/cli/process-tree.ts";
import type { ProcRow } from "../src/drivers/cli/process-tree.ts";

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const gone = async (pid: number, ms: number): Promise<boolean> => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // a zombie of an ended process still answers signal 0 until its parent reaps it: init does, soon
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return !alive(pid);
};

// a wrapper that starts the engine in a session of its own, the way bwrap --new-session does, then waits: a signal to the wrapper alone does not reach it
const WRAPPER = `const{spawn}=require("node:child_process");
const c=spawn(process.execPath,["-e","setTimeout(()=>{},30000)"],{detached:true,stdio:"ignore"});
console.log(c.pid);setTimeout(()=>{},30000)`;

for (const signal of ["SIGTERM", "SIGKILL"] as const) {
  test(
    `Stop (${signal}) ends the wrapper and the engine under it, within two seconds`,
    { timeout: 15_000 },
    async () => {
      if (process.platform === "win32") return; // Windows ends the tree with taskkill, covered below
      const proc = await createLocalLauncher().spawn({ argv: [process.execPath, "-e", WRAPPER], env: {} });
      let out = "";
      for await (const chunk of proc.stdout) {
        out += chunk.toString();
        if (out.includes("\n")) break;
      }
      const engine = Number(out.trim());
      assert.ok(engine > 0 && alive(engine), "the engine under the wrapper is running");
      const at = Date.now();
      proc.kill(signal);
      assert.equal(await gone(engine, 2000), true, "the engine under the wrapper is gone");
      await proc.exited;
      assert.ok(Date.now() - at < 2000, `all of it ended in ${Date.now() - at} ms`);
    },
  );
}

const rows: ProcRow[] = [
  { pid: 10, ppid: 1, start: "a" },
  { pid: 11, ppid: 10, start: "b" },
  { pid: 12, ppid: 11, start: "c" },
  { pid: 13, ppid: 10, start: "d" },
  { pid: 99, ppid: 1, start: "z" },
];

test("the tree is the process and everything below it", () => {
  assert.deepEqual(
    treeOf(10, rows).map((r) => r.pid),
    [10, 11, 13, 12],
  );
  assert.deepEqual(treeOf(404, rows), []);
});

test("children are signalled before their parent, and a process that is not in the tree is left alone", () => {
  const sent: number[] = [];
  treeKiller(10, { platform: "linux", list: () => rows, send: (p) => void sent.push(p) }).kill("SIGTERM");
  assert.deepEqual(sent, [12, 13, 11, 10]);
});

test("a second signal still reaches the engine after the wrapper is gone, and never a number that was reused", () => {
  let table = rows;
  const sent: number[] = [];
  const k = treeKiller(10, { platform: "linux", list: () => table, send: (p) => void sent.push(p) });
  k.kill("SIGTERM");
  sent.length = 0;
  // the wrapper (10) is gone and its children belong to init now; 13's number was taken by a new process
  table = [
    { pid: 11, ppid: 1, start: "b" },
    { pid: 12, ppid: 11, start: "c" },
    { pid: 13, ppid: 1, start: "NEW" },
  ];
  k.kill("SIGKILL");
  assert.deepEqual(sent, [12, 11]);
});

test("on Windows the whole tree is ended with taskkill", () => {
  const ran: Array<[string, string[]]> = [];
  treeKiller(77, { platform: "win32", run: (c, a) => void ran.push([c, a]) }).kill("SIGTERM");
  assert.deepEqual(ran, [["taskkill", ["/PID", "77", "/T", "/F"]]]);
  assert.deepEqual(windowsKill(5).args, ["/PID", "5", "/T", "/F"]);
});

test("a wrapper that already exited is not walked, and a different process at its number is never signalled", () => {
  const sent: number[] = [];
  let table: ProcRow[] = [{ pid: 10, ppid: 1, start: "a" }];
  let exited = false;
  const k = treeKiller(10, {
    platform: "linux",
    list: () => table,
    send: (p) => void sent.push(p),
    exited: () => exited,
  });
  // the wrapper ends by itself; an unrelated process (with a child) now stands at its number
  exited = true;
  table = [
    { pid: 10, ppid: 1, start: "OTHER" },
    { pid: 50, ppid: 10, start: "x" },
  ];
  k.kill("SIGKILL");
  assert.deepEqual(sent, []);
  // and even when the exit was not noticed, a changed start time at the root's number is not walked
  exited = false;
  k.kill("SIGKILL");
  assert.deepEqual(sent, []);
});

test("a remembered tree is still finished after the wrapper has exited", () => {
  const sent: number[] = [];
  let table = rows;
  let exited = false;
  const k = treeKiller(10, {
    platform: "linux",
    list: () => table,
    send: (p) => void sent.push(p),
    exited: () => exited,
  });
  k.kill("SIGTERM");
  sent.length = 0;
  exited = true;
  table = [{ pid: 11, ppid: 1, start: "b" }];
  k.kill("SIGKILL");
  assert.deepEqual(sent, [11]);
});
