// @tsx
// "+" in the tab strip, a question, the Ask by its chord (Alt+Enter), then "Continue in a chat": what the page shows from there on, in order, with pictures (see chat.newchat-kit.test.ts). One case per file: a case takes 40 to 60 s and a file's watchdog is 120 s.
import { definePathProbe } from "./chat.newchat-kit.test.ts";

definePathProbe("tabplus-ask", "probe-loopback");
