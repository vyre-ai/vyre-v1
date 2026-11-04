// The words of a reply's hover card and Details tab, from chat.reply_details: real model names, the account in words, the cost from the record, "Not reported by …" for what the
// provider did not send (never 0), and what someone other than the asker may not see.
import test from "node:test";
import assert from "node:assert/strict";
import { accountLine, cardLines, costLine, detailLines, modelTitle, usd } from "./model.ts";
import type { DetailsContext, Line, ReplyDetails, ReplyTurn } from "./model.ts";

const NAMES: Record<string, string> = { usr_irfad: "Irfad Imtiaz", usr_omar: "Omar Reyes", agt_mira: "Mira", agt_sol: "Sol" };
const me = (id: string): DetailsContext => ({ meId: id, nameOf: (x) => NAMES[x] ?? x, accountName: (ref) => (ref === "#Irfad_Claude" ? "Irfad's Claude (Max)" : undefined) });

const signin: ReplyTurn = {
  turnId: "trn_a1", traceId: "0123456789abcdef0123456789abcdef", agentId: "agt_mira", asker: "usr_irfad", model: "claude-opus-5-5", effort: "high", engine: "claude_code", provider: "anthropic",
  accountKind: "subscription", accountRef: "#Irfad_Claude", state: "completed", ranOn: [{ kind: "computer", name: "Irfad's MacBook" }],
  timing: { queuedAt: 999_600, startedAt: 1_000_000, firstTokenAt: 1_002_100, endedAt: 1_014_000 },
  tokens: { in: 169_330, out: 1904, cacheRead: 118_400, cacheWrite: 9650 }, cost: { source: "subscription" },
  tools: [{ name: "Read", args: "upload-spec.md", ok: true, durationMs: 1800 }, { name: "crew.start", args: "3 teammates", ok: true, durationMs: 600, heldTaskId: "tsk_h1" }],
  files: { read: ["upload-spec.md"], written: [] }, skills: ["write-a-brief"],
  switches: [{ at: 1_000_500, why: "provider.overloaded", sameAccount: true, from: "#Irfad_Claude", to: "#Irfad_Claude" }], private: false, partial: false,
};
const api: ReplyTurn = {
  ...signin, turnId: "trn_b1", agentId: "agt_sol", model: "glm-5.3", effort: undefined as never, engine: "opencode_go", provider: "opencode_go", accountKind: "api_key", shared: true, accountRef: "#Team_Go",
  tokens: { in: 29_989, out: 1769, cacheRead: 20_000, reasoning: 898 },
  cost: { source: "catalog", micros: 62_000, priceAsOf: "2026-10-06", lines: [{ kind: "input", tokens: 9989, perMillion: 1.25, micros: 12_486 }, { kind: "output", tokens: 1769, perMillion: 10, micros: 17_690 }] },
  skills: [], switches: [],
};
delete (api as Partial<ReplyTurn>).effort;
const details = (turn?: ReplyTurn): ReplyDetails => ({ messageId: "msg_r1", threadId: "thr_t", agentId: turn?.agentId ?? "agt_mira", at: 1, ...(turn ? { turn } : {}), memory: { facts: [{ factId: "fct_1", text: "Files live in one folder per client", sourceTitle: "Portal plan" }], quotes: [] }, steps: [{ name: "Read", ok: true, secs: 2 }] });
const kv = (lines: Line[], key: string): string | undefined => { const l = lines.find((x) => x.key === key); return l && l.kind === "kv" ? l.value : undefined; };

test("model names read as people say them", () => {
  assert.equal(modelTitle("claude-opus-5-5"), "Claude Opus 5.5");
  assert.equal(modelTitle("claude-sonnet-5-5"), "Claude Sonnet 5.5");
  assert.equal(modelTitle("gpt-6.1-sol"), "GPT-6.1 Sol");
  assert.equal(modelTitle("glm-5.3"), "glm-5.3");
  assert.equal(modelTitle(""), "Not recorded");
  assert.equal(usd(62_000), "$0.062");
  assert.equal(usd(4_210_000), "$4.21");
});

test("the hover card of a sign-in turn: model and effort, the account by name, where, included in the plan, tokens and time", () => {
  const c = cardLines(details(signin), me("usr_irfad"));
  assert.equal(c.head, "Mira");
  assert.equal(c.sub, "Claude Opus 5.5 · High effort");
  assert.deepEqual(c.lines.map((l) => (l.kind === "kv" ? [l.label, l.value] : null)), [
    ["Asked by", "You"], ["Paid by", "Irfad's Claude (Max)"], ["Ran on", "Irfad's MacBook"], ["Cost", "Included in your Claude plan"], ["Tokens", "41k new in · 128k cached · 1.9k out"], ["Took", "14 s"],
  ]);
});

test("an API turn shows dollars from the record, its team key, and 'Not reported' for what the provider did not send", () => {
  const ctx = me("usr_irfad");
  assert.equal(accountLine(api, ctx), "OpenCode Go · Team key");
  assert.equal(costLine(api, ctx), "$0.062");
  const lines = detailLines(details(api), ctx);
  assert.equal(kv(lines, "cache-write"), "Not reported by OpenCode Go");
  assert.equal(kv(lines, "reasoning"), "898");
  assert.equal(kv(lines, "effort"), "The model's default");
  assert.equal(kv(lines, "cost-input"), "$0.012 · 9,989 at $1.25/M");
  assert.equal(kv(lines, "cost-total"), "$0.062");
  assert.equal(costLine({ ...api, cost: { source: "unknown" } }, ctx), "Not reported by OpenCode Go");
  assert.ok(!lines.some((l) => l.kind === "kv" && /^\$?0(\.0+)?$/.test(l.value)), "nothing unknown is shown as 0");
});

test("a flat-plan account (OpenCode Go reports 0) says Flat plan, never $0.00", () => {
  const ctx = me("usr_irfad");
  const flat = { ...api, cost: { source: "flat" as const } };
  assert.equal(costLine(flat, ctx), "Flat plan");
  const lines = detailLines(details(flat), ctx);
  assert.equal(kv(lines, "cost-total"), "Flat plan");
  assert.ok(!lines.some((l) => l.kind === "kv" && /\$/.test(l.value)), "no dollar figure on a flat plan");
});

test("the Details tab lists the ids, timing, tools with their durations and holds, what the agent knew, skills, files and retries", () => {
  const lines = detailLines(details(signin), me("usr_irfad"));
  const labels = lines.filter((l) => l.kind === "label").map((l) => (l.kind === "label" ? l.text : ""));
  assert.deepEqual(labels, ["IDs", "Who and where", "Timing", "Tokens", "Cost", "Tools used", "What the agent knew", "Skills loaded", "Files", "Errors and retries"]);
  assert.deepEqual(lines.filter((l) => l.kind === "kv" && l.copy).map((l) => (l.kind === "kv" ? [l.label, l.value] : null)), [["Message", "msg_r1"], ["Turn", "trn_a1"], ["Trace", "0123456789abcdef0123456789abcdef"]]);
  assert.equal(kv(lines, "queued"), "0.4 s");
  assert.equal(kv(lines, "first"), "2.1 s");
  assert.equal(kv(lines, "reasoning"), "Not reported by Claude Code");
  const tools = lines.filter((l) => l.key.startsWith("tool-"));
  assert.deepEqual(tools.map((l) => (l.kind === "item" ? [l.title, l.note, l.right] : null)), [["Read", "upload-spec.md", "Done · 1.8 s"], ["crew.start", "3 teammates · Held for a yes, then allowed", "Done · 0.6 s"]]);
  assert.ok(lines.some((l) => l.kind === "item" && l.title === "Files live in one folder per client"));
  assert.ok(lines.some((l) => l.kind === "item" && l.title === "write-a-brief"));
  assert.ok(lines.some((l) => l.kind === "item" && l.title === "upload-spec.md" && l.open === "upload-spec.md"));
  assert.ok(lines.some((l) => l.kind === "item" && l.title === "Tried again on the same account: the provider was busy"));
});

test("another member sees whose account it was, not the account, the cost, the arguments or the files", () => {
  const omar = me("usr_omar");
  const hidden: ReplyTurn = { ...signin, private: true, files: { read: [], written: [] }, tools: signin.tools.map(({ args: _a, ...x }) => x) };
  delete (hidden as Partial<ReplyTurn>).cost;
  delete (hidden as Partial<ReplyTurn>).accountRef;
  const card = cardLines(details(hidden), omar);
  assert.equal(kv(card.lines, "paid"), "On Irfad's account");
  assert.equal(kv(card.lines, "asker"), "Irfad Imtiaz");
  assert.equal(card.lines.find((l) => l.key === "cost"), undefined);
  const lines = detailLines(details(hidden), omar);
  assert.ok(lines.some((l) => l.kind === "note" && l.text.startsWith("Only Irfad and the people who manage AI spend")));
  assert.ok(lines.filter((l) => l.key.startsWith("tool-")).every((l) => l.kind === "item" && l.note?.startsWith("Arguments hidden")));
  assert.equal(lines.find((l) => l.key.startsWith("cost-input")), undefined);
});

test("a reply with no recorded turn says so and shows the steps it saved", () => {
  const lines = detailLines(details(), me("usr_irfad"));
  assert.ok(lines.some((l) => l.kind === "note" && l.text.startsWith("Vyre did not keep the details of this reply")));
  assert.ok(lines.some((l) => l.kind === "item" && l.title === "Read" && l.right === "Done · 2 s"));
  assert.equal(cardLines(details(), me("usr_irfad")).sub, "Not recorded for this reply");
});

test("the card counts new input and cached input apart, and the tab says what the model was shown in its last call", () => {
  const t: ReplyTurn = { ...signin, tokens: { in: 1_000_000, out: 8_300, context: 61_000, cacheRead: 940_000, cacheWrite: 0 } };
  assert.equal(kv(cardLines(details(t), me("usr_irfad")).lines, "tokens"), "60k new in · 940k cached · 8.3k out");
  const lines = detailLines(details(t), me("usr_irfad"));
  const row = (k: string) => lines.find((l) => l.key === k && l.kind === "kv") as { label: string; value: string } | undefined;
  assert.deepEqual([row("in")?.label, row("in")?.value, row("context")?.label, row("context")?.value], ["New input", "60,000", "Context in the last call", "61,000"]);
  // a provider that gave no split: the total as it is
  assert.equal(kv(cardLines(details({ ...signin, tokens: { in: 41_280, out: 1904 } }), me("usr_irfad")).lines, "tokens"), "41k in · 1.9k out");
});

test("an estimated cost says so in the card and the tab", () => {
  const t: ReplyTurn = { ...signin, accountKind: "api_key", cost: { source: "estimate", micros: 41_668, priceAsOf: "2026-10-06" } };
  assert.equal(kv(cardLines(details(t), me("usr_irfad")).lines, "cost"), "About $0.042 (an estimate)");
  assert.ok(detailLines(details(t), me("usr_irfad")).some((l) => l.kind === "note" && /so it is an estimate/.test(l.text)));
});
