// What the Automations place hands its parts: the pick lists come from the Space, the runs data reads the real thread query, and Journey tasks can be done by an Automation.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AutomationsDataProvider } from "../../places/automations/canvas/data.tsx";
import { ConfigExtrasProvider } from "../../places/automations/config/data.tsx";
import { createConfigSample, northwind } from "../../places/automations/config/sample.ts";
import { JourneyPane } from "../../places/automations/journeys/index.ts";
import { clearTaskField, doneByWords, updateTask } from "../../places/automations/journeys/model.ts";
import type { Journey } from "../../places/automations/journeys/model.ts";
import { configExtras, directoryFrom, runsData } from "./automations-parts.tsx";

test("the pick lists come from the Space: roles, groups, open channels, and Automations by the Journey trigger they use", () => {
  const dir = directoryFrom({
    people: [{ id: "usr_a", name: "Ada" }], agents: [{ id: "agt_b", name: "Scout" }],
    groups: { groups: [{ id: "grp_x", name: "Staff" }] }, roles: { roles: [{ id: "rol_member", name: "Member" }] },
    channels: { channels: [{ channelId: "chn_1", name: "intake", archived: false }, { channelId: "chn_2", name: "old", archived: true }] },
    automations: { automations: [
      { id: "aut_in", name: "On entering", triggers: ["journey_stage_entered"] }, { id: "aut_out", name: "On leaving", triggers: ["journey_stage_left"] }, { id: "aut_m", name: "By hand", triggers: ["manual"] },
    ] },
  });
  assert.deepEqual([dir.groups, dir.roles, dir.channels].map((l) => l.map((e) => e.name)), [["Staff"], ["Member"], ["intake"]]);
  assert.deepEqual(dir.automations.map((a) => a.id), ["aut_in"]);
  assert.deepEqual(dir.automationsLeaving?.map((a) => a.id), ["aut_out"]);
  const empty = directoryFrom({ people: [], agents: [], groups: null, roles: undefined, channels: "no", automations: 7 });
  assert.deepEqual([empty.groups, empty.roles, empty.channels, empty.automations], [[], [], [], []]);
});

test("the config extras open an automation and its runs", () => {
  const log: string[] = [];
  const x = configExtras(directoryFrom({ people: [], agents: [], groups: null, roles: null, channels: null, automations: null }), { openAutomation: (id) => log.push(`open ${id}`), openRuns: (id) => log.push(`runs ${id}`) });
  x.openAutomation?.("aut_1");
  x.openRuns?.("aut_1");
  assert.deepEqual(log, ["open aut_1", "runs aut_1"]);
});

test("the runs data reads a run's thread through the conversation messages query and calls as the person", async () => {
  const asked: unknown[] = [];
  const rt = {
    screens: { query: (screen: string, name: string, state: unknown) => { asked.push([screen, name, state]); return { subscribe: () => () => undefined, getSnapshot: () => ({ status: "loading" }) }; } },
    call: async (cap: string) => ({ cap }), me: { id: "usr_a", name: "Ada" }, clock: () => ({ now: 5 }),
    principals: { subscribe: () => () => undefined, getSnapshot: () => ({ status: "ready", data: [{ id: "usr_a", name: "Ada" }] }) },
  };
  const d = runsData(rt as never, { openAutomation: () => undefined, openRun: () => undefined, openRunSide: () => undefined, ask: () => undefined });
  d.thread("thr_1");
  assert.deepEqual(asked, [["chats.conversation", "messages", { threadId: "thr_1" }]]);
  assert.equal(d.name("usr_a"), "Ada");
  assert.deepEqual(await d.call("runs.get", {}), { cap: "runs.get" });
  assert.equal(d.clock().now, 5);
});

test("a Journey task can be done by an Automation, and the pane says so and lets a designer change it", () => {
  const s = createConfigSample(northwind);
  const j = s.replica.rows("journeys_full")[0] as unknown as Journey;
  const stage = j.stages.find((g) => g.tasks.length > 0)!;
  const task = stage.tasks[0]!;
  const done = updateTask(j.stages, stage.key, task.key, { doneByAutomation: "aut_digest" });
  assert.equal(done.find((g) => g.key === stage.key)!.tasks[0]!.doneByAutomation, "aut_digest");
  assert.equal("doneByAutomation" in clearTaskField(done, stage.key, task.key, "doneByAutomation").find((g) => g.key === stage.key)!.tasks[0]!, false);
  assert.equal(doneByWords({ doneByAutomation: "aut_digest" }, () => "Weekly digest"), "Weekly digest");
  assert.equal(doneByWords({}, () => "x"), "A person or agent");
  const html = renderToStaticMarkup(
    <AutomationsDataProvider value={s.data}><ConfigExtrasProvider value={s.extras}><JourneyPane journeyId={j.id} selection={{ stage: stage.key, task: task.key }} /></ConfigExtrasProvider></AutomationsDataProvider>,
  ).replaceAll("<!-- -->", "");
  assert.ok(html.includes('data-testid="task-done-by"') && html.includes("Done by") && html.includes("A person or agent"), "the Done by row is on the task pane");
});
