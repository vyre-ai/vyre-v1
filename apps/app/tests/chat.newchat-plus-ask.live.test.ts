// @tsx
// The Ask stays a choice of its own in the new tab: Alt+Enter runs it and makes no chat. See definePlusAsk in chat.newchat-kit.test.ts.
import test from "node:test";
import { definePlusAsk } from "./chat.newchat-kit.test.ts";

test(...definePlusAsk());
