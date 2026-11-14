// @tsx
// A link to a chat of this Space pasted into a new tab: Enter opens that chat in the same tab and starts no chat. See definePlusLink in chat.newchat-kit.test.ts.
import test from "node:test";
import { definePlusLink } from "./chat.newchat-kit.test.ts";

test(...definePlusLink());
