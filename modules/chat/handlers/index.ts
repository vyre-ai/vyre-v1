// Handler table of the chat module: all 62 capabilities. P-L2_10 wrote the first eight (post, start, thread, blocks, plans, channels); chat.post runs behind the sealed-thread guard of private chats
// (P-L2_11, with the three Ask capabilities). P-L2_24a to d wrote the other 51: threads (g24a), channels (g24b), messages and pins (g24c), transcript, plans and helpers (g24d).
import { askSuggest, asksOf, openAsChat } from "./ask.ts";
import { g24aHandlers } from "./g24a.ts";
import { g24bHandlers } from "./g24b.ts";
import { g24cHandlers } from "./g24c.ts";
import { g24dHandlers } from "./g24d.ts";
import { post } from "./post.ts";
import { guardPrivate } from "./private.ts";
import { answerBlock, approvePlan, channelsCreate, connectOutsideAgent, makeChannel, start, thread } from "./thread.ts";

/** The Ask pane capabilities of P-L2_11. */
export const askHandlers = {
  "chat.ask_suggest": askSuggest,
  "chat.asks_of": asksOf,
  "chat.open_as_chat": openAsChat,
};

export const handlers = {
  "chat.post": guardPrivate(post),
  "chat.start": start,
  "chat.thread": thread,
  "chat.answer_block": answerBlock,
  "chat.approve_plan": approvePlan,
  "threads.make_channel": makeChannel,
  "channels.create": channelsCreate,
  "channels.connect_outside_agent": connectOutsideAgent,
  ...askHandlers,
  ...g24aHandlers,
  ...g24bHandlers,
  ...g24cHandlers,
  ...g24dHandlers,
};

