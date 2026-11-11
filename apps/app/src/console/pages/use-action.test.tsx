// useAction: the Console's write helper. Two different presses in a row (pick two people one after the other) are both done, in order; the same press twice is done once.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { installDom } from "../../../../../ui/src/testing/dom.ts";
import { ConsoleDataProvider } from "../shell/data.tsx";
import type { ConsoleData } from "../shell/data.tsx";
import { createSampleConsole } from "../shell/sample.ts";
import { MAX_WAITING_CHANGES, useAction } from "./shared.tsx";

type Run = ReturnType<typeof useAction>["run"];

async function withAction(call: (cap: string, input: unknown) => Promise<unknown>, body: (run: Run, refreshes: () => number, note: () => string) => Promise<void>): Promise<void> {
  const restore = installDom();
  const sample = createSampleConsole().data;
  const data = { ...sample, call } as unknown as ConsoleData;
  let refreshed = 0;
  let run: Run | null = null;
  let note = "";
  function Probe() { const a = useAction(() => { refreshed++; }); run = a.run; note = a.note; return null; }
  const root = createRoot();
  try {
    await act(async () => { root.render(<ConsoleDataProvider value={data}><Probe /></ConsoleDataProvider>); });
    await body(((...a: Parameters<Run>) => run!(...a)) as Run, () => refreshed, () => note);
  } finally { restore(); }
}

test("two different presses while the first is still on its way are both done, in order, and the second is not dropped", async () => {
  const seen: string[] = [];
  let release: () => void = () => undefined;
  const firstDone = new Promise<void>((r) => { release = r; });
  await withAction(async (cap, input) => { seen.push(`${cap}:${JSON.stringify(input)}`); if (seen.length === 1) await firstDone; return {}; }, async (run, refreshes) => {
    let first: unknown, second: unknown;
    await act(async () => {
      first = run("access.groups.add_member", { groupId: "grp_1", member: { kind: "person", id: "usr_maya" } }, "Member added");
      second = run("access.groups.add_member", { groupId: "grp_1", member: { kind: "person", id: "usr_priya" } }, "Member added");
    });
    assert.equal(seen.length, 1, "the second waits while the first is on its way");
    await act(async () => { release(); await first; await second; });
    assert.deepEqual(seen, [
      'access.groups.add_member:{"groupId":"grp_1","member":{"kind":"person","id":"usr_maya"}}',
      'access.groups.add_member:{"groupId":"grp_1","member":{"kind":"person","id":"usr_priya"}}',
    ], "both people were added");
    assert.equal(refreshes(), 2);
  });
});

test("the same press twice (a double click) is done once", async () => {
  let calls = 0;
  let release: () => void = () => undefined;
  const wait = new Promise<void>((r) => { release = r; });
  await withAction(async () => { calls++; await wait; return {}; }, async (run) => {
    let a: unknown, b: unknown;
    await act(async () => {
      a = run("access.groups.delete", { groupId: "grp_1" }, "Team deleted");
      b = run("access.groups.delete", { groupId: "grp_1" }, "Team deleted");
    });
    await act(async () => { release(); await a; await b; });
    assert.equal(calls, 1);
  });
});

test("when the first call fails the second still runs, and the failure stays in the note beside the second's success", async () => {
  let n = 0;
  await withAction(async () => { n++; if (n === 1) throw Object.assign(new Error("not allowed"), { code: "permission.no_grant" }); return {}; }, async (run, _r, note) => {
    let a: unknown, b: unknown;
    await act(async () => {
      a = run("access.groups.add_member", { groupId: "g", member: { id: "usr_maya" } }, "Priya added");
      b = run("access.groups.add_member", { groupId: "g", member: { id: "usr_priya" } }, "Priya added");
    });
    await act(async () => { await a; await b; });
    assert.equal(n, 2, "the second ran although the first failed");
    assert.match(note(), /Priya added/, "the second's outcome is shown");
    assert.ok(note().length > "Priya added".length, `and the first's failure is still there: ${note()}`);
  });
});

test("the queue is bounded: past the limit a call is refused with a line, not queued for ever", async () => {
  let calls = 0;
  let release: () => void = () => undefined;
  const hold = new Promise<void>((r) => { release = r; });
  await withAction(async () => { calls++; await hold; return {}; }, async (run, _r, note) => {
    const all: unknown[] = [];
    await act(async () => { for (let i = 0; i < MAX_WAITING_CHANGES + 6; i++) all.push(run("access.groups.add_member", { groupId: "g", member: { id: `usr_${i}` } }, "Added")); });
    assert.match(note(), /Too many changes are waiting/);
    await act(async () => { release(); await Promise.all(all); });
    assert.equal(calls, MAX_WAITING_CHANGES, "only as many as the limit allows were made; the rest were refused");
  });
});

test("a change whose page was closed before it failed is announced by the next page that makes changes", async () => {
  const restore = installDom();
  const sample = createSampleConsole().data;
  let release: (e: Error) => void = () => undefined;
  const failing = new Promise<never>((_, rej) => { release = rej; });
  const data = { ...sample, call: () => failing } as unknown as ConsoleData;
  let run: Run | null = null;
  let note = "";
  function Probe() { const a = useAction(() => undefined); run = a.run; note = a.note; return null; }
  const first = createRoot();
  const second = createRoot();
  try {
    await act(async () => { first.render(<ConsoleDataProvider value={data}><Probe /></ConsoleDataProvider>); });
    let pending: unknown;
    await act(async () => { pending = run!("access.groups.add_member", { groupId: "g", member: { id: "usr_priya" } }, "Added"); });
    await act(async () => { first.render(<></>); });   // the person leaves the page
    await act(async () => { release(Object.assign(new Error("not allowed"), { code: "permission.no_grant" })); await pending; });
    await act(async () => { second.render(<ConsoleDataProvider value={data}><Probe /></ConsoleDataProvider>); });
    assert.match(note, /A change you made before leaving the last page did not go through/);
  } finally { restore(); }
});
