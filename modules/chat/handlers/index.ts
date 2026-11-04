// Handler table of the chat module: all 65 capabilities. P-L2_10 wrote the first eight (post, start, thread, blocks, plans, channels); chat.post runs behind the sealed-thread guard of private chats
// (P-L2_11, with the three Ask capabilities). P-L2_24a to d wrote the other 51: threads (g24a), channels (g24b), messages and pins (g24c), transcript, plans and helpers (g24d).
import { archiveHandlers } from "./archive.ts";
import { messagePerson, mute as agentDmMute, peopleStatus } from "./agent-dm.ts";
import { catchUp } from "./catch-up.ts";
import { replyDetails } from "./reply-details.ts";
import { aside, asideKeep } from "./aside.ts";
import { share } from "./share.ts";
import { makeTask } from "./make-task.ts";
import { flowCard } from "./flow-card.ts";
import { remember } from "./remember.ts";
import { askLevel, askSuggest, asksOf, openAsChat } from "./ask.ts";
import { g24aHandlers } from "./g24a.ts";
import { g24bHandlers } from "./g24b.ts";
import { g24cHandlers } from "./g24c.ts";
import { g24dHandlers } from "./g24d.ts";
import { noteOfferHandlers } from "./note-offer.ts";
import { hookLineHandlers } from "./hook-line.ts";
import { titleMake } from "./title.ts";
import { g26Handlers } from "./g26.ts";
import { historySearch } from "./history.ts";
import { g27Handlers } from "./g27.ts";
import { followHandlers } from "./follow.ts";
import { modesHandlers } from "./modes.ts";
import { addsheetHandlers } from "./addsheet.ts";
import { post } from "./post.ts";
import { screenHandlers } from "./screen.ts";
import { guardPrivate } from "./private.ts";
import { channelErase, threadErase, transcriptPurge } from "./purge.ts";
import { answerBlock, approvePlan, channelsCreate, makeChannel, start, thread } from "./thread.ts";
import { channelsHome, channelsHomeJoin } from "./home-channel.ts";

/** The Ask pane capabilities of P-L2_11. */
export const askHandlers = {
  "chat.ask_level": askLevel,
  "chat.ask_suggest": askSuggest,
  "chat.asks_of": asksOf,
  "chat.open_as_chat": openAsChat,
};

export const handlers = {
  "chat.post": guardPrivate(post),
  "chat.start": start,
  "chat.make_task": makeTask,
  "chat.reply_details": replyDetails,
  "chat.share": share,
  "chat.aside": aside,
  "chat.aside_keep": asideKeep,
  "chat.flow_card": flowCard,
  "chat.catch_up": catchUp,
  "chat.remember": remember,
  "chat.thread": thread,
  "chat.answer_block": answerBlock,
  "chat.approve_plan": approvePlan,
  "threads.make_channel": makeChannel,
  "channels.create": channelsCreate,
  "channels.home": channelsHome,
  "channels.home_join": channelsHomeJoin,
  "threads.erase": threadErase,
  "channels.erase": channelErase,
  "chat.transcript.purge": transcriptPurge,
  "chat.history.search": historySearch,
  // an agent reaches a teammate for its person (lane l-agentdm)
  "chat.people_status": peopleStatus,
  "chat.message_person": messagePerson,
  "chat.agent_dm.mute": agentDmMute,
  ...askHandlers,
  ...archiveHandlers,
  ...screenHandlers,
  ...g24aHandlers,
  ...modesHandlers,
  ...addsheetHandlers,
  ...g24bHandlers,
  ...g24cHandlers,
  ...g24dHandlers,
  "chat.title_make": titleMake,
  ...noteOfferHandlers,
  ...hookLineHandlers,
  // P-L2_26 replaces the group entries that had reported limits
  ...g26Handlers,
  ...g27Handlers,
  ...followHandlers,
};

