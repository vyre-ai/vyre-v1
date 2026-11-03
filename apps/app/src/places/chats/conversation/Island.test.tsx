// The Island on a screen: it shows and hides with real turn state, one face per working agent, the computer button only while a computer is in use, a press on a face steers, and Stop on a job works.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { createStreamStore } from "../../../../../../ui/src/stream/index.ts";
import type { ActivitySnapshot, ActivityStore, LiveTurn } from "../../../shell/session/turn-streams.ts";
import { Island } from "./Island.tsx";
import type { IslandProps } from "./Island.tsx";

const NAMES: Record<string, string> = { agt_mira: "Mira", agt_ember: "Ember", agt_rowan: "Rowan", agt_sol: "Sol" };
const mk = (agentId: string, state: "writing" | "ended" = "writing"): LiveTurn => ({ turnId: `t_${agentId}`, threadId: "thr_1", agentId, store: createStreamStore(), state, startedAt: 1_000 });
const store = (steps: ActivitySnapshot["steps"] = [], done = false): ActivityStore => ({ get: () => ({ startedAt: 1_000, thinking: "", steps, version: 1, done }), subscribe: () => () => undefined });

async function show(over: Partial<IslandProps>): Promise<{ root: ReturnType<typeof find>; steered: string[]; stopped: string[]; computers: string[] }> {
  installDom();
  const steered: string[] = [], stopped: string[] = [], computers: string[] = [];
  const root = await mount(createRoot as never, (
    <Island turns={[]} nameOf={(id) => NAMES[id] ?? id} jobs={[]} now={() => 41_000} onSteer={(id) => steered.push(id)} onStopJob={(id) => stopped.push(id)} onOpenComputer={(id) => computers.push(id)} {...over} />
  ));
  await flush();
  return { root, steered, stopped, computers };
}

test("it hides when nobody is working and shows when a turn is; a finished turn alone does not keep it", async () => {
  assert.equal(find((await show({})).root!, "island"), null);
  assert.equal(find((await show({ turns: [mk("agt_mira", "ended")] })).root!, "island"), null);
  const one = await show({ turns: [mk("agt_mira")], activityOf: () => store() });
  assert.match(textOf(find(one.root!, "island-word")), /Thinking/);
});

test("one face per working agent, the state word follows the real step, and a press on a face steers that agent", async () => {
  const stores: Record<string, ActivityStore> = { "turn:t_agt_mira": store([{ id: "1", name: "Read", state: "live", detail: "model.ts" }]), "turn:t_agt_ember": store(), "turn:t_agt_rowan": store([{ id: "1", name: "AskUserQuestion", state: "live" }]) };
  const s = await show({ turns: [mk("agt_mira"), mk("agt_ember"), mk("agt_rowan")], activityOf: (id) => stores[id] });
  for (const a of ["agt_mira", "agt_ember", "agt_rowan"]) assert.ok(find(s.root!, `island-face-${a}`), `a face for ${a}`);
  assert.match(textOf(find(s.root!, "island-word")), /Reading/);
  assert.match(String(find(s.root!, "island-face-agt_mira")!.props["aria-label"]), /Mira · Reading model\.ts · 40s/);
  assert.match(String(find(s.root!, "island-face-agt_rowan")!.props["aria-label"]), /Rowan · Asking you/);
  await press(find(s.root!, "island-face-agt_ember"));
  assert.deepEqual(s.steered, ["agt_ember"]);
});

test("Watch the computer shows only while an agent is using a computer", async () => {
  const idle = await show({ turns: [mk("agt_ember")], activityOf: () => store([{ id: "1", name: "Read", state: "live" }]) });
  assert.equal(find(idle.root!, "island-computer"), null);
  const using = await show({ turns: [mk("agt_ember")], activityOf: () => store([{ id: "1", name: "mcp__vyre-chrome__chrome_click", state: "live" }]) });
  await press(find(using.root!, "island-computer"));
  assert.deepEqual(using.computers, ["agt_ember"]);
});

test("the pill opens a list of everyone working and the background jobs; Stop on a job calls it", async () => {
  const s = await show({ turns: [mk("agt_mira")], activityOf: () => store(), jobs: [{ threadId: "thr_job", title: "Export the Lab 7 list", startedAt: 1_000 }] });
  assert.equal(find(s.root!, "island-list"), null);
  await press(find(s.root!, "island-toggle"));
  assert.match(textOf(find(s.root!, "island-list")), /Mira.*In the background.*Export the Lab 7 list/s);
  await press(find(s.root!, "island-stop-thr_job"));
  assert.deepEqual(s.stopped, ["thr_job"]);
  const jobsOnly = await show({ jobs: [{ threadId: "thr_job", title: "Export", startedAt: 1_000 }] });
  assert.match(textOf(find(jobsOnly.root!, "island-word")), /1 in the background/);
});
