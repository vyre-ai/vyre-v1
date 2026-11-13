// K7 guard (13 Nov 2026): the / menu is about 44 characters wide for a description. A description longer than that is cut with dots and the person cannot read the rest,
// so every command says what it does in 42 characters or fewer.
import test from "node:test";
import assert from "node:assert/strict";
import { CHAT_COMMANDS } from "./chat-commands.ts";

test("every slash command's description fits the menu without being cut", () => {
  for (const c of CHAT_COMMANDS) assert.ok(c.detail.length <= 42, `/${c.id}: "${c.detail}" is ${c.detail.length} characters, 42 at most`);
});
