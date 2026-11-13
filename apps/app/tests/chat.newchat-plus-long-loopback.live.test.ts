// @tsx
// The owner's own way, on one link (loopback): "+" in the tab strip, type a long message, Enter. Enter starts a chat in the same tab (owner, 13 Nov 2026). See definePlus in chat.newchat-kit.test.ts.
import test from "node:test";
import { definePlus } from "./chat.newchat-kit.test.ts";

test(...definePlus("long", "loopback"));
