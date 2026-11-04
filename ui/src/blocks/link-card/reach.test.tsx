// A link card draws right on its first frame (owner, 4 Nov): the Space attaches the reader's level when it serves the message, so a card for a thing the reader cannot open is never a link and never
// shows the thing's name, only what kind of thing it is and a way to ask. A card that came with a level never flips after it draws.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../testing/dom.ts";
import { LinkCard } from "./LinkCard.tsx";
import { linkCardOf } from "./model.ts";
import { hiddenTitle } from "./state.ts";

const base = { icon: "task", lead: "Task created", title: "Settlement offer for the Rivera estate", target: { type: "task", id: "tsk_1" } };

test("the level the Space attached is read, and only the five known levels", () => {
  assert.equal(linkCardOf({ type: "link_card", data: { ...base, reach: "none" } })!.reach, "none");
  assert.equal(linkCardOf({ type: "link_card", data: { ...base, reach: "manage" } })!.reach, "manage");
  assert.equal(linkCardOf({ type: "link_card", data: { ...base, reach: "root" } })!.reach, undefined);
  assert.equal(linkCardOf({ type: "link_card", data: base })!.reach, undefined);
});

test("what stands in for the name says the kind of thing and nothing else", () => {
  assert.equal(hiddenTitle("task"), "A task you do not have access to");
  assert.equal(hiddenTitle("file"), "A file you do not have access to");
  assert.equal(hiddenTitle("chat"), "A chat you do not have access to");
  assert.equal(hiddenTitle("fact"), "Not shared with you");
});

test("a card for a thing the reader cannot open shows no name, is not a link, and offers one way to ask", async () => {
  const restore = installDom();
  try {
    let asks = 0;
    const root = await mount(createRoot, <LinkCard id="c1" data={base} nameOf={(x) => x} hidden onOpen={() => { throw new Error("opened"); }} onAskAccess={() => { asks++; }} />);
    await flush();
    const text = textOf(root as never);
    assert.ok(!text.includes("Settlement offer"), "the thing's name is never shown");
    assert.ok(text.includes("A task you do not have access to"));
    const open = find(root, "link-card-c1-open")!;
    assert.notEqual(open.props.role, "link", "plain text, not a link");
    await press(find(root, "link-card-c1-ask"));
    assert.equal(asks, 1);
  } finally { restore(); }
});

test("a card the reader can open is a link with no Ask for access", async () => {
  const restore = installDom();
  try {
    let opened = 0;
    const root = await mount(createRoot, <LinkCard id="c2" data={base} nameOf={(x) => x} onOpen={() => { opened++; }} onAskAccess={() => undefined} />);
    await flush();
    assert.equal(find(root, "link-card-c2-ask"), null);
    await press(find(root, "link-card-c2-open"));
    assert.equal(opened, 1);
    assert.ok(textOf(root as never).includes("Settlement offer"));
  } finally { restore(); }
});
