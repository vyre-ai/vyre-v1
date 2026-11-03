// Right pane > Knows: About you at the top, as this chat's audience allows. In a chat only you and your agents read, the public and private parts; where other people read it, the public part only,
// with a line saying why. The lines are the same answer the agent's context loads (memory.profile.get for this chat).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatRightPane } from "../rightpane/ChatRightPane.tsx";
import { ABOUT_PRIVATE, ABOUT_SHARED } from "./KnowsTab.tsx";
import { ASSISTANT, MESSAGE_IDS, createChatMemorySample } from "./sample.ts";

const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
async function knows(audience: "private" | "shared"): Promise<string> {
  const s = createChatMemorySample({ audience });
  await s.warm([
    ["memory.profile.get", { threadId: "c1" }], ["memory.knows", { threadId: "c1", agentId: ASSISTANT }], ["memory.facts.list", { status: ["proposed"], layer: "agent", agentId: ASSISTANT }],
    ["memory.map.get", { agentId: ASSISTANT }], ["memory.used", { threadId: "c1", messageId: MESSAGE_IDS.reply }], ["memory.used", { threadId: "c1", messageId: MESSAGE_IDS.held }],
  ]);
  return clean(renderToStaticMarkup(<ChatRightPane data={s.pane} open onToggle={() => undefined} tab="memory" paneWidth={340} window={{ start: 0, end: 500 }} />));
}

test("a chat only you and your agents read: About you comes first, public and private", async () => {
  const out = await knows("private");
  assert.ok(out.includes('data-testid="knows-about"'), out.slice(0, 400));
  assert.ok(out.indexOf("About you") < out.indexOf("What Assistant knows here"), "at the top");
  assert.ok(out.includes("Public and private") && out.includes(ABOUT_PRIVATE));
  assert.ok(out.includes("Prefers short client emails") && out.includes("Picks up the kids"));
  assert.ok(out.includes("Private, suggested for public"));
  assert.ok(out.includes("Edit in Memory and privacy"));
});

test("a chat other people read: About you holds the public part only, and says why", async () => {
  const out = await knows("shared");
  assert.ok(out.includes("Public only") && out.includes(ABOUT_SHARED));
  assert.ok(out.includes("Prefers short client emails"));
  assert.ok(!out.includes("Picks up the kids") && !out.includes("every second Friday"));
  assert.doesNotMatch(out, /—/, "no em dashes");
});
