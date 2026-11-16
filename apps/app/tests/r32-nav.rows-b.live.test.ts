// @tsx
// Lane r32-nav, item 1 (desktop, 1440, dark), second half: the rows of the Console, Settings, the Vault and the Inbox have Open in New Tab in their right-click menu, by mouse and by keyboard (Shift+F10, the Menu key).
import test from "node:test";
import { rowMenuWalk } from "./r32-nav-rows-kit.test.ts";

test("rows (Console, Settings, Vault, Inbox): Open in New Tab, by mouse and by keyboard", async (t) => {
  await rowMenuWalk(t, ["console", "settings", "vault", "inbox"], "rows-b-dark-1440");
});
