// The island (chat gap G22, prototype p-crew "live"): one pill above the composer for ANY agent at work, the lead alone included. It says the same one calm word as the reply line ("Thinking", "Writing"), wears
// the faces of everyone working, opens the crew when pressed, and is not there while a question is open.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { Dimensions } from "react-native";
import { find, flush, installDom, mount, press, textOf } from "../../../onboarding/test-dom.ts";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { Conversation } from "../conversation/Conversation.tsx";
import { createSample } from "../conversation/sample.ts";
import { WorkIsland } from "./island.tsx";
import { calmWord } from "../conversation/activity.ts";

installComposerForTests(Composer);
Dimensions.set({
  window: { width: 1280, height: 800, scale: 1, fontScale: 1 },
  screen: { width: 1280, height: 800, scale: 1, fontScale: 1 },
});

const store = (steps: Array<{ id: string; name: string; state: "live" | "done" }>) => {
  const snap = { startedAt: 0, thinking: "", steps, version: 1 } as never;
  return { get: () => snap, subscribe: () => () => undefined };
};

test("a lone working agent gets the island: the same calm word as the reply line, the face, and a press opens the crew", async () => {
  installDom();
  let opened = 0;
  const root = await mount(
    createRoot,
    <WorkIsland store={store([])} faces={[{ id: "agt_a", name: "Aria", seed: "agt_a" }]} onPress={() => opened++} />,
  );
  assert.equal(
    textOf(find(root, "work-island-text")),
    calmWord({ startedAt: 0, thinking: "", steps: [], version: 1 }, false),
  );
  assert.equal(textOf(find(root, "work-island-text")), "Thinking");
  await press(find(root, "work-island"));
  assert.equal(opened, 1);
});

test("with words on the way it reads Writing, and held for a person it reads Waiting for you: the one word of the reply line", async () => {
  installDom();
  const held = await mount(
    createRoot,
    <WorkIsland store={store([])} held faces={[{ id: "a", name: "Aria", seed: "a" }]} onPress={() => undefined} />,
  );
  assert.equal(textOf(find(held, "work-island-text")), "Waiting for you");
  const running = await mount(
    createRoot,
    <WorkIsland
      store={store([{ id: "s", name: "Bash", state: "live" }])}
      faces={[{ id: "a", name: "Aria", seed: "a" }]}
      onPress={() => undefined}
    />,
  );
  assert.equal(textOf(find(running, "work-island-text")), "Working");
});

test("nobody working: no island", async () => {
  installDom();
  const root = await mount(createRoot, <WorkIsland faces={[]} onPress={() => undefined} />);
  assert.equal(find(root, "work-island"), null);
});

test("in a chat two agents at work show one island; an open question hides it", async () => {
  installDom();
  const busy = createSample("busy");
  const a = await mount(createRoot, <Conversation data={busy.data} />);
  await flush();
  assert.ok(find(a, "work-island"), "agents are working: the island is there, though no helper card asked for it");
  assert.equal(textOf(find(a, "work-island-text")), "Working");
  const asking = createSample("plan");
  const b = await mount(createRoot, <Conversation data={asking.data} />);
  await flush();
  assert.equal(find(b, "work-island"), null, "a question is waiting: its own island is there, this one steps aside");
});

test("the computer glyph shows only while the working agent is using its computer", async () => {
  installDom();
  const on = await mount(
    createRoot,
    <WorkIsland
      store={store([{ id: "s", name: "Bash", state: "live" }])}
      faces={[{ id: "a", name: "Aria", seed: "a" }]}
      onPress={() => undefined}
    />,
  );
  assert.ok(find(on, "work-island-computer"));
  const off = await mount(
    createRoot,
    <WorkIsland
      store={store([{ id: "s", name: "Read", state: "live" }])}
      faces={[{ id: "a", name: "Aria", seed: "a" }]}
      onPress={() => undefined}
    />,
  );
  assert.equal(find(off, "work-island-computer"), null);
  const done = await mount(
    createRoot,
    <WorkIsland
      store={store([{ id: "s", name: "Bash", state: "done" }])}
      faces={[{ id: "a", name: "Aria", seed: "a" }]}
      onPress={() => undefined}
    />,
  );
  assert.equal(find(done, "work-island-computer"), null, "a finished command is not using it now");
});
