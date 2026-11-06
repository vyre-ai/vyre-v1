// A long session in the real conversation (owner, 6 Nov 2026, prototype t-session): hour marks down the column, a jump row where a release was tagged, quiet messages since the person last looked folded into one
// "While you were away" row that opens in place, what is long and what needs them left alone, and the summary the right pane's Overview reads.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, mount, press, textOf } from "../../../onboarding/test-dom.ts";
import { withDom } from "../addsheet/addsheet.support.tsx";
import { Conversation } from "../conversation/Conversation.tsx";
import { createSample } from "../conversation/sample.ts";
import type { Sample } from "../conversation/sample.ts";
import type { Message } from "../conversation/model.ts";
import { SessionProvider, useSession } from "./context.tsx";
import type { SessionSummary } from "./model.ts";

const MIN = 60_000;
const LONG_ANSWER = "The release is built and signed. Two things are left: the Mac upload finishes in a few minutes, then MLA updates. I will post here when it is healthy, and I will not touch MLA before you say so, as you asked earlier tonight.";

/** The idle sample plus a night's traffic after it: chatter, one jump, one long answer, in four hours. Returns the first new sequence number. */
function night(s: Sample): { firstSeq: number } {
  const rows = s.replica.rows("messages") as unknown as Message[];
  const last = rows.reduce((n, m) => Math.max(n, m.threadSeq), 0);
  const t0 = rows.reduce((n, m) => Math.max(n, m.createdAt), 0) + 30 * MIN;
  const agent = { kind: "agent" as const, id: "agt_intake" };
  const add = (i: number, body: string, o: Partial<Message> = {}): Message => ({ messageId: `n${i}`, threadId: "c1", threadSeq: last + 1 + i, author: agent, kind: "agent", body, blocks: [], depth: 0, attachments: [], reactions: [], pinned: false, createdAt: t0 + i * 6 * MIN, ...o } as Message);
  const out: Message[] = [];
  for (let i = 0; i < 40; i += 1) out.push(add(i, `quiet step ${i}`));
  out[20] = add(20, "Release v1.0.0-rc.22.1 tagged", { kind: "system", author: agent });
  out[30] = add(30, LONG_ANSWER);
  s.replica.put("messages", out.map((m) => ({ id: m.messageId, ...m })));
  return { firstSeq: last + 1 };
}

const withCatchUp = (s: Sample, since: number): Sample["data"] => ({
  ...s.data,
  call: async (cap: string, input: unknown): Promise<unknown> => (cap === "chat.catch_up" ? { unread: 40, since, top: since + 40, firstMessageId: "n0", people: [], tasks: [], decisions: [], at: [] } : s.data.call(cap, input)),
});

test("a long chat gets hour marks and a jump row; quiet messages since the last read fold into one row that opens in place", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    const { firstSeq } = night(s);
    let summary: SessionSummary | null = null;
    function Probe(): null { summary = useSession()?.summary ?? null; return null; }
    const root = await mount(createRoot, <SessionProvider threadId="c1"><Probe /><Conversation data={withCatchUp(s, firstSeq - 1)} /></SessionProvider>);
    await flush();
    const text = textOf(root);
    assert.ok(text.includes("While you were away"), "the away row");
    assert.match(text, /did \d+ things/);
    assert.ok(!text.includes("quiet step 3"), "the quiet steps are folded");
    assert.ok(text.includes("Release v1.0.0-rc.22.1 tagged") || find(root, "jump-n20"), "the release is a jump row");
    assert.ok(find(root, "jump-n20"), "a jump row for the release");
    assert.ok(text.includes("I will not touch MLA before you say so"), "an agent's longer answer is never folded");
    const hours = JSON.stringify(root).match(/"data-testid":"hour-[^"]+"/g) ?? [];
    assert.ok(hours.length >= 3, `an hour mark for each hour (${hours.length})`);
    assert.equal(summary !== null && (summary as SessionSummary).long, true, "the pane is told it is a long session");
    assert.equal(summary !== null && (summary as SessionSummary).jumps.length, 1);
    const toggle = JSON.stringify(root).match(/"data-testid":"(away-[^"]+-toggle)"/)?.[1];
    assert.ok(toggle, "the away row has a toggle");
    await press(find(root, toggle!));
    assert.ok(textOf(root).includes("quiet step 3"), "the folded steps open in place");
  });
});

test("nothing folds when the person has read everything, and a short chat is left exactly as it was", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    night(s);
    const rows = s.replica.rows("messages") as unknown as Message[];
    const top = rows.reduce((n, m) => Math.max(n, m.threadSeq), 0);
    const root = await mount(createRoot, <Conversation data={withCatchUp(s, top)} />);
    await flush();
    assert.ok(!textOf(root).includes("While you were away"));
    assert.ok(textOf(root).includes("quiet step 3"), "everything read stays where it is");
    const plain = await mount(createRoot, <Conversation data={createSample("idle").data} />);
    await flush();
    const ids = JSON.stringify(plain).match(/"data-testid":"(hour|jump|away)-/g) ?? [];
    assert.equal(ids.length, 0, "a short chat has no hour marks, jumps or away rows");
  });
});
