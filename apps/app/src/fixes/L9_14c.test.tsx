// P-L9_14c: the Chats place composes the sidebar, the open chat and the agent pane (the three pieces of the chats packets, no copies). The pane toggle belongs to the place and drives the
// chat header's button too. Under 640 px the sidebar is the screen.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { ChatsPlace, SIDEBAR_W, WIDE } from "../places/chats/ChatsPlace.tsx";
import { ChatsSidebarSlot } from "../places/chats/sidebar/ChatsSidebar.tsx";
import { SidebarContent } from "../shell/sidebar/index.ts";
import type { SidebarSlotApi } from "../shell/sidebar/index.ts";
import { createSample as createConversationSample } from "../places/chats/conversation/sample.ts";
import { createSample as createPaneSample } from "../places/chats/rightpane/sample.ts";
import { createSampleSidebar, northwind } from "../places/chats/sidebar/sample.ts";
import { chatsPlace } from "../shell/spaces/sample-chats.tsx";
import type { PlaceContext } from "../shell/spaces/Shell.tsx";

const ALL = { start: 0, end: 500 };
const place = (open = true): string =>
  renderToStaticMarkup(
    <ChatsPlace sidebar={createSampleSidebar(northwind).data} conversation={createConversationSample("idle").data} pane={createPaneSample("northwind").data} paneOpen={open} window={ALL} />,
  ).replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
const has = (s: string, needle: string): boolean => s.includes(needle);
/** The sidebar the place registers in the shell's shared slot (P-L9b_22), drawn on the same sample data: the slot's content is portalled, so it is read from the element the place renders. */
const side = (): string => {
  const el = ChatsSidebarSlot({ data: createSampleSidebar(northwind).data, window: ALL }) as ReactElement<{ title: string; children: (q: string, slot: SidebarSlotApi) => ReactElement }>;
  assert.equal(el.type, SidebarContent);
  const slot: SidebarSlotApi = { query: "", collapsed: false, setCollapsed: () => undefined, hasSidebar: true, compact: false, openBody: () => undefined, back: () => undefined, view: "body", title: "Chats" };
  return renderToStaticMarkup(el.props.children("", slot)).replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
};

test("the sidebar, the open chat and the agent pane sit side by side, in that order", () => {
  const out = place();
  const at = (n: string): number => { const i = out.indexOf(n); assert.ok(i >= 0, n); return i; };
  assert.ok(at('data-testid="chats-place-chat"') < at('data-testid="chats-right-pane"'));
  assert.ok(!out.includes('data-testid="chats-place-sidebar"'), "the sidebar is the shell's slot (P-L9b_22), not a column in the place");
  assert.equal(SIDEBAR_W, 272);
  assert.equal(WIDE, 640);
});

test("the sidebar has Needs you, Agents, Channels and Chats in the prototype's order", () => {
  const out = side();
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

test("the sample shell shows the Chats place on Chats and the sample rows everywhere else", () => {
  const ctx = (place: string): PlaceContext => ({ spaceId: "nw", spaceName: "Northwind", kind: "team", place, hash: "", epoch: 0, kit: { id: "team", places: [], top: [], start: "chats" } } as unknown as PlaceContext);
  const chats = renderToStaticMarkup(chatsPlace(ctx("chats")) as never).replaceAll("<!-- -->", "");
  assert.ok(has(chats, 'data-testid="chats-place"') && has(side(), "Send 12 invoices"), "the place, and its sidebar in the shell's slot");
  // Any other place falls back to the sample place (rendered inside a hub in the shell); here only what it returns is looked at: not the Chats place.
  const other = chatsPlace(ctx("files")) as { type?: unknown };
  assert.notEqual(other.type, (chatsPlace(ctx("chats")) as { type?: unknown }).type, "the other places are not the Chats place");
});
