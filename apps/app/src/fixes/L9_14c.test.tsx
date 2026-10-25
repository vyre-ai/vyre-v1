// P-L9_14c: the Chats place composes the sidebar, the open chat and the agent pane (the three pieces of the chats packets, no copies). The pane toggle belongs to the place and drives the
// chat header's button too. Under 640 px the sidebar is the screen.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatsPlace, SIDEBAR_W, WIDE } from "../places/chats/ChatsPlace.tsx";
import { createSample as createConversationSample } from "../places/chats/conversation/sample.ts";
import { createSample as createPaneSample } from "../places/chats/rightpane/sample.ts";
import { createSampleSidebar, northwind } from "../places/chats/sidebar/sample.ts";

const ALL = { start: 0, end: 500 };
const place = (open = true): string =>
  renderToStaticMarkup(
    <ChatsPlace sidebar={createSampleSidebar(northwind).data} conversation={createConversationSample("idle").data} pane={createPaneSample("northwind").data} paneOpen={open} window={ALL} />,
  ).replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
const has = (s: string, needle: string): boolean => s.includes(needle);

test("the sidebar, the open chat and the agent pane sit side by side, in that order", () => {
  const out = place();
  const at = (n: string): number => { const i = out.indexOf(n); assert.ok(i >= 0, n); return i; };
  assert.ok(at('data-testid="chats-place-sidebar"') < at('data-testid="chats-place-chat"') && at('data-testid="chats-place-chat"') < at('data-testid="chats-right-pane"'));
  assert.equal(SIDEBAR_W, 272);
  assert.equal(WIDE, 640);
});

test("the sidebar has Needs you, Agents, Channels and Chats in the prototype's order", () => {
  const out = place();
  const ids = ["head-needs", "head-faces", "head-channels", "head-recent"].map((id) => out.indexOf(`data-testid="${id}"`));
  assert.ok(ids.every((i) => i >= 0));
  assert.deepEqual([...ids].sort((a, b) => a - b), ids);
  assert.ok(has(out, "Send 12 invoices") && has(out, "Waiting on you"));
});

test("the open chat is Rivera intake with its composer, and the pane follows its agent on shared tabs", () => {
  const out = place();
  assert.ok(has(out, "Rivera intake") && has(out, 'data-testid="chats-right-pane"'));
  for (const tab of [">Computer<", ">Threads<", ">Files<"]) assert.ok(has(out, tab), tab);
});

test("there is no Comment or Notes control: those are the prototype's review tools", () => {
  const out = place();
  assert.ok(!has(out, ">Comment<") && !has(out, ">Notes<"));
});
