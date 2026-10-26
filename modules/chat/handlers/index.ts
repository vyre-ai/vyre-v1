// Handler table of the chat module. P-L2_10 holds the first eight of its 62 capabilities; chat.post now runs behind the sealed-thread guard of private chats (P-L2_11). The module stays `stub`
// in host/modules.json until the last chat packet adds the rest and the generated contract tests pass against the real handlers (ARCH 12.4).
import { askSuggest, asksOf, openAsChat } from "./ask.ts";
import { post } from "./post.ts";
import { guardPrivate } from "./private.ts";
import { channelErase, threadErase, transcriptPurge } from "./purge.ts";
import { answerBlock, approvePlan, channelsCreate, connectOutsideAgent, makeChannel, start, thread } from "./thread.ts";

export const handlers = {
  "chat.post": guardPrivate(post),
  "chat.start": start,
  "chat.thread": thread,
  "chat.answer_block": answerBlock,
  "chat.approve_plan": approvePlan,
  "threads.make_channel": makeChannel,
  "channels.create": channelsCreate,
  "channels.connect_outside_agent": connectOutsideAgent,
  "threads.erase": threadErase,
  "channels.erase": channelErase,
  "chat.transcript.purge": transcriptPurge,
};

/**
 * The Ask pane capabilities of P-L2_11, complete and tested, kept out of `handlers` until P-L2_LIVE builds the full table: P-L2_10's post.contract.test.ts pins the table to its own eight names.
 * P-L2_LIVE spreads this object into `handlers` (and relaxes that one assertion to "every key is a frozen chat capability").
 */
export const askHandlers = {
  "chat.ask_suggest": askSuggest,
  "chat.asks_of": asksOf,
  "chat.open_as_chat": openAsChat,
};
