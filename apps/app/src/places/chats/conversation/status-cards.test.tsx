// The status cards (owner, 6 Nov 2026): a result, a progress and a status block, each drawn with the card library; their buttons run the card's own capability; a card on a system line replaces the line.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { StatusCard, actsOf, isStatusCard } from "./status-cards.tsx";

installDom();

test("the three kinds are known; actions are read defensively", () => {
  assert.ok(isStatusCard("result_card") && isStatusCard("progress_card") && isStatusCard("status_card") && !isStatusCard("link_card"));
  assert.deepEqual(actsOf([{ key: "a", label: "A" }, { key: "", label: "x" }, { label: "no key" }, { key: "c", label: "C", cap: "x.y", input: { id: 1 } }]), [{ key: "a", label: "A" }, { key: "c", label: "C", cap: "x.y", input: { id: 1 } }]);
  assert.deepEqual(actsOf(undefined), []);
});

test("a result card: the title, a summary line, View the change as the primary and Open checks beside it", async () => {
  const ran: string[] = [];
  const root = await mount(createRoot, <StatusCard id="r1" type="result_card" host={{ run: (a) => { ran.push(a.key); } }} data={{ title: "Merged #893 into main", body: "470 tests passed, 0 failed.", actions: [{ key: "view", label: "View the change" }, { key: "checks", label: "Open checks" }] }} />);
  const t = textOf(find(root, "status-card-r1"));
  assert.ok(t.includes("Merged #893 into main") && t.includes("470 tests passed") && t.includes("View the change") && t.includes("Open checks"));
  await press(find(root, "card-r1-view")); await press(find(root, "card-r1-checks"));
  assert.deepEqual(ran, ["view", "checks"]);
});

test("a progress card: steps with their states, Watch, and Stop apart", async () => {
  const ran: string[] = [];
  const root = await mount(createRoot, <StatusCard id="p1" type="progress_card" host={{ run: (a) => { ran.push(a.key); } }} data={{ title: "Release rc.22.1", step: "Step 3 of 3", state: "running", steps: [{ label: "Build", state: "done" }, { label: "Sign", state: "done" }, { label: "Publish, uploading the Mac app", state: "running" }], actions: [{ key: "watch", label: "Watch" }, { key: "stop", label: "Stop" }] }} />);
  const t = textOf(find(root, "status-card-p1"));
  assert.ok(t.includes("Step 3 of 3") && t.includes("Build") && t.includes("Publish, uploading the Mac app"));
  assert.ok(find(root, "card-p1-step-2"));
  await press(find(root, "card-p1-watch")); await press(find(root, "card-p1-stop"));
  assert.deepEqual(ran, ["watch", "stop"]);
});

test("a status card: what happened, one fix button, and a ... menu with the rest; a failed press says so on the card", async () => {
  const ran: string[] = [];
  const root = await mount(createRoot, <StatusCard id="s1" type="status_card" host={{ run: (a) => { ran.push(a.key); if (a.key === "fix") return Promise.reject(new Error("no")); } }} data={{ title: "The MLA update could not start", body: "The server ran out of disk.", tone: "warn", fix: { key: "fix", label: "Free space and update" }, more: [{ key: "details", label: "Details" }, { key: "copy", label: "Copy id" }] }} />);
  assert.ok(textOf(find(root, "status-card-s1")).includes("Free space and update"));
  assert.equal(find(root, "card-s1-menu"), null);
  await press(find(root, "card-s1-more"));
  assert.ok(textOf(find(root, "card-s1-menu")).includes("Copy id"));
  await press(find(root, "card-s1-fix")); await flush();
  assert.match(textOf(find(root, "status-card-s1")), /did not work/);
  assert.deepEqual(ran, ["fix"]);
});

test("a card without a title draws nothing", async () => {
  const root = await mount(createRoot, <StatusCard id="x" type="result_card" host={{ run: () => undefined }} data={{}} />);
  assert.equal(find(root, "status-card-x"), null);
});
