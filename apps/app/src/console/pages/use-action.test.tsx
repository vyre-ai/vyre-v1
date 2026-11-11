// useAction: the Console's write helper. Two different presses in a row (pick two people one after the other) are both done, in order; the same press twice is done once.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { installDom } from "../../../../../ui/src/testing/dom.ts";
import { ConsoleDataProvider } from "../shell/data.tsx";
import type { ConsoleData } from "../shell/data.tsx";
import { createSampleConsole } from "../shell/sample.ts";
import { useAction } from "./shared.tsx";

type Run = ReturnType<typeof useAction>["run"];

async function withAction(call: (cap: string, input: unknown) => Promise<unknown>, body: (run: Run, refreshes: () => number) => Promise<void>): Promise<void> {
  const restore = installDom();
  const sample = createSampleConsole().data;
  const data = { ...sample, call } as unknown as ConsoleData;
  let refreshed = 0;
  let run: Run | null = null;
  function Probe() { run = useAction(() => { refreshed++; }).run; return null; }
  const root = createRoot();
  try {
    await act(async () => { root.render(<ConsoleDataProvider value={data}><Probe /></ConsoleDataProvider>); });
    await body(((...a: Parameters<Run>) => run!(...a)) as Run, () => refreshed);
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
