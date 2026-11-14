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
    { when: "11:05", what: "An earlier turn", files: "1 file" },
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
  assert.match(textOf(find(root, "rewind-leaves")), /Anything already sent stays sent/);
  assert.match(textOf(find(root, "rewind-undoes")), /files back as they were/);
  assert.match(textOf(find(root, "rewind-not-kept")), /\.gitignore.*secret files.*git repository/);
  assert.match(textOf(find(root, "rewind-card")), /14 days/);
  assert.equal(find(root, "rewind-point-agt_dex.b")!.props["aria-checked"], true, "the newest is picked");
  assert.match(textOf(find(root, "rewind-point-agt_dex.b")), /14 files/);
  await press(find(root, "rewind-point-agt_dex.a")!);
  await press(find(root, "rewind-go")!);
  await flush();
  assert.deepEqual(s.calls.find((c) => c.cap === "chat.rewind")?.input, {
    threadId: "c1",
    pointId: "agt_dex.a",
    idempotencyKey: "rewind-c1-agt_dex.a",
  });
  assert.equal(closed, 1);
});

test("no points says why: only an agent that works in a folder on the Space's computer has them", async () => {
  installDom();
  const s = createSample("channel");
  const root = await mount(
    createRoot,
    <ConversationDataProvider value={withCall(s, { available: true, points: [] })}>
      <RewindCard threadId="c1" onClose={() => undefined} />
    </ConversationDataProvider>,
  );
  await flush();
  assert.match(textOf(find(root, "rewind-card")), /No points yet.*agent with no folder/);
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
  assert.match(textOf(find(root, "rewind-card")), /off in a chat with other people/);
  await press(find(root, "rewind-go")!);
  assert.equal(s.calls.filter((c) => c.cap === "chat.rewind").length, 0);
});
