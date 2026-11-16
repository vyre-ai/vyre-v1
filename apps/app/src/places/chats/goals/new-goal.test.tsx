// New goal: the sheet the Chats sidebar opens (it used to open a goal page for the id "new", which the Space refused: "This goal is not available"), the create call it makes, and the guard that no place opens a page for "new".
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press, textOf, typeInto } from "../../../onboarding/test-dom.ts";
import type { Node } from "../../../onboarding/test-dom.ts";
import { NewGoalSheet } from "./NewGoalSheet.tsx";
import { DAY_MS, canCreateGoal, defaultLead, goalError, goalInput } from "./new-goal.ts";
import type { GoalCreateIn } from "./new-goal.ts";

const open: Array<{ unmount(): void }> = [];
afterEach(async () => {
  for (const r of open.splice(0))
    await act(async () => {
      r.unmount();
    });
});
async function mount(el: React.ReactElement): Promise<Node> {
  const r = createRoot();
  open.push(r);
  await act(async () => {
    r.render(el);
  });
  await flush();
  return r.container as unknown as Node;
}
const AGENTS = [
  { agentId: "agt_helper", name: "Helper" },
  { agentId: "agt_assistant", name: "Assistant" },
];

test("the pure part: the assistant leads unless the person picks, a goal needs a title and a lead, the deadline counts from now", () => {
  assert.equal(defaultLead(AGENTS, "agt_assistant"), "agt_assistant");
  assert.equal(defaultLead(AGENTS, "agt_gone"), "agt_helper");
  assert.equal(defaultLead([], "agt_assistant"), "");
  assert.equal(canCreateGoal({ title: "  ", outcome: "", leadAgentId: "agt_a", days: 7 }), false);
  assert.equal(canCreateGoal({ title: "Ship it", outcome: "", leadAgentId: "", days: 7 }), false);
  const i = goalInput({ title: " Ship it ", outcome: "", leadAgentId: "agt_a", days: 7 }, 1000);
  assert.equal(i.title, "Ship it");
  assert.equal(i.finish.line, "Ship it");
  assert.equal(i.finish.kind, "owner");
  assert.equal(i.deadline, 1000 + 7 * DAY_MS);
  assert.equal(
    goalInput({ title: "A", outcome: "Ten sent", leadAgentId: "agt_a", days: 1 }, 0).finish.line,
    "Ten sent",
  );
  assert.match(goalError({ code: "permission.denied" }), /cannot make goals/);
  assert.doesNotMatch(goalError(new Error("422 {id}")), /\b(422|id)\b/);
});

test("the sheet makes the goal with the assistant as lead and hands back its id", async () => {
  installDom();
  const made: GoalCreateIn[] = [];
  const created: string[] = [];
  const root = await mount(
    <NewGoalSheet
      agents={AGENTS}
      assistantId="agt_assistant"
      create={async (i) => {
        made.push(i);
        return "gol_new";
      }}
      onCreated={(id) => void created.push(id)}
      onClose={() => undefined}
      now={() => 5}
    />,
  );
  assert.match(textOf(find(root, "new-goal-lead")), /Led by Assistant/);
  await press(find(root, "new-goal-create")); // nothing to make without a title
  assert.equal(made.length, 0);
  await typeInto(find(root, "new-goal-title"), "Answer every open question");
  await press(find(root, "new-goal-create"));
  await flush();
  assert.equal(made.length, 1);
  assert.equal(made[0]!.leadAgentId, "agt_assistant");
  assert.equal(made[0]!.title, "Answer every open question");
  assert.deepEqual(created, ["gol_new"]);
});

test("a refused create stays on the sheet and says so in plain words", async () => {
  installDom();
  const root = await mount(
    <NewGoalSheet
      agents={AGENTS}
      assistantId="agt_assistant"
      create={async () => {
        throw { code: "permission.denied" };
      }}
      onCreated={() => undefined}
      onClose={() => undefined}
    />,
  );
  await typeInto(find(root, "new-goal-title"), "Anything");
  await press(find(root, "new-goal-create"));
  await flush();
  assert.match(textOf(find(root, "new-goal-error")), /cannot make goals/);
});

test("no place opens a page for the id new (a New button that does that lands on a refusal)", () => {
  const src = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  const hits: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) {
        const t = fs.readFileSync(p, "utf8");
        if (/\bopen[A-Z]\w*\?*\.?\(\s*"new"\s*\)/.test(t)) hits.push(path.relative(src, p));
      }
    }
  };
  walk(src);
  assert.deepEqual(hits, []);
});
