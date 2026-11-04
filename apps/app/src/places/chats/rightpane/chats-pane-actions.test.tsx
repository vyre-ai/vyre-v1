// What each header action does, for an agent and in the shell's wiring: Poke asks the agent to answer now, Share opens the share sheet over the agent, Message opens the chat. A button is drawn only where the shell can do it.
// An agent opened from any face is the full agent pane (About, Computer, Chats, Files, Terminal), not a short body.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatRightPane, agentActions } from "./ChatRightPane.tsx";
import { ProfilePane, profileTab } from "./ProfilePane.tsx";
import { createSample } from "./sample.ts";

const ALL = { start: 0, end: 500 };
const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const has = (s: string, n: string): boolean => s.includes(n);

test("Message opens the chat; Poke and Share each call the shell with this agent, and exist only when the shell gives them", () => {
  const log: string[] = [];
  const base = { openThread: (id: string, how: string) => log.push(`open ${id} ${how}`) };
  const bare = agentActions(base, "thr_1", "agt_dex", "Dex");
  assert.deepEqual(bare.map((a) => a.key), ["message"]);
  bare[0]!.onPress();
  const full = agentActions({ ...base, poke: (a, t) => log.push(`poke ${a} ${t}`), share: (a) => log.push(`share ${a}`) }, "thr_1", "agt_dex", "Dex");
  assert.deepEqual(full.map((a) => a.key), ["message", "poke", "share"]);
  full[1]!.onPress(); full[2]!.onPress();
  assert.deepEqual(log, ["open thr_1 here", "poke agt_dex thr_1", "share agt_dex"]);
});

test("an agent opened from a face is the full pane in the tab: About first, then Computer, Chats, Files and Terminal", () => {
  const s = createSample();
  const tab = profileTab("agt_intake", "Intake", "agent");
  const props = { tab, name: "Intake", call: s.data.call, onMessage: () => undefined, onMention: () => undefined, onEdit: () => undefined };
  const full = clean(renderToStaticMarkup(<ProfilePane {...props} agentPane={s.data} />));
  assert.ok(has(full, 'data-testid="chats-right-pane"') && has(full, 'data-testid="about-tab"'), "the whole pane");
  for (const t of [">About<", ">Computer<", ">Chats<", ">Files<"]) assert.ok(has(full, t), t);
  assert.ok(!has(full, 'data-testid="chats-right-pane-frame"') && !has(full, 'data-pane-toggle'), "no second pane frame inside the tab");
  const embedded = clean(renderToStaticMarkup(<ChatRightPane data={s.data} embedded open onToggle={() => undefined} window={ALL} />));
  assert.ok(!has(embedded, "side-pane"), "embedded draws only the body");
});
