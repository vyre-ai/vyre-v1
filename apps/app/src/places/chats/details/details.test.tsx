// A reply's hover card, Details in its menu, and the Details tab, drawn from chat.reply_details (owner, 3 Nov 2026).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { menuFor } from "../conversation/MessageView.tsx";
import type { MessageActions } from "../conversation/MessageView.tsx";
import type { Message } from "../conversation/model.ts";
import { ReplyCard } from "./ReplyCard.tsx";
import type { ReplyDetailsActions } from "./ReplyCard.tsx";
import { ReplyDetailsPane } from "./ReplyDetailsPane.tsx";
import { forgetReplyDetails, readReplyDetails } from "./read.ts";
import type { ReplyDetails, ReplyTurn } from "./model.ts";

const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const NAMES: Record<string, string> = { usr_irfad: "Irfad Imtiaz", usr_omar: "Omar Reyes", agt_mira: "Mira" };
const msg = (id: string, author: { kind: "agent" | "person"; id: string }): Message => ({ messageId: id, threadId: "thr_c", threadSeq: 1, author, kind: author.kind === "agent" ? "agent" : "text", body: "Three teammates on this.", blocks: [], depth: 0, attachments: [], reactions: [], pinned: false, createdAt: 1 } as unknown as Message);
const labels = (items: ReturnType<typeof menuFor>): string[] => items.map((i) => ("separator" in i ? "-" : "head" in i ? `# ${i.head}` : i.label));

const TURN: ReplyTurn = {
  turnId: "trn_a1", traceId: "0123456789abcdef0123456789abcdef", agentId: "agt_mira", asker: "usr_irfad", model: "claude-opus-5-5", effort: "high", engine: "claude_code", provider: "anthropic",
  accountKind: "subscription", accountRef: "#Irfad_Claude", state: "completed", ranOn: [{ kind: "computer", name: "Irfad's MacBook" }],
  timing: { queuedAt: 999_600, startedAt: 1_000_000, firstTokenAt: 1_002_100, endedAt: 1_014_000 }, tokens: { in: 41_280, out: 1904, cacheRead: 118_400, cacheWrite: 9650 }, cost: { source: "subscription" },
  tools: [{ name: "Read", args: "upload-spec.md", ok: true, durationMs: 1800 }], files: { read: ["upload-spec.md"], written: [] }, skills: [], switches: [], private: false, partial: false,
};
const DETAILS = (turn: ReplyTurn): ReplyDetails => ({ messageId: "msg_r1", threadId: "thr_c", agentId: "agt_mira", at: 1, turn, memory: { facts: [{ factId: "fct_1", text: "Files live in one folder per client" }], quotes: [] }, steps: [] });

function stubCall(d: ReplyDetails) {
  const calls: string[] = [];
  const call = async (cap: string): Promise<unknown> => {
    calls.push(cap);
    if (cap === "chat.reply_details") return { details: d };
    if (cap === "engine.accounts.list") return { accounts: [{ ref: "#Irfad_Claude", name: "Irfad's Claude (Max)" }] };
    throw new Error(cap);
  };
  return { call, calls };
}
const actionsFor = (meId: string, call: (cap: string, input: unknown) => Promise<unknown>, opened: string[] = []): ReplyDetailsActions => ({
  read: (id) => readReplyDetails(call, "thr_c", id), open: (id) => void opened.push(id), meId, nameOf: (id) => NAMES[id] ?? id,
});

test("an agent's reply has Details at the end of its menu, which opens the right pane on it; a person's message has none", () => {
  const opened: string[] = [];
  const details = actionsFor("usr_irfad", async () => ({}), opened);
  const a = { copy: () => undefined, openThread: () => undefined, setPinned: () => undefined, react: () => undefined, remove: () => undefined, showMenu: () => undefined, details } as unknown as MessageActions;
  const items = menuFor(msg("msg_r1", { kind: "agent", id: "agt_mira" }), false, a, () => undefined);
  assert.deepEqual(labels(items).slice(-2), ["-", "Details"]);
  (items.at(-1) as { onSelect: () => void }).onSelect();
  assert.deepEqual(opened, ["msg_r1"]);
  assert.ok(!labels(menuFor(msg("msg_p1", { kind: "person", id: "usr_omar" }), false, a, () => undefined)).includes("Details"));
  assert.ok(!labels(menuFor(msg("msg_r1", { kind: "agent", id: "agt_mira" }), false, { ...a, details: undefined } as MessageActions, () => undefined)).includes("Details"), "no right pane, no Details");
});

test("the hover card names the model, the account, the asker, where it ran, the cost, tokens and time", async () => {
  forgetReplyDetails();
  const { call } = stubCall(DETAILS(TURN));
  const details = actionsFor("usr_irfad", call);
  await details.read("msg_r1");
  const out = clean(renderToStaticMarkup(<ReplyCard messageId="msg_r1" details={details} at={{ left: 10, top: 10 }} onClose={() => undefined} />));
  for (const s of ["Mira", "Claude Opus 5.5 · High effort", "Asked by", "You", "Irfad's Claude (Max)", "Irfad's MacBook", "Included in your Claude plan", "41k in · 1.9k out", "14 s", "Details"]) assert.ok(out.includes(s), s);
});

test("the Details tab draws every section from the record, with copy buttons on the ids and Not reported where the provider was silent", async () => {
  forgetReplyDetails();
  const { call, calls } = stubCall(DETAILS(TURN));
  const details = actionsFor("usr_irfad", call);
  await details.read("msg_r1");
  await details.read("msg_r1");
  assert.equal(calls.filter((c) => c === "chat.reply_details").length, 1, "an ended reply is read once");
  const out = clean(renderToStaticMarkup(<ReplyDetailsPane messageId="msg_r1" details={details} copy={() => undefined} when="11:05" />));
  for (const s of ["Reply at 11:05", "IDs", "trn_a1", "Who and where", "Timing", "0.4 s", "2.1 s", "Tokens", "118,400", "Not reported by Claude Code", "Cost", "A sign-in is not billed per token", "Tools used", "upload-spec.md", "Done · 1.8 s", "What the agent knew", "Files live in one folder per client", "Skills loaded", "Errors and retries", "Copy as JSON"]) assert.ok(out.includes(s), s);
  assert.ok(out.includes('data-testid="details-copy-id-msg"') && out.includes('data-testid="details-copy-id-trace"'));
});

test("another member's Details: whose account it was, and no account name, cost, tool arguments or files", async () => {
  forgetReplyDetails();
  const hidden: ReplyTurn = { ...TURN, private: true, tools: [{ name: "Read", ok: true, durationMs: 1800 }], files: { read: [], written: [] } };
  delete (hidden as Partial<ReplyTurn>).cost;
  delete (hidden as Partial<ReplyTurn>).accountRef;
  const { call } = stubCall(DETAILS(hidden));
  const details = actionsFor("usr_omar", call);
  await details.read("msg_r1");
  const out = clean(renderToStaticMarkup(<ReplyDetailsPane messageId="msg_r1" details={details} copy={() => undefined} />));
  assert.ok(out.includes("On Irfad's account"));
  assert.ok(out.includes("Arguments hidden"));
  assert.ok(out.includes("Only Irfad and the people who manage AI spend see the account and the cost."));
  assert.ok(!out.includes("Irfad's Claude (Max)") && !out.includes("upload-spec.md") && !out.includes("Included in"));
});

test("the hover card and the Details tab say who paid and why when the turn kept it, and say nothing when it did not", async () => {
  const paid = "The agent's Chat key";
  const { cardLines, detailLines } = await import("./model.ts");
  const ctx = { meId: "usr_irfad", nameOf: (id: string) => NAMES[id] ?? id };
  const d = DETAILS({ ...TURN, paid });
  assert.deepEqual(cardLines(d, ctx as never).lines.filter((l) => l.key === "paid").map((l) => "value" in l ? l.value : ""), [paid]);
  assert.deepEqual(detailLines(d, ctx as never).filter((l) => l.key === "paid").map((l) => "label" in l ? l.label : ""), ["Paid because"]);
  assert.equal(cardLines(DETAILS(TURN), ctx as never).lines.some((l) => l.key === "paid"), false);
});
