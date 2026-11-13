// @tsx
// One of the three ways to start a chat, as the owner does, on one link: what the page shows from Enter on, in order, with pictures (see chat.newchat-kit.test.ts). tabplus is "+" in the tab strip (a new tab), sidebar is "+ New chat" in the
// Chats sidebar, first is the first screen's composer, each with an agent chat open first. One case per file because a case takes 40 to 60 s and a file's watchdog is 120 s.
import { definePathProbe } from "./chat.newchat-kit.test.ts";

definePathProbe("first", "probe-loopback");
