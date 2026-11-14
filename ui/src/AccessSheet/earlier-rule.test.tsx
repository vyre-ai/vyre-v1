// The add sheet never offers "Include earlier messages" and then ignores it: the server lets only the chat's owner widen someone who is already in, and gives a new member what the adder can read.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, installDom, mount, press, textOf } from "../testing/dom.ts";
import { AccessSheet, frozenAddSheetProps } from "./index.tsx";
import type { AddSheetProps } from "./index.tsx";

const add = (over: Partial<AddSheetProps> = {}): AddSheetProps => ({ ...frozenAddSheetProps, ...over });
async function withDom(run: () => Promise<void>): Promise<void> {
  const restore = installDom();
  try {
    await run();
  } finally {
    restore();
  }
}

test("Include earlier messages is never offered and then ignored: a member who is not the chat's owner does not see it for someone already in, and where it shows it says what it gives", async () => {
  await withDom(async () => {
    const rule = { owner: false, members: ["usr_sara"] };
    const root = await mount(createRoot, <AccessSheet {...add({ earlierRule: rule })} />);
    await press(find(root, "as-row-person:usr_sara"));
    assert.equal(find(root, "as-earlier"), null, "Sara is already in: only the owner widens her");
    await press(find(root, "as-row-person:usr_omar"));
    assert.ok(find(root, "as-earlier"), "Omar is new: the adder can give what the adder reads");
    assert.match(textOf(find(root, "as-earlier")), /earlier messages you can read/);
    const owner = await mount(
      createRoot,
      <AccessSheet {...add({ earlierRule: { owner: true, members: ["usr_sara"] } })} />,
    );
    await press(find(owner, "as-row-person:usr_sara"));
    assert.ok(find(owner, "as-earlier"), "the owner may widen someone who is in");
    assert.doesNotMatch(textOf(find(owner, "as-earlier")), /you can read/);
  });
});
