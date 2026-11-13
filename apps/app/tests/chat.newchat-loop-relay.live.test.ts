// @tsx
// The owner's path in a loop on one link (relay): "+" in the tab strip, a question, Enter, the Ask's answer, "Continue in a chat", the tab moving onto the real chat, "+" again. A sweep saw the whole-app crash page (React error 185) twice after
// this sequence; this walk fails on a crash page, a console crash, or an Ask that is not answered and continued. See defineLoop in chat.newchat-kit.test.ts (rounds: VYRE_NEWCHAT_ROUNDS).
import test from "node:test";
import { defineLoop } from "./chat.newchat-kit.test.ts";

test(...defineLoop("relay"));
