// Inbox on a phone (390 wide): one tap on a contact opens its conversation (a phone has no double tap), and the dialer row has no keyboard shortcut. A click path, not markup.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { Dimensions } from "react-native";
import { installDom, mount, press, find, textOf } from "../../../onboarding/test-dom.ts";
import { ContactList } from "../contactlist/index.ts";
import { createSampleInbox } from "../contactlist/sample.ts";
import { InboxDataProvider, InboxSidebar, InboxStateProvider } from "../sidebar/index.ts";

const widen = (width: number): void => Dimensions.set({ window: { width, height: 844, scale: 1, fontScale: 1 } });

test("on a narrow window one tap on a contact opens it; on a wide one the first tap only selects", async () => {
  installDom();
  for (const [width, opens] of [[390, ["elena"]], [1280, []]] as const) {
    widen(width);
    const s = createSampleInbox();
    const picked: string[] = [];
    const data = { ...s.data, nav: { ...s.data.nav, openConversation: (id: string) => void picked.push(id) } };
    const root = await mount(createRoot, <InboxDataProvider value={data}><InboxStateProvider><ContactList /></InboxStateProvider></InboxDataProvider>);
    await press(find(root, "row-line:elena"));
    assert.deepEqual(picked, opens, `${width} wide`);
  }
});

test("the dialer row shows its keyboard shortcut on a wide window and not on a phone", async () => {
  installDom();
  for (const [width, shows] of [[390, false], [1280, true]] as const) {
    widen(width);
    const root = await mount(createRoot, <InboxDataProvider value={createSampleInbox().data}><InboxStateProvider><InboxSidebar /></InboxStateProvider></InboxDataProvider>);
    assert.equal(textOf(find(root, "inbox-dialer")).includes("⌘⇧K"), shows, `${width} wide`);
  }
});
