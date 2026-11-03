// Ask the Space (owner decision, 3 Nov 2026), end to end on a booted Team daemon with only the model a stand-in. A question in Cmd-K is answered from what the asker may read:
//  - a source the asker can read is cited, and every citation names a real source they can open;
//  - what the asker cannot read (a private channel) is not in the prompt, not in the sources and not in the answer: with nothing to read the answer is the no-access line and no model is called;
//  - a private profile fact is never a source;
//  - the request runs on the asker's own account (a Mine account first, else the Space account they may use), never on someone else's.
import test from "node:test";
import assert from "node:assert/strict";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { KEY, boot, connect, hostLog, seededDir, stop, waitFor } from "./support/eco-live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";

const WHO = ["usr_olivia", "usr_mia"];
const as = (d: Daemon) => async (who: string, cap: string, input: unknown): Promise<{ status: number; data: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify(input) });
  const b = (await r.json()) as { data?: unknown };
  return { status: r.status, data: b.data ?? b };
};

test("Team: Ask the Space answers Mia from what she may read, with real citations, on her own account, and gives her nothing of Olivia's private channel or profile", async () => {
  const requests: Array<{ asker: string; account: string; prompt: string }> = [];
  const model: OpenSession = async (spec) => ({
    warm: true,
    async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
      const prompt = input.trigger?.body ?? "";
      if (!prompt.startsWith("Question:")) { yield { type: "done" }; return; }   // not an Ask the Space request (memory's background pass)
      requests.push({ asker: spec.asker, account: spec.account?.ref ?? "", prompt });
      // like a model told to answer only from its sources: when the question's subject is not in them, it says it cannot see anything
      const subject = /^Question:.*(Zephyr|Skylark)/.exec(prompt)?.[1];
      if (subject && !new RegExp(`Sources:[\\s\\S]*${subject}`).test(prompt)) { yield { type: "text", text: "I can't see anything about that you can read." }; yield { type: "done" }; return; }
      // cites the first source, and a number that names none
      yield { type: "text", text: "The Rivera lease deposit is 4200 dollars [1]. Ask Olivia about the rest [9]." };
      yield { type: "done" };
    },
    sendToolResult() {}, inject() {}, async cancel() {}, async close() {},
  } as EngineSession);
  const ownerToken = { v: "" };
  const d = await boot(seededDir(), model, {
    vault: undefined,
    session: (headers: Record<string, string | undefined>) => {
      const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      const id = t === ownerToken.v ? "usr_olivia" : t;
      return WHO.includes(id) ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "ask-space" } : null;
    },
  });
  ownerToken.v = d.token;
  const api = as(d);
  const pump = async (): Promise<void> => { await d.hooks?.pump?.(); };
  try {
    const mine = await connect(d);   // Olivia's own Claude account, hers alone
    void mine;
    const keys = await api("usr_olivia", "vault.folders.create", { idempotencyKey: "ask-ai", name: "AI accounts", scope: "shared" });
    const team = await api("usr_olivia", "providers.add", { idempotencyKey: "ask-team", providerKey: "anthropic", connection: "api_key", apiKey: `${KEY}T`, name: "Team AI", scope: "shared", folderId: keys.data.folder.id });
    assert.equal(team.status, 200, JSON.stringify(team.data));
    const teamRef = team.data.provider.handle as string;

    // what Mia may read: a public channel. What she may not: a private channel of Olivia's, and Olivia's private profile.
    const open = await api("usr_olivia", "channels.create", { name: "rivera", visibility: "public", memberIds: ["usr_mia"], agentIds: [], idempotencyKey: "ask-open" });
    const hidden = await api("usr_olivia", "channels.create", { name: "founders", visibility: "invite", memberIds: [], agentIds: [], idempotencyKey: "ask-hidden" });
    assert.equal(open.status, 200, JSON.stringify(open.data));
    assert.equal(hidden.status, 200, JSON.stringify(hidden.data));
    assert.equal((await api("usr_olivia", "chat.post", { threadId: open.data.channel.mainThreadId, body: "The Rivera lease deposit is 4200 dollars, due Thursday.", idempotencyKey: "ask-m1" })).status, 200);
    assert.equal((await api("usr_olivia", "chat.post", { threadId: hidden.data.channel.mainThreadId, body: "The Zephyr acquisition price is 9100000 dollars, keep it quiet.", idempotencyKey: "ask-m2" })).status, 200);
    assert.equal((await api("usr_olivia", "memory.profile.add", { text: "My private nickname is Skylark and I keep the Zephyr plan", to: "private" })).status, 200);
    await waitFor(async () => { await pump(); const r = await api("usr_mia", "search.query", { q: "Rivera lease deposit" }); return r.data.hits?.length ? true : null; }, 20_000, () => hostLog(d));
    await waitFor(async () => { await pump(); const r = await api("usr_olivia", "search.query", { q: "Zephyr acquisition" }); return r.data.hits?.length ? true : null; }, 20_000, () => hostLog(d));

    // a file whose word "meniscus" Olivia hid from AI: her own search finds it, Ask the Space neither cites the file for that word nor says it
    const roots = ((await api("usr_olivia", "files.tree", {})).data as { roots: { key: string; folderId?: string }[] }).roots.filter((r) => r.folderId);
    const clinic = (await api("usr_olivia", "files.folder.create", { parentId: roots[0]!.folderId, name: "Clinic", idempotencyKey: "ask-clinic" })).data.folder.folderId as string;
    const knee = (await api("usr_olivia", "files.create", { folderId: clinic, name: "knee-notes.txt", mime: "text/plain", content: { text: "Dr Park says the meniscus tear needs surgery in March." }, idempotencyKey: "ask-knee" })).data.file.fileId as string;
    assert.equal((await api("usr_olivia", "files.agent_access.set", { target: { type: "folder", id: clinic }, value: "redact" })).status, 200);
    assert.equal((await api("usr_olivia", "files.marks.add", { target: { type: "file", id: knee }, kind: "redact", shape: "span", text: "meniscus" })).status, 200);
    await waitFor(async () => { await pump(); const r = await api("usr_olivia", "search.query", { q: "meniscus" }); return r.data.hits?.some((x: { id: string }) => x.id === knee) ? true : null; }, 20_000, () => hostLog(d));
    const askedBefore = requests.length;
    const red = await api("usr_olivia", "search.ask", { q: "what does the knee note say about the meniscus" });
    assert.equal(red.status, 200, JSON.stringify(red.data));
    assert.ok(!red.data.sources.some((s: { id: string }) => s.id === knee), "the file is not cited for a word an agent may not read");
    assert.ok(!/meniscus/i.test(JSON.stringify(red.data)), "nor is the word said");
    assert.ok(requests.slice(askedBefore).every((r) => !/meniscus/i.test(r.prompt)), "the word never reached the model");
    const surgery = await api("usr_olivia", "search.ask", { q: "what does the knee note say about surgery" });
    assert.ok(!/meniscus/i.test(JSON.stringify(surgery.data)) && requests.slice(askedBefore).every((r) => !/meniscus/i.test(r.prompt)), "asked another way, the file is read only as an agent reads it");

    // Mia asks about what she may read: answered, cited, on her account (the Space's, she has no Mine one), and the prompt holds her sources only
    const base = requests.length;
    const a = await api("usr_mia", "search.ask", { q: "what is the Rivera lease deposit" });
    assert.equal(a.status, 200, JSON.stringify(a.data));
    assert.equal(a.data.state, "answered", JSON.stringify(a.data));
    assert.equal(a.data.answer, "The Rivera lease deposit is 4200 dollars [1]. Ask Olivia about the rest.", "a citation that names no source is taken out");
    assert.deepEqual(a.data.cited, [1]);
    assert.ok(a.data.sources.length >= 1 && a.data.sources.every((s: { n: number; link: string; title: string }, i: number) => s.n === i + 1 && s.link.startsWith("vyre://")));
    for (const n of a.data.cited as number[]) {
      const s = a.data.sources.find((x: { n: number }) => x.n === n);
      const hit = await api("usr_mia", "search.resolve", { kind: s.kind, itemId: s.id });
      assert.equal(hit.data.hit?.id, s.id, "every cited source is one Mia can open");
    }
    assert.equal(requests.length, base + 1);
    assert.deepEqual([requests[base]!.asker, requests[base]!.account], ["usr_mia", teamRef], "Mia's request runs for Mia, on the Space account, never on Olivia's own");
    assert.ok(requests[base]!.prompt.includes("4200 dollars"));
    assert.ok(!JSON.stringify((await api("usr_mia", "search.query", { q: "Zephyr acquisition" })).data).includes("founders"), "Cmd-K search itself does not show an invite-only channel to someone who was not invited");
    assert.ok(!/Zephyr|9100000|Skylark/.test(requests[base]!.prompt + JSON.stringify(a.data)), "nothing of the private channel or profile");

    // Mia asks about what she may not read: the no-access answer, no source, no leaked word (the model saw only what she may read, and says it sees nothing)
    const before = requests.length;
    const n = await api("usr_mia", "search.ask", { q: "what is the Zephyr acquisition price" });
    assert.equal(n.status, 200);
    assert.deepEqual([n.data.state, n.data.answer, n.data.sources], ["no_access", "I can't see anything about that you can read.", []]);
    assert.ok(requests.slice(before).every((r) => !/Zephyr acquisition price is|9100000|Skylark/.test(r.prompt)), "the model was never shown the private channel");
    assert.ok(!/9100000|Skylark/.test(JSON.stringify(n.data)));

    // Olivia asks about her own private channel: answered, on her own Mine account, and her private profile fact is not a source
    const o = await api("usr_olivia", "search.ask", { q: "what is the Zephyr acquisition price" });
    assert.equal(o.data.state, "answered", JSON.stringify(o.data));
    assert.ok(o.data.sources.some((s: { title: string }) => /founders/i.test(s.title)), "she may read her own channel");
    const last = requests[requests.length - 1]!;
    assert.equal(last.asker, "usr_olivia");
    assert.notEqual(last.account, teamRef, "Olivia's own Mine account comes first for her");
    assert.ok(last.prompt.includes("9100000"));
    assert.ok(!/Skylark/.test(last.prompt), "her private profile is not a source of an answer");
    const p = await api("usr_olivia", "search.ask", { q: "what is my private nickname Skylark" });
    assert.deepEqual([p.data.state, p.data.sources], ["no_access", []], "a private profile fact is never a source");
  } catch (e) { console.error("FAILED:", e instanceof Error ? e.message.slice(0, 2000) : e); throw e; } finally { await stop(d); }
});
