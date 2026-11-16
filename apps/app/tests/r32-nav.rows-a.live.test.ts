// @tsx
// Lane r32-nav, item 1 (desktop, 1440, dark), first half: the rows of Chats, Files, Records and Automations have Open in New Tab in their right-click menu, by mouse and by keyboard (Shift+F10, the Menu key).
import test from "node:test";
import { rowMenuWalk } from "./r32-nav-rows-kit.test.ts";

test("rows (Chats, Files, Records, Automations): Open in New Tab, by mouse and by keyboard", async (t) => {
  await rowMenuWalk(t, ["chats", "files", "records", "automations"], "rows-a-dark-1440");
});
