// Ask the Space in Cmd-K (owner decision, 3 Nov 2026): the Ask row beside the hits, the answer view (question kept in the field, streamed text with numbered citation chips, Sources that Enter opens,
// Copy, Continue in a chat), Esc back to the results, typing leaving the answer, and the no-access answer. The server half is modules/search and test/search.ask.team.live.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { CmdKBody } from "./CmdK.tsx";
import { CmdKController } from "./controller.ts";
import { answerParts, askable, isQuestion, keywords, parseQuery, plainLength, revealed, searchText } from "./model.ts";
import { LOCAL_HITS, SAMPLE_ANSWER, SAMPLE_NO_ACCESS, createSampleData } from "./sample.ts";

const until = async (cond: () => boolean, ms = 5000): Promise<void> => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 5)); } };
const kinds = (c: CmdKController): string[] => c.getState().rows.map((r) => r.type);
const Q = "what did Elena say about the lease";

test("a question is offered for asking; a short word or a prefixed search is not; the words of a question are what the search looks up", () => {
  assert.ok(askable(parseQuery(Q)) && askable(parseQuery("lease documents for Elena Rivera")) && askable(parseQuery("renewal?")));
  assert.ok(!askable(parseQuery("lease")) && !askable(parseQuery("rivera lease")) && !askable(parseQuery("#what did Elena say about the lease")) && !askable(parseQuery("> what is this thing")));
  assert.ok(isQuestion("how much?") && isQuestion("Did she sign") && !isQuestion("Rivera lease deposit"));
  assert.equal(keywords(Q), "elena lease");
  assert.equal(searchText(parseQuery(Q)), "elena lease");
  assert.equal(searchText(parseQuery("referral")), "referral", "a plain word is searched as typed");
});

test("the Ask the Space row is first and highlighted for a question, last for a plain phrase, and absent without a Space to ask", async () => {
  const { data } = createSampleData({ ask: true, serverDelayMs: 5 });
  const c = new CmdKController(data);
  c.setRaw("what is the referral fee split");
  assert.deepEqual(kinds(c).slice(0, 2), ["head", "ask"]);
  assert.equal(c.getState().rows[c.getState().active]?.type, "ask", "Enter asks");
  const plain = new CmdKController(createSampleData({ ask: true, serverDelayMs: 5, local: [...LOCAL_HITS, { kind: "file", id: "f1", title: "referral fee split policy", link: "vyre://file/f1", score: 1 }] }).data);
  plain.setRaw("referral fee split policy");
  const rows = plain.getState().rows;
  assert.equal(rows[rows.length - 1]?.type, "ask", "after the hits");
  assert.equal(rows[plain.getState().active]?.type, "hit", "the top hit stays highlighted");
  const off = new CmdKController(createSampleData({ serverDelayMs: 5 }).data);
  off.setRaw("what is the referral fee split");
  assert.ok(!kinds(off).includes("ask"), "no ask capability, no row");
  const dev = new CmdKController(createSampleData({ ask: true, scope: "device" }).data);
  dev.setRaw("what is the referral fee split");
  assert.ok(!dev.getState().rows.some((r) => r.type === "ask"), "a device search holds no Space to ask");
  c.toggleFilter("files");
  assert.ok(!c.getState().rows.some((r) => r.type === "ask"), "not with a type filter");
});

test("Enter on the row asks: the question stays in the field, the answer streams in with its citations, the sources follow, and Enter on a source opens it", async () => {
  const { data, calls } = createSampleData({ ask: true, serverDelayMs: 5 });
  const c = new CmdKController(data, { revealMs: 2 });
  c.setRaw(Q);
  c.choose();
  assert.equal(c.getState().ask?.phase, "working");
  assert.equal(c.getState().raw, Q, "the question stays in the field");
  assert.deepEqual(calls.asked, [Q]);
  await until(() => c.getState().ask?.phase === "streaming");
  assert.ok(c.getState().rows.length === 0, "no sources until it is written");
  await until(() => c.getState().ask?.phase === "answered");
  const a = c.getState().ask!;
  assert.equal(a.shown, plainLength(answerParts(SAMPLE_ANSWER.answer!)));
  assert.deepEqual(c.getState().rows.filter((r) => r.type === "source").map((r) => r.type === "source" && r.source.n), [1, 2, 3, 4]);
  assert.equal(c.getState().rows[c.getState().active]?.type, "source");
  c.move(1);
  c.choose();
  assert.deepEqual(calls.opened, [{ id: "ib_consult", newTab: false }], "Enter opens the highlighted source");
  assert.deepEqual(calls.recorded, ["ib_consult"]);
  assert.equal(c.getState().open, false);
});

test("a citation chip opens its own source; Copy and Continue in a chat carry the question and the answer", async () => {
  const { data, calls } = createSampleData({ ask: true, serverDelayMs: 5 });
  const c = new CmdKController(data, { revealMs: 0 });
  c.setRaw(Q);
  c.choose();
  await until(() => c.getState().ask?.phase === "answered");
  c.copyAnswer();
  assert.match(calls.answerCopied[0] ?? "", /^Elena asked for the lease documents by Thursday \[1\]\./);
  assert.match(calls.answerCopied[0] ?? "", /\[3\] rivera-engagement-letter\.docx/, "the cited sources go with it");
  c.continueInChat();
  assert.deepEqual([calls.chats[0]?.question, /Intake booked her consult/.test(calls.chats[0]?.answer ?? "")], [Q, true]);
  assert.equal(c.getState().open, false, "the sheet closes as the chat opens");
  const d = new CmdKController(createSampleData({ ask: true, serverDelayMs: 5 }).data, { revealMs: 0 });
  const calls2 = createSampleData({ ask: true, serverDelayMs: 5 });
  const e = new CmdKController(calls2.data, { revealMs: 0 });
  e.setRaw(Q); e.choose();
  await until(() => e.getState().ask?.phase === "answered");
  e.openCitation(3);
  assert.deepEqual(calls2.calls.opened, [{ id: "fi_engage_letter", newTab: false }]);
  void d;
});

test("Esc goes back to the results with the question kept; typing leaves the answer; Esc again closes", async () => {
  const { data } = createSampleData({ ask: true, serverDelayMs: 5 });
  const c = new CmdKController(data, { revealMs: 0 });
  c.setRaw(Q); c.choose();
  await until(() => c.getState().ask?.phase === "answered");
  c.escape();
  assert.equal(c.getState().ask, null);
  assert.equal(c.getState().raw, Q);
  assert.ok(kinds(c).includes("ask"), "the results, Ask row included");
  assert.equal(c.getState().open, true);
  c.choose(); await until(() => c.getState().ask?.phase === "answered");
  c.setRaw(`${Q} in March`);
  assert.equal(c.getState().ask, null, "typing leaves the answer");
  c.escape();
  assert.equal(c.getState().open, false);
});

test("an answer that arrives after the person went back is dropped", async () => {
  let release: (a: typeof SAMPLE_ANSWER) => void = () => undefined;
  const { data } = createSampleData({ ask: () => new Promise((r) => { release = r; }), serverDelayMs: 5 });
  const c = new CmdKController(data, { revealMs: 0 });
  c.setRaw(Q); c.choose();
  c.escape();
  release(SAMPLE_ANSWER);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(c.getState().ask, null);
});

test("nothing readable: the no-access answer, no sources, no copy; no account and a failure still list what was found", async () => {
  const none = createSampleData({ ask: () => Promise.resolve(SAMPLE_NO_ACCESS), serverDelayMs: 5 });
  const c = new CmdKController(none.data, { revealMs: 0 });
  c.setRaw("what is the Zephyr acquisition price"); c.choose();
  await until(() => c.getState().ask?.phase === "no_access");
  assert.equal(c.getState().rows.length, 0);
  c.copyAnswer(); c.continueInChat();
  assert.deepEqual([none.calls.answerCopied.length, none.calls.chats.length], [0, 0]);
  const html = renderToStaticMarkup(<CmdKBody controller={c} />);
  assert.ok(html.includes("I can&#x27;t see anything about that you can read.") && html.includes("Ask whoever owns it to share it with you."));
  const noAcct = createSampleData({ ask: () => Promise.resolve({ ...SAMPLE_ANSWER, state: "no_account", answer: undefined, cited: [] } as never), serverDelayMs: 5 });
  const d = new CmdKController(noAcct.data, { revealMs: 0 });
  d.setRaw(Q); d.choose();
  await until(() => d.getState().ask?.phase === "no_account");
  assert.equal(d.getState().rows.filter((r) => r.type === "source").length, 4);
  const fail = new CmdKController(createSampleData({ ask: () => Promise.reject(new Error("down")), serverDelayMs: 5 }).data, { revealMs: 0 });
  fail.setRaw(Q); fail.choose();
  await until(() => fail.getState().ask?.phase === "failed");
});

test("the answer view draws the account line, the chips, the sources and the quiet line", async () => {
  const { data } = createSampleData({ ask: true, serverDelayMs: 5 });
  const c = new CmdKController(data, { revealMs: 0 });
  c.setRaw(Q); c.choose();
  await until(() => c.getState().ask?.phase === "answered");
  const html = renderToStaticMarkup(<CmdKBody controller={c} />);
  for (const part of ["Asked of the Space, on your Claude account", 'data-testid="cmdk-cite-1"', 'data-testid="cmdk-cite-4"', "Lease documents for Thursday", "rivera-engagement-letter.docx", "From 4 things you can read. Nothing private to someone else is used.", "Continue in a chat", "Copy", "back to results"]) assert.ok(html.includes(part), part);
  assert.equal(revealed(answerParts("A [1] b"), 1).length, 1, "a mark waits for the text before it");
  assert.deepEqual(revealed(answerParts("A [1] b"), 2), [{ text: "A " }, { cite: 1 }]);
});
