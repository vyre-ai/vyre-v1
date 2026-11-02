// Live bug (rc.14 team Space): a new private channel opened a pane that showed the loading mark for ever. The sidebar, the New channel sheet, Browse and a project's channel all open a
// channel by its channel id, which reached the thread reads as a thread id and was refused on every open; and the pane drew the mark while its reads had failed. Chats now turns a channel
// id into its main thread before anything reads, and a conversation whose reads fail says so with Retry.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { Conversation } from "../conversation/Conversation.tsx";
import { createSample } from "../conversation/sample.ts";
import { channelThread, isChannelId } from "./data.ts";
import { fromHash, step, START } from "./route.ts";

installComposerForTests(Composer);

test("a channel id is turned into its main thread, and a channel that cannot be read gives the reason instead of a thread", async () => {
  const asked: unknown[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    asked.push([cap, input]);
    if ((input as { channelId: string }).channelId === "chn_test01") return { channel: { channelId: "chn_test01", mainThreadId: "thr_test01" } };
    throw Object.assign(new Error("That channel does not exist."), { code: "validation.not_found", traceId: "tr_chn" });
  };
  assert.equal(isChannelId("chn_test01"), true);
  assert.equal(isChannelId("thr_test01"), false);
  assert.deepEqual(await channelThread(call, "chn_test01"), { threadId: "thr_test01" });
  assert.deepEqual(asked, [["channels.get", { channelId: "chn_test01" }]], "one read, and it is channels.get, never threads.get");
  assert.deepEqual(await channelThread(call, "chn_gone"), { failure: { message: "That channel does not exist.", code: "validation.not_found", traceId: "tr_chn" } });
  assert.deepEqual(await channelThread(async () => ({ channel: {} }), "chn_empty"), { failure: { message: "That channel has no conversation yet." } });
});

test("every way into a channel lands on the chat route with the channel id, which the place resolves before it reads", () => {
  // a sidebar row, the New channel sheet and Browse call nav.openChannel(channelId) -> go.chat; a project's channel and links arrive as subject channel:<id>
  const viaGo = step(START, { t: "chat", threadId: "chn_test01" });
  assert.deepEqual(viaGo.route, { view: "chat", threadId: "chn_test01" });
  assert.deepEqual(fromHash("subject=channel:chn_test01").route, { view: "chat", threadId: "chn_test01" });
});

test("a conversation whose reads fail shows Couldn't load this chat with Retry, not the loading mark", () => {
  const s = createSample("idle");
  const failing = { subscribe: () => () => undefined, getSnapshot: () => ({ status: "loading" as const, error: { message: "threadId: not a thread id", code: "validation.bad_input", traceId: "tr_bad" } }) };
  const data = { ...s.data, screens: { ...s.data.screens, query: () => failing } } as typeof s.data;
  const out = renderToStaticMarkup(<Conversation data={data} />).replaceAll("&#x27;", "'");
  assert.ok(out.includes('data-testid="conversation-failed"'), out.slice(0, 400));
  assert.ok(out.includes("Couldn't load this chat") && out.includes("not a thread id"));
  assert.ok(out.includes('data-testid="state-retry"'));
  assert.ok(!out.includes('data-testid="conversation-loading"'));
  // while the reads are only waiting, the quiet frame is drawn as before
  const waiting = { subscribe: () => () => undefined, getSnapshot: () => ({ status: "loading" as const }) };
  const quiet = renderToStaticMarkup(<Conversation data={{ ...s.data, screens: { ...s.data.screens, query: () => waiting } } as typeof s.data} />);
  assert.ok(quiet.includes('data-testid="conversation-loading"'));
});
