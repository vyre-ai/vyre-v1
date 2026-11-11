// A layer a link opened (the terminal list from the Space menu or Search) is a one-time door. Once it is up, the tab's address goes back to the page under it, so a reload or a switch back to the tab
// does not open it again (the Personal first-hour walk: the Terminals list came back on the next page load and its veil covered the page).
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { installDom, find, flush, press } from "../../../ui/src/testing/dom.ts";
import { createMountSample } from "../src/places/chats/mounts/sample.ts";
import { ChatsMounted } from "../src/places/chats/mounts/ChatsMounted.tsx";

type Opened = { subject?: { type: string; id: string }; screen?: string; args?: Record<string, unknown> };

test("a link that opens the terminal list while Chats is open is consumed: the tab's address returns to the page under it, and closing the list changes nothing", async () => {
  const restoreDom = installDom();
  try {
    const s = createMountSample();
    const reported: Opened[] = [];
    const opened = (t: Opened): void => void reported.push(t);
    const window = { start: 0, end: 500 };
    const r = createRoot();
    await act(async () => { r.render(<ChatsMounted rt={s.rt} hash="" opened={opened} window={window} />); });
    await flush();
    const root = r.container as unknown as Parameters<typeof find>[0];
    reported.length = 0;
    await act(async () => { r.render(<ChatsMounted rt={s.rt} hash="screen=chats.terminal-list&at=1" opened={opened} window={window} />); });
    await flush();
    assert.ok(find(root, "terminal-list") && find(root, "terminal-list-veil"), "the link opened the list");
    assert.deepEqual(reported, [{}], "the tab was told to go back to the page under it, with no layer in its address");
    await press(find(root, "terminal-list-veil"));
    await flush();
    assert.equal(find(root, "terminal-list"), null, "a press on the veil closed it");
    assert.ok(reported.every((t) => Object.keys(t).length === 0), "and the tab still names only the page");
  } finally { restoreDom(); }
});
