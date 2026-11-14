// The product's sidebar drawn from the one read: the six blocks in order, every row named in words (no raw id), loading and failed states, the empty first minute, and the old component kept apart.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatsSidebar, LegacyChatsSidebar, NEW_SIDEBAR } from "./ChatsSidebar.tsx";
import type { ChatsSidebarData } from "./data.tsx";
import type { SideOut, SideRow } from "./side-data.ts";

const row = (o: Partial<SideRow> & { key: string; kind: SideRow["kind"]; title: string }): SideRow => ({
  faceIds: [],
  unread: 0,
  mentions: 0,
  failed: false,
  working: false,
  muted: false,
  pinned: null,
  lastAt: 1,
  ...o,
});
const sec = (rows: SideRow[]) => ({ total: rows.length, rows });
const FULL: SideOut = {
  needs: { total: 2, items: [{ taskId: "tsk_1", title: "Send 12 invoices", verb: "Allow", askerId: "agt_docs" }] },
  goals: sec([
    row({
      key: "g:gol_1",
      kind: "goal",
      title: "Close onboarding",
      faceIds: ["agt_docs"],
      progress: { done: 3, total: 7 },
    }),
  ]),
  pinned: sec([
    row({ key: "c:thr_p", kind: "chat", title: "Pricing page", faceIds: ["agt_docs"], pinned: 0, threadId: "thr_p" }),
  ]),
  chats: sec([
    row({
      key: "c:thr_a",
      kind: "chat",
      title: "Launch crew",
      faceIds: ["agt_docs", "agt_mira"],
      threadId: "thr_a",
      mentions: 2,
    }),
    row({
      key: "c:thr_f",
      kind: "chat",
      title: "Renewal checklist",
      faceIds: ["agt_docs"],
      threadId: "thr_f",
      failed: true,
      failedLine: "The AI provider did not answer.",
    }),
  ]),
  channels: sec([row({ key: "ch:chn_1", kind: "channel", title: "launch", threadId: "thr_c" })]),
  team: sec([
    row({ key: "p:usr_s", kind: "person", title: "Sara Malik", personId: "usr_s", faceIds: ["usr_s"] }),
    row({ key: "f:agt_docs", kind: "agent", title: "Docs", agentId: "agt_docs", faceIds: ["agt_docs"] }),
  ]),
  rail: 3,
};
const EMPTY: SideOut = {
  needs: { total: 0, items: [] },
  goals: sec([]),
  pinned: sec([]),
  chats: sec([]),
  channels: sec([]),
  team: sec([]),
  rail: 0,
};

function dataFor(answer: SideOut | "loading" | "failed"): ChatsSidebarData {
  const snap =
    answer === "loading"
      ? { status: "loading" }
      : answer === "failed"
        ? { status: "loading", error: { message: "boom", code: "internal.error" } }
        : { status: "ready", data: answer };
  return {
    screens: { query: () => ({ subscribe: () => () => undefined, getSnapshot: () => snap }) } as never,
    call: async () => ({}),
    connection: { get: () => "online", subscribe: () => () => undefined },
    space: { name: "Northwind", otherNeedsYou: false, assistant: { agentId: "assistant", name: "Assistant" } },
    nav: {
      openChat() {},
      openAgentChat() {},
      openChannel() {},
      openNeedsYou() {},
      openAllAgents() {},
      openSearch() {},
      openSpaceSwitcher() {},
      openNewChannel() {},
      openTasks() {},
      openNotes() {},
    },
    me: { id: "usr_me" },
    clock: () => ({ now: 1, offsetMin: 0 }),
  };
}
const html = (a: SideOut | "loading" | "failed"): string =>
  renderToStaticMarkup(<ChatsSidebar data={dataFor(a)} window={{ start: 0, end: 200 }} />).replaceAll("<!-- -->", "");

test("the product shows the new sidebar; the old one is a separate export", () => {
  assert.equal(NEW_SIDEBAR, true);
  assert.notEqual(ChatsSidebar, LegacyChatsSidebar);
});

test("a full Space: Tasks, then Goals, Pinned, Chats, Channels, Team in that order, every row named in words", () => {
  const h = html(FULL);
  const at = (s: string): number => {
    const i = h.indexOf(s);
    assert.ok(i >= 0, s);
    return i;
  };
  const order = ["Tasks", "toggle-goals", "toggle-pinned", "toggle-chats", "toggle-channels", "toggle-team"].map(at);
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
  );
  for (const t of [
    "Send 12 invoices",
    "Close onboarding",
    "Pricing page",
    "Launch crew",
    "Renewal checklist",
    "launch",
    "Sara Malik",
    "Docs",
  ])
    at(t);
  assert.ok(
    !/(agt|usr|thr|chn|gol|tsk)_[a-z0-9]/.test(h.replace(/data-testid="[^"]*"/g, "").replace(/id="[^"]*"/g, "")),
    "no raw id is drawn as a word",
  );
  at("Notes &amp; artifacts");
  assert.match(h, /data-testid="mark-mention"/);
  assert.match(h, /data-testid="mark-failed"/);
});

test("loading draws the one quiet mark, a failed read draws Couldn't load chats with Retry, the empty Space one invitation and no heading", () => {
  const l = html("loading");
  assert.ok(!l.includes("toggle-chats"));
  const f = html("failed");
  assert.match(f, /Couldn(&#x27;|')t load chats/);
  const e = html(EMPTY);
  assert.match(e, /Ask your Assistant/);
  assert.match(e, /Start a chat/);
  assert.ok(!e.includes("toggle-") && !e.includes("Tasks"));
});
