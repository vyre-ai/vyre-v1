// Rewind in the chat (chat gap G13, G14, G37): the icon on your own message's bar, "Rewind to here" in its menu, /rewind, the card picking the point of the message you pressed, and the folded row with Undo.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "test-renderer";
import { installDom, mount, press, find, flush, textOf } from "../../../onboarding/test-dom.ts";
import { ConversationDataProvider } from "../conversation/data.tsx";
import { createSample } from "../conversation/sample.ts";
import { HoverBar, menuFor } from "../conversation/MessageView.tsx";
import type { MessageActions } from "../conversation/MessageView.tsx";
import type { Message } from "../conversation/model.ts";
import { runSlash } from "../conversation/commands.ts";
import type { CommandEnv } from "../conversation/commands.ts";
import { chatCommand } from "../../../../../../lib/chat-commands.ts";
import { FoldedRow } from "../session/rows.tsx";
import { foldedWords, withFolded } from "../session/model.ts";
import { RewindCard } from "./RewindCard.tsx";

const msg = (o: Record<string, unknown> = {}): Message =>
  ({
    messageId: "m1",
    threadId: "t1",
    threadSeq: 1,
    author: { kind: "person", id: "me" },
    kind: "text",
    body: "Add the uploads folder",
    blocks: [],
    depth: 0,
    attachments: [],
    reactions: [],
    pinned: false,
    createdAt: 1,
    ...o,
  }) as unknown as Message;
const calls: string[] = [];
const acts = {
  copy() {},
  edit() {},
  setPinned() {},
  react() {},
  openThread() {},
  remove() {},
  showMenu() {},
  rewind: (id: string) => calls.push(`rewind:${id}`),
} as unknown as MessageActions;
const labels = (m: Message, mine: boolean, a = acts): string[] =>
  menuFor(m, mine, a, () => undefined).flatMap((e) => ("label" in e ? [e.label] : []));

test("your own message has Rewind to here in its menu; someone else's and a chat that cannot go back have none", () => {
  assert.ok(labels(msg(), true).includes("Rewind to here"));
  assert.ok(!labels(msg({ author: { kind: "person", id: "usr_maya" } }), false).includes("Rewind to here"));
  assert.ok(!labels(msg(), true, { ...(acts as object), rewind: undefined } as never).includes("Rewind to here"));
  const entry = menuFor(msg(), true, acts, () => undefined).find((e) => "label" in e && e.label === "Rewind to here");
  (entry as { onSelect(): void }).onSelect();
  assert.deepEqual(calls, ["rewind:m1"]);
});

test("your own message's hover bar carries the rewind icon, beside Copy and Edit; nobody else's does", () => {
  const mine = renderToStaticMarkup(<HoverBar m={msg()} mine a={acts} onEdit={() => undefined} visible />);
  assert.match(mine, /act-rewind-m1/);
  const theirs = renderToStaticMarkup(
    <HoverBar
      m={msg({ author: { kind: "agent", id: "agt_a" } })}
      mine={false}
      byAgent
      a={acts}
      onEdit={() => undefined}
      visible
    />,
  );
  assert.doesNotMatch(theirs, /act-rewind/);
});

test("/rewind is in the list and opens the card; where the chat cannot go back it says so", async () => {
  assert.ok(chatCommand("rewind"));
  const s = createSample("channel");
  let opened = 0;
  const shown: unknown[] = [];
  const env = {
    data: s.data,
    thread: { kind: "chat", agents: [{ agentId: "agt_a" }] },
    rows: [],
    show: (r: unknown) => shown.push(r),
    newKey: () => "k",
    openFind() {},
    openSearch() {},
    send() {},
    openRewind: () => opened++,
  } as unknown as CommandEnv;
  assert.equal(await runSlash("/rewind", env), true);
  assert.equal(opened, 1);
  const bare = { ...env, openRewind: undefined } as CommandEnv;
  await runSlash("/rewind", bare);
  assert.match(JSON.stringify(shown.at(-1)), /needs a chat with an agent/);
});

test("Rewind to here: the card picks the turn that message began, and says who sees it in a shared chat", async () => {
  installDom();
  const s = createSample("channel");
  const points = [
    { pointId: "agt_a.2", agentId: "agt_a", at: 3_000, files: 2, messageId: "m_second" },
    { pointId: "agt_a.1", agentId: "agt_a", at: 1_000, files: 1, messageId: "m_first" },
  ];
  const data = {
    ...s.data,
    call: async (cap: string) => (cap === "engine.rewind.points" ? { available: true, points, active: [] } : {}),
  } as typeof s.data;
  const root = await mount(
    createRoot,
    <ConversationDataProvider value={data}>
      <RewindCard threadId="c1" messageId="m_first" shared onClose={() => undefined} clock={(ms) => `t${ms}`} />
    </ConversationDataProvider>,
  );
  await flush();
  assert.equal(find(root, "rewind-point-agt_a.1")!.props["aria-checked"], true);
  assert.match(textOf(find(root, "rewind-shared")), /Everyone here sees that you went back/);
});

test("the folded row: one line, openable to each message, Undo only for the person who went back", async () => {
  installDom();
  const lines = [
    { id: "a", who: "You", text: "Now add a dark theme", time: "11:50" },
    { id: "b", who: "Dex", text: "Done", time: "11:51" },
  ];
  let undone = 0;
  const row = withFolded([], [{ afterSeq: 1, uptoSeq: 3, who: "Maya", mine: true, undo: () => undone++, lines }])[0]!;
  assert.equal(row.kind, "folded");
  assert.equal(foldedWords({ lines, who: "Maya", mine: true }), "You went back. 2 messages folded away");
  assert.equal(foldedWords({ lines, who: "Maya", mine: false }), "Maya went back. 2 messages folded away");
  const root = await mount(createRoot, <FoldedRow row={row as never} />);
  assert.equal(find(root, `folded-${row.key}-items`), null, "closed: the messages are folded");
  await press(find(root, `folded-${row.key}-toggle`)!);
  assert.match(textOf(find(root, `folded-${row.key}-items`)!), /Now add a dark theme[\s\S]*Done/, "still readable");
  await press(find(root, `folded-${row.key}-undo`)!);
  assert.equal(undone, 1);
  const theirs = withFolded([], [{ afterSeq: 1, uptoSeq: 3, who: "Maya", mine: false, lines }])[0]!;
  const root2 = await mount(createRoot, <FoldedRow row={theirs as never} />);
  assert.equal(find(root2, `folded-${theirs.key}-undo`), null, "a second member cannot undo another's rewind");
});
