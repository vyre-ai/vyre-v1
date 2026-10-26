// Handler table of the chat module. P-L2_10 holds the first eight of its 62 capabilities; the module stays `stub` in host/modules.json until the last chat packet adds the rest and the
// generated contract tests pass against the real handlers (ARCH 12.4).
import { post } from "./post.ts";
import { channelErase, threadErase, transcriptPurge } from "./purge.ts";
import { answerBlock, approvePlan, channelsCreate, connectOutsideAgent, makeChannel, start, thread } from "./thread.ts";

export const handlers = {
  "chat.post": post,
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
