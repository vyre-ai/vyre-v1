// Home no longer exists, so its task page is gone: a task opens in the Tasks place from every link, including the one beside a run in Automations.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const here = (p: string): string => new URL(p, import.meta.url).pathname;

test("the old Home task page is gone and nothing opens it", () => {
  for (const f of ["../../places/home/task/TaskLeaf.tsx", "../../places/home/task/TaskRoute.tsx", "../../places/home/task/route.ts", "./automations-task.tsx", "../../../../../ui/src/TaskPage/index.tsx"]) assert.equal(existsSync(here(f)), false, f);
  for (const f of ["./home.tsx", "./automations.tsx"]) assert.doesNotMatch(readFileSync(here(f), "utf8"), /TaskLeaf|TaskRoute|SideTask|openedTask|places\/home\/task/, f);
});

test("a task beside a run opens in the Tasks place", () => {
  assert.match(readFileSync(here("./automations.tsx"), "utf8"), /openTaskSide: \(taskId\) => rt\.open\(\{ screen: "tasks\.page", args: \{ taskId \} \}\)/);
});
