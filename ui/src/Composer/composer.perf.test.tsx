// The speed half of composer.test.tsx (split out so only this file is a perf file, ruling 46); its functional tests stay in the original file and run on every PR.
// ui/Composer: the who-answers line follows lib/route.ts, symbols open grouped pickers, send is optimistic and inside the send budget.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { route } from "../../../lib/route.ts";
import type { RouteMessage, RouteThread } from "../../../lib/route.ts";
import { menuEntries } from "../Menu/index.tsx";
import { isItem, isReportItem, isSeparator } from "../Menu/props.ts";
import {
  Composer,
  answerLine,
  applyPick,
  canSend,
  composerMenu,
  detectTrigger,
  enterAction,
  initialState,
  isPopupItem,
  linksIn,
  plainText,
  popupFor,
  popupMove,
  quality,
  prepare,
  sendNow,
  whoAnswers,
} from "./index.tsx";
import type { ComposerLists, PopupItem, WhoContext } from "./index.tsx";

const lists: ComposerLists = {
  agents: ["Intake", "Docs", "Billing"],
  people: ["Sam Patel", "Maya Chen", "Omar Haddad"],
  folders: ["Projects/Rivera matter", "Agents/Intake/work", "Marketing"],
  channels: ["general", "intake", "rivera-engagement"],
  records: [{ t: "Rivera Holdings", s: "Client", sealed: 2 }, "Pruitt & Co."],
  files: ["referral-letter.pdf", "intake-form.docx"],
  commands: [{ t: "later", s: "Follow up later" }, { t: "memory", s: "Open memory" }, { t: "fork", s: "Fork this chat" }],
  templates: [{ t: "Welcome note", body: "Welcome to the firm. " }],
  snippets: [{ t: "Office hours", body: "We are open 9 to 5, Monday to Friday. " }],
};

// The same table as lib/tests/route.test.ts: the thread has Intake leading, Docs and Billing listening.
const ctx: WhoContext = { lead: "Intake", listening: ["Docs", "Billing"], agents: ["Intake", "Docs", "Billing"], people: ["Sam Patel", "Maya Chen", "Omar Haddad"] };
const thread: RouteThread = { agents: [{ id: "Intake", mode: "lead" }, { id: "Docs", mode: "listen" }, { id: "Billing", mode: "listen" }] };
const person = (id: string) => ({ kind: "person" as const, id });
const agent = (id: string) => ({ kind: "agent" as const, id });

test("send shows within 16 ms: the message and the cleared field are ready before any server answer", () => {
  const state = { ...initialState("Please summarise today's new leads and tag the urgent ones @Intake [[Rivera Holdings]]"), chips: [{ kind: "Record", name: "Rivera Holdings" }], folder: "Marketing" };
  const runs: number[] = [];
  let shown = "";
  for (let i = 0; i < 400; i++) {
    const t0 = performance.now();
    const line = answerLine(state.text, "Intake will reply", ctx).line;
    const sent = sendNow(state, line);
    if (sent) shown = sent.payload.text + "|" + sent.next.text;
    runs.push(performance.now() - t0);
  }
  assert.match(shown, /Please summarise.*\|$/);
  const sorted = runs.slice().sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  console.log("METRIC " + JSON.stringify({ name: "send", metric: "msg.send_visible", p50, p95, budget_p50: 16, budget_p95: 16, unit: "ms", machine: "ci", pass: p95 < 16 }));
  assert.ok(p95 < 16, `p95 ${p95} ms is inside the 16 ms send budget`);
});
