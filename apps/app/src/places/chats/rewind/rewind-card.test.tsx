// The Rewind card (chat gap G36, G37): the points with time and file count, what it undoes and never touches said before any press, Go back calls chat.rewind for the picked point, off in a group.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { installDom, mount, press, find, flush, textOf } from "../../../onboarding/test-dom.ts";
import { ConversationDataProvider } from "../conversation/data.tsx";
import { createSample } from "../conversation/sample.ts";
import { RewindCard } from "./RewindCard.tsx";
import { pointLine } from "./model.ts";

const points = [
  { pointId: "agt_dex.b", agentId: "agt_dex", at: 2_000, files: 14, after: "Split the sign-in page" },
  { pointId: "agt_dex.a", agentId: "agt_dex", at: 1_000, files: 1 },
];
const withCall = (s: ReturnType<typeof createSample>, read: unknown) =>
  ({
    ...s.data,
    call: async (cap: string, input: unknown) => {
      if (cap === "engine.rewind.points") return read;
      if (cap === "chat.rewind") {
        s.calls.push({ cap, input } as never);
        return {};
      }
      return s.data.call(cap as never, input as never);
    },
  }) as typeof s.data;

test("the words: a file count, and a point with no ask reads as an earlier turn", () => {
  assert.deepEqual(
    pointLine(points[0]!, () => "11:42"),
    { when: "11:42", what: "Split the sign-in page", files: "14 files" },
  );
  assert.deepEqual(
    pointLine(points[1]!, () => "11:05"),
    { when: "11:05", what: "An earlier message", files: "1 file" },
  );
});

test("it says what it undoes and never touches before anything is pressed; the newest point is picked; Go back calls chat.rewind for the picked one and closes", async () => {
  installDom();
  const s = createSample("channel");
  let closed = 0;
  const root = await mount(
    createRoot,
    <ConversationDataProvider value={withCall(s, { available: true, points })}>
      <RewindCard threadId="c1" onClose={() => closed++} clock={(ms) => `t${ms}`} />
    </ConversationDataProvider>,
  );
  await flush();
  assert.match(
    textOf(find(root, "rewind-undoes")),
    /removes files made since, by anyone\. Nothing already sent, no record and no task changes/,
  );
  assert.equal(find(root, "rewind-not-kept"), null, "the long list of what is not kept is one press away");
  await press(find(root, "rewind-more"));
  assert.match(
    textOf(find(root, "rewind-not-kept")),
    /neither removed nor put back.*\.gitignore.*secret files.*git repository.*This agent forgets what it was doing; other agents in this chat do not/,
  );
  assert.match(textOf(find(root, "rewind-card")), /14 days/);
  assert.equal(find(root, "rewind-point-agt_dex.b")!.props["aria-checked"], true, "the newest is picked");
  assert.match(textOf(find(root, "rewind-point-agt_dex.b")), /14 files/);
  await press(find(root, "rewind-point-agt_dex.a")!);
  await press(find(root, "rewind-go")!);
  await flush();
  const sent = s.calls.find((c) => c.cap === "chat.rewind")?.input as Record<string, unknown>;
  assert.deepEqual([sent["threadId"], sent["pointId"], typeof sent["idempotencyKey"]], ["c1", "agt_dex.a", "string"]);
  assert.equal(closed, 1);
});

test("no points says why: a point is saved each time an agent that works in a folder on the Space's computer starts on one of your messages", async () => {
  installDom();
  const s = createSample("channel");
  const root = await mount(
    createRoot,
    <ConversationDataProvider value={withCall(s, { available: true, points: [] })}>
      <RewindCard threadId="c1" onClose={() => undefined} />
    </ConversationDataProvider>,
  );
  await flush();
  assert.match(
    textOf(find(root, "rewind-card")),
    /No points yet\. A point is saved each time an agent that works in a folder/,
  );
});

test("in a chat with other people it says so and Go back is not pressable", async () => {
  installDom();
  const s = createSample("channel");
  const root = await mount(
    createRoot,
    <ConversationDataProvider value={withCall(s, { available: false, why: "group", points: [] })}>
      <RewindCard threadId="c1" onClose={() => undefined} />
    </ConversationDataProvider>,
  );
  await flush();
  assert.match(textOf(find(root, "rewind-card")), /Only a chat with an agent goes back/);
  await press(find(root, "rewind-go")!);
  assert.equal(s.calls.filter((c) => c.cap === "chat.rewind").length, 0);
});

test("a point finished after the agent began says During, never before; work on your own computer is said once; a refusal's plain words are shown", async () => {
  installDom();
  const s = createSample("channel");
  const data = {
    ...s.data,
    call: async (cap: string) => {
      if (cap === "engine.rewind.points")
        return {
          available: true,
          ownComputer: true,
          points: [
            { pointId: "agt_dex.d", agentId: "agt_dex", at: 1_000, files: 3, after: "Split the page", during: true },
          ],
        };
      if (cap === "chat.rewind") throw new Error("Stop Dex first, then go back.");
      return s.data.call(cap as never, undefined as never);
    },
  } as typeof s.data;
  const root = await mount(
    createRoot,
    <ConversationDataProvider value={data}>
      <RewindCard threadId="c1" onClose={() => undefined} clock={(ms) => `t${ms}`} />
    </ConversationDataProvider>,
  );
  await flush();
  assert.match(textOf(find(root, "rewind-point-agt_dex.d")), /During: Split the page/);
  assert.doesNotMatch(textOf(find(root, "rewind-card")), /Before/);
  assert.match(
    textOf(find(root, "rewind-own-computer")),
    /Work done on your own computer cannot be gone back to here\./,
  );
  await press(find(root, "rewind-go")!);
  await flush();
  assert.equal(textOf(find(root, "rewind-failed")), "Stop Dex first, then go back.");
});
