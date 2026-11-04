// The row menus of Chats, one file per kind (agent.ts, person.ts, chat.ts, channel.ts) and what they share (shared.ts). This file is the one door the sidebar and the tests import.
export { KEY, keyLabel, shortcutFor, tidy } from "./shared.ts";
export * from "./agent.ts";
export * from "./person.ts";
export * from "./chat.ts";
export * from "./channel.ts";
