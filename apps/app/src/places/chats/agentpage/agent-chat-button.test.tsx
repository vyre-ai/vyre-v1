// The agent page's Chat button acknowledges the press at once: it opens the new-chat screen with this agent picked and makes no chat (and so leaves none behind if he closes it); the chat is made when he sends.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { AgentPage } from "./AgentPage.tsx";
import { createSample } from "./sample.ts";

test("Chat opens the new-chat screen with the agent in the same press and calls nothing on the server", async () => {
  const off = installDom();
  let unmount: () => Promise<void> = async () => undefined;
  try {
    const s = createSample("owner");
    const started: { agentId: string; name: string }[] = [];
    const calls: string[] = [];
    const data = { ...s.data, call: ((cap: string, input: unknown) => { calls.push(cap); return s.data.call(cap as never, input as never); }) as typeof s.data.call, nav: { ...s.data.nav, startChat: (agentId: string, name: string) => void started.push({ agentId, name }), openChat: () => { throw new Error("no chat is opened before one exists"); } } };
    const r = createRoot();
    unmount = () => act(async () => { r.unmount(); });
    await act(async () => { r.render(<AgentPage data={data} tab="chats" window={{ start: 0, end: 500 }} />); });
    await flush();
    const before = calls.filter((c) => c === "chat.start").length;
    await press(find(r.container as unknown as Node, "chat-button"));
    assert.deepEqual(started, [{ agentId: s.data.agent.agentId, name: "Intake" }]);
    assert.equal(calls.filter((c) => c === "chat.start").length, before, "no chat is made by the press");
  } finally { await unmount(); off(); }
});
