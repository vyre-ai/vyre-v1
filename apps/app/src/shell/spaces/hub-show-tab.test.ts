// Choosing a tab (hub.showTab). When the frame is showing the tab's own last view it asks for one frame: the place changes after that paint, and only if the tab is
// still the one chosen and still holds what it held.
import test from "node:test";
import assert from "node:assert/strict";
import { createShellHub } from "./hub.ts";
import { SEED_DEFS } from "./model.ts";

const hubOf = () =>
  createShellHub({
    spaces: SEED_DEFS,
    openId: SEED_DEFS[0]!.spaceId,
    personId: "imran",
    deviceId: "web",
    storage: { getItem: () => null, setItem: () => undefined },
    skeletonMs: 0,
  });
const where = (hub: ReturnType<typeof hubOf>) => [hub.state().place, hub.state().hash];

function three(hub: ReturnType<typeof hubOf>) {
  hub.go("chats", "subject=thread:t1");
  hub.go("files", "file=f1", true);
  hub.go("records", "record=r1", true);
  const tabs = hub.session().tabs;
  const by = (hash: string) => tabs.state().tabs.find((t) => t.hash === hash)!;
  return { tabs, chat: by("subject=thread:t1"), file: by("file=f1"), record: by("record=r1") };
}

test("with no frame asking to wait, choosing a tab shows its place at once", () => {
  const hub = hubOf();
  const { tabs, file } = three(hub);
  hub.showTab(file);
  assert.deepEqual(where(hub), ["files", "file=f1"]);
  assert.equal(tabs.state().active, file.key, "the hub selects the tab itself");
  // a frame that holds the view but shows no kept copy changes nothing either
  const asked: (string | undefined)[] = [];
  hub.setHolder((to) => {
    asked.push(to);
    return false;
  });
  const chat = tabs.state().tabs.find((t) => t.hash === "subject=thread:t1")!;
  hub.showTab(chat);
  assert.deepEqual(where(hub), ["chats", "subject=thread:t1"]);
  assert.equal(asked.at(-1), chat.key, "the frame is told which tab is being shown");
});

test("a frame showing the tab's own last view gets its one frame: the place changes when it says so, to what the tab holds then", () => {
  const hub = hubOf();
  const { tabs, file } = three(hub);
  let then: (() => void) | undefined;
  hub.setHolder((_to, run) => {
    then = run;
    return run !== undefined;
  });
  const before = where(hub);
  let told = 0;
  const off = hub.subscribe(() => {
    told += 1;
  });
  const selected = tabs.state().active;
  hub.showTab(file);
  assert.deepEqual(where(hub), before, "nothing is made again before the kept view is painted");
  assert.equal(tabs.state().active, selected, "and the selection has not moved either: tab and place change together");
  assert.equal(told, 0);
  then!();
  assert.deepEqual(where(hub), ["files", "file=f1"]);
  assert.equal(tabs.state().active, file.key);
  assert.equal(told, 1);
  off();
});

test("the person went on to another tab inside that frame: the first tab's late change does nothing", () => {
  const hub = hubOf();
  const { tabs, file, chat } = three(hub);
  const runs: (() => void)[] = [];
  let wait = true;
  hub.setHolder((_to, run) => {
    if (!wait || run === undefined) return false;
    runs.push(run);
    return true;
  });
  hub.showTab(file);
  // a second press before the frame came: this one is shown at once
  wait = false;
  hub.showTab(chat);
  assert.deepEqual(where(hub), ["chats", "subject=thread:t1"]);
  runs[0]!();
  assert.deepEqual(where(hub), ["chats", "subject=thread:t1"], "the page stays on the tab that is chosen");
  assert.equal(tabs.state().active, chat.key);
});
