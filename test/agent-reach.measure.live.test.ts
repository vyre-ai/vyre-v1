// What someone who was never in an invite-only channel can learn from an agent made in one of its threads (for the owner's decision on who reaches such an agent). A booted daemon, the real
// chat, agents, memory and access modules, and a model stand-in that records everything the engine puts in front of it. A fact is said only in the private thread T ("PELICAN-4242"), the agent
// is made in T and works there, and the fact is kept in the agent's memory as learned from T. Then Carol, who was never in the channel, reaches the agent every way she can. Every door is
// printed (MEASURE lines). One thing is asserted, because it is not a product question: the content of T never reaches Carol, through the agent's context, memory, files or chats.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, seededDir, waitFor } from "./memory-live-kit.ts";
import { api, join, ok } from "./member-key-kit.ts";
import { fakeSpaceKey, setSpaceKey } from "./support/space-key-endpoint.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";

const SECRET = "PELICAN-4242";
const seen: Array<{ threadId: string; asker: string; input: string }> = [];
/** What the scripted model's file tools answered: one row per call, with the thread and asker of the turn that made it. */
const toolRuns: Array<{ threadId: string; asker: string; tool: string; ok: boolean; content: string }> = [];
/** Where the scripted model writes and what it is asked to send: set by the test once the agent's folder is known. */
const work: { folderId: string; fileId: string } = { folderId: "", fileId: "" };
/**
 * The model stand-in: it keeps what each turn was given (the transcript, the recalled memory, the built context), then answers. Told "WRITE-NOTE" it calls the files tool the way a model would
 * (tool_search, then files_create in its own folder, the place agent/skills/focus-files says it keeps its work); told "SEND-FILE" it calls files_read on the file it made. The tool calls run
 * through the engine as the agent, in the turn the message started, so the asker of that turn is who they act for.
 */
const recorder: OpenSession = async (spec) => {
  const waiting = new Map<string, (r: { ok: boolean; content: unknown }) => void>();
  let n = 0;
  const found = new Set<string>();
  return {
    warm: true,
    async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
      seen.push({ threadId: spec.threadId, asker: spec.asker, input: JSON.stringify({ spec, input }) });
      const said = JSON.stringify(input.trigger ?? {});
      async function* use(tool: string, args: Record<string, unknown>): AsyncGenerator<DriverEvent, void> {
        if (!found.has(tool)) {
          const id = `s${++n}`;
          const p = new Promise<{ ok: boolean; content: unknown }>((r) => waiting.set(id, r));
          yield { type: "tool_call", id, name: "tool_search", input: { query: tool } };
          await p; found.add(tool);
        }
        const id = `c${++n}`;
        const p = new Promise<{ ok: boolean; content: unknown }>((r) => waiting.set(id, r));
        yield { type: "tool_call", id, name: tool, input: args };
        const r = await p;
        toolRuns.push({ threadId: spec.threadId, asker: input.asker, tool, ok: r.ok, content: JSON.stringify(r.content) });
      }
      if (said.includes("WRITE-NOTE") && work.folderId) yield* use("files_create", { folderId: work.folderId, name: "Code notes.md", content: { text: `What I made about the code: ${SECRET}` }, idempotencyKey: `note-${spec.threadId}` });
      if (said.includes("SEND-FILE") && work.fileId) { yield* use("files_read", { fileId: work.fileId, as: "text" }); yield* use("search_query", { q: "Code notes" }); yield* use("files_list", { section: "space", folder: work.folderId }); }
      yield { type: "text", text: "Noted." };
      yield { type: "done" };
    },
    sendToolResult(callId: string, result: { ok: boolean; content: unknown }) { waiting.get(callId)?.(result); },
    inject() {}, async cancel() {}, async close() {},
  } as unknown as EngineSession;
};

test("an agent made in an invite-only channel's thread: what a never-member can learn from it, and its private content never reaches them", async () => {
  const stub = await fakeSpaceKey();
  const dir = seededDir();
  const d = await boot(dir, recorder, undefined, { vault: undefined } as unknown as NonNullable<Parameters<typeof boot>[3]>);
  const rows: Array<[string, string]> = [];
  // the table in the lane's report: printed, and kept in VYRE_MEASURE_OUT when set (the runner shows a passing file's output only on a failure)
  const note = (door: string, what: string): void => {
    rows.push([door, what]);
    console.log(`MEASURE ${door} | ${what}`);
    const out = process.env["VYRE_MEASURE_OUT"];
    if (out) fs.appendFileSync(out, `${door} | ${what}\n`);
  };
  try {
    // turns run on the Space's AI key, as in the engine live tests
    await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.alloc(32, 3).toString("base64") }) });
    await setSpaceKey(d, d.token, stub);
    const ana = await join(d, "ana");
    const carol = await join(d, "carol");
    // #legal is invite-only: the owner and Ana. A thread T under a message; the fact is said only in T
    const ch = (await ok(d, d.token, "channels.create", { name: "legal", visibility: "invite", memberIds: [ana.personId], agentIds: [] })).channel as { channelId: string; mainThreadId: string };
    const msg = await ok(d, d.token, "chat.post", { threadId: ch.mainThreadId, body: "The Rivera matter." });
    const t = (await ok(d, ana.token, "chat.thread", { threadId: ch.mainThreadId, messageId: msg.message.messageId })).thread.threadId as string;
    const made = await ok(d, d.token, "threads.agent.create", { threadId: t, name: "Rivera helper", brief: "Helps with the Rivera matter", mode: "lead" });
    const agentId = made.agentId as string;
    await ok(d, ana.token, "chat.post", { threadId: t, body: `The settlement code is ${SECRET}. Keep it to this thread.`, mentions: [{ kind: "agent", id: agentId }] });
    await waitFor(async () => (seen.some((s) => s.threadId === t && s.input.includes(SECRET)) ? true : null), 30_000);
    note("sanity: the agent's turn in T", "its input holds the fact (it is told it in T)");
    // what the agent keeps from T: a fact in its memory, learned from T (as memory.remember from the chat does)
    // in the agent's own layer (what the agent itself keeps, shared by everyone who works with it), and, as a second case, in Ana's own layer
    const remembered = await api(d, ana.token, "memory.remember", { text: `The Rivera settlement code is ${SECRET}`, layer: "agent", agentId, threadId: t });
    note("memory.remember from T into the agent's layer (as Ana, in T)", `status ${remembered.status} ${remembered.status === 200 ? "" : JSON.stringify(remembered.data).slice(0, 160)}`);
    const viaAgent = await api(d, d.token, "memory.remember", { text: `Rivera settlement code: ${SECRET}`, layer: "agent", agentId, threadId: t });
    note("memory.remember from T into the agent's layer (as the owner, its manager)", `status ${viaAgent.status} ${viaAgent.status === 200 ? "" : JSON.stringify(viaAgent.data).slice(0, 160)}`);

    // a shared layer follows its review rule: the agent's manager accepts what is proposed, so the fact is current in the agent's memory
    const listed = (await ok(d, d.token, "memory.facts.list", { agentId })).facts as Array<Record<string, unknown>>;
    for (const f of listed.filter((x) => JSON.stringify(x).includes(SECRET))) {
      const id = String(f["factId"] ?? f["id"] ?? f["ref"] ?? "");
      const acc = await api(d, d.token, "memory.fact.accept", { factId: id, idempotencyKey: `acc-${id}` });
      note("memory.fact.accept by the agent's manager", `status ${acc.status}; status before: ${String(f["status"])}`);
    }
    // controls: the same doors for Ana, who is in #legal, show what is there to find
    for (const [cap, input] of [["memory.facts.list", { agentId }], ["memory.search", { q: "settlement code", agentId }], ["memory.pointer", { threadId: t, agentId, text: "What is the Rivera settlement code?" }]] as const) {
      const r = await api(d, ana.token, cap, input);
      note(`control, Ana: ${cap}`, `status ${r.status}; has it: ${JSON.stringify(r.data).includes(SECRET)}`);
    }
    // a control turn: Ana asks the agent in a NEW chat of her own; does memory carry T's fact into another chat for someone who may read T?
    const anaNew = await api(d, ana.token, "chat.start", { kind: "chat", agentIds: [agentId], first: "What is the Rivera settlement code?", idempotencyKey: `ana-ask-${Date.now()}` });
    if (anaNew.status === 200) {
      const at = (anaNew.data as { thread: { threadId: string } }).thread.threadId;
      await waitFor(async () => (seen.some((x) => x.threadId === at) ? true : null), 30_000).catch(() => null);
      note("control, Ana: the engine's input for her turn in a new chat", `has it: ${seen.filter((x) => x.threadId === at).some((x) => x.input.includes(SECRET))}`);
    }

    // ---- reach (owner decision, 12 Nov 2026): an agent made in an invite-only channel's thread reads, to someone who cannot read that chat, exactly like an agent that does not exist
    const ghostAgent = `agt_${"0".repeat(32)}`;
    const codeOf = (r: { data: unknown }): string => String((r.data as { error?: { code?: string } }).error?.code ?? "");
    const reachDoors: Array<[string, string, (id: string) => Record<string, unknown>]> = [
      ["agents.get", "agents.get", (id) => ({ agentId: id })], ["agents.summary", "agents.summary", (id) => ({ agentId: id })], ["agents.config.get", "agents.config.get", (id) => ({ agentId: id })],
      ["agents.routines.list", "agents.routines.list", (id) => ({ agentId: id })], ["agents.status", "agents.status", (id) => ({ agentId: id })],
      ["chat.start with it", "chat.start", (id) => ({ kind: "chat", agentIds: [id], first: "hello", idempotencyKey: `reach-${id}-${globalThis.crypto.randomUUID()}` })],
      ["a task assigned to it", "tasks.create", (id) => ({ title: "Draft the letter", assigned: { kind: "agent", id }, idempotencyKey: `reach-task-${globalThis.crypto.randomUUID()}` })],
    ];
    const reach = async (who: { token: string }): Promise<Map<string, string>> => {
      const out = new Map<string, string>();
      for (const [door, cap, input] of reachDoors) {
        const real = await api(d, who.token, cap, input(agentId));
        const none = await api(d, who.token, cap, input(ghostAgent));
        out.set(door, real.status === 200 ? "reaches" : real.status === none.status && codeOf(real) === codeOf(none) ? "as if it did not exist" : `refused differently (${real.status} ${codeOf(real)}; none ${none.status} ${codeOf(none)})`);
      }
      const listed = await api(d, who.token, "agents.list", { teammates: "include", limit: 500 });
      out.set("agents.list (the Agents list and every picker)", JSON.stringify(listed.data).includes(agentId) ? "reaches" : "as if it did not exist");
      const found = await api(d, who.token, "search.query", { q: "Rivera helper" });
      out.set("search.query", JSON.stringify(found.data).includes(agentId) ? "reaches" : "as if it did not exist");
      return out;
    };
    const admin = await join(d, "adele", undefined, "Admin");
    const [carolReach, anaReach, adminReach] = [await reach(carol), await reach(ana), await reach(admin)];
    for (const [door] of carolReach) note(`reach: ${door}`, `Carol ${carolReach.get(door)}; Ana ${anaReach.get(door)}; an admin outside #legal ${adminReach.get(door)}`);
    for (const [door, v] of carolReach) assert.equal(v, "as if it did not exist", `Carol, never in #legal: ${door}`);
    for (const door of ["agents.get", "chat.start with it", "agents.list (the Agents list and every picker)"]) assert.equal(anaReach.get(door), "reaches", `Ana, a reader: ${door}`);
    for (const door of ["agents.get", "agents.list (the Agents list and every picker)"]) assert.equal(adminReach.get(door), "reaches", `an admin manages it by role: ${door}`);

    // ---- Carol, never in #legal
    const get = await api(d, carol.token, "agents.get", { agentId });
    const fields = get.status === 200 ? Object.keys((get.data as { agent: Record<string, unknown> }).agent).sort().join(", ") : "-";
    note("agents.get", `status ${get.status}; fields: ${fields}`);
    if (get.status === 200) note("agents.get holds the fact", String(JSON.stringify(get.data).includes(SECRET)));
    for (const [cap, input] of [
      ["agents.summary", { agentId }], ["agents.config.get", { agentId }], ["agents.routines.list", { agentId }], ["agents.status", { agentId }],
      ["memory.facts.list", { agentId }], ["memory.search", { q: "settlement code", agentId }], ["memory.notes.list", { agentId }],
      ["chat.search", { q: "settlement code" }], ["chat.recent", { filter: "agents" }], ["threads.get", { threadId: t }], ["chat.messages.list", { threadId: t }],
    ] as const) {
      const r = await api(d, carol.token, cap, input);
      note(cap, `status ${r.status}; holds the fact: ${JSON.stringify(r.data).includes(SECRET)}`);
    }
    const folderId = String((await ok(d, d.token, "agents.get", { agentId })).agent.folderId ?? "");
    assert.ok(folderId, "the agent has its own files folder");
    work.folderId = folderId;
    // (1) the agent writes from its work in T: a turn in T bound to Ana (she asks), the model calls files_create in its own folder as the engine would
    const asked = seen.length;
    await ok(d, ana.token, "chat.post", { threadId: t, body: "WRITE-NOTE: keep what you found about the code", mentions: [{ kind: "agent", id: agentId }] });
    const wrote = await waitFor(async () => toolRuns.find((r) => r.threadId === t && r.tool === "files_create") ?? null, 30_000);
    note("(1) the agent's files_create in a turn of T (Ana asks)", `ok ${wrote.ok}; asker ${wrote.asker === ana.personId ? "Ana" : wrote.asker}; ${wrote.ok ? "" : wrote.content.slice(0, 200)}`);
    assert.ok(seen.length > asked && wrote.ok, `the agent writes its note in its own folder: ${wrote.content.slice(0, 300)}`);
    // the tool answer as the model sees it (text, or the capability's output): the file's id is in it
    const fileId = /"fileId\\?":\\?"(fil_[A-Za-z0-9_]+)/.exec(wrote.content)?.[1] ?? /(fil_[A-Za-z0-9]+)/.exec(wrote.content)?.[1] ?? "";
    assert.ok(fileId, `the tool answer names the file: ${wrote.content.slice(0, 300)}`);
    work.fileId = fileId;
    const landed = (await ok(d, d.token, "files.get", { fileId })).file as { folderId?: string; parentId?: string };
    note("(1) where it landed", `${(landed.folderId ?? landed.parentId) === folderId ? "the agent's own folder" : JSON.stringify(landed).slice(0, 200)}`);
    // what the browser downloads and the terminal's ~/Vyre mirror keep lands in the same folder (Downloads under it, and the folder itself): a subfolder of it, as the downloads code makes it
    const dl = (await ok(d, d.token, "files.folder.create", { parentId: folderId, name: "Downloads" })).folder.folderId as string;
    const dlFile = (await ok(d, d.token, "files.create", { folderId: dl, name: "rivera.pdf.txt", content: { text: `Downloaded for the Rivera code ${SECRET}` } })).file.fileId as string;
    const gone = (await ok(d, d.token, "files.create", { folderId, name: "Old draft.md", content: { text: `Old draft ${SECRET}` } })).file.fileId as string;
    await ok(d, d.token, "files.write", { fileId, content: { text: `What I made about the code, second pass: ${SECRET}` } });
    await ok(d, d.token, "files.delete", { fileId: gone });
    const has = (r: { data: unknown }): boolean => JSON.stringify(r.data).includes(SECRET);
    const names = (r: { data: unknown }): boolean => /Code notes|rivera\.pdf|Old draft/.test(JSON.stringify(r.data));
    // search: wait for the index (the owner, the agent's manager, finds the note), then ask as Carol and Ana
    const indexed = await waitFor(async () => { const r = await api(d, d.token, "search.query", { q: "Code notes" }); return /Code notes/.test(JSON.stringify(r.data)) ? true : null; }, 20_000).catch(() => false);
    note("search index: the owner finds the note", String(indexed));
    // (2) every door to those files, as Carol and, as the control, Ana
    const doors: Array<[string, string, Record<string, unknown>, (r: { status: number; data: unknown }) => boolean]> = [
      ["files.get by id", "files.get", { fileId }, (r) => r.status === 200],
      ["files.read by id", "files.read", { fileId, as: "text" }, has],
      ["files.read of a download (Downloads under the folder)", "files.read", { fileId: dlFile, as: "text" }, has],
      ["files.list of the folder (section space, folder)", "files.list", { section: "space", folder: folderId }, names],
      ["files.list deep over the Space", "files.list", { section: "space", deep: true, q: "Code" }, names],
      ["the right pane's agent folder (files.list as the pane calls it)", "files.list", { folder: folderId }, names],
      ["files.share_external (a link for outside the Space)", "files.share_external", { fileId, idempotencyKey: `ext-${Date.now()}-${Math.random()}` }, (r) => r.status === 200],
      ["files.external_links", "files.external_links", { fileId }, (r) => r.status === 200],
      ["files.folder.get of the folder", "files.folder.get", { folderId }, (r) => r.status === 200],
      ["files.folder.search in the folder", "files.folder.search", { folderId, q: "Code" }, names],
      ["files.tree (the Agents root)", "files.tree", {}, (r) => JSON.stringify(r.data).includes(folderId)],
      ["files.recent", "files.recent", {}, names],
      ["files.shared_with_me", "files.shared_with_me", {}, names],
      ["search.query for the file", "search.query", { q: "Code notes" }, names],
      ["files.versions", "files.versions", { fileId }, (r) => r.status === 200],
      ["files.viewer_data", "files.viewer_data", { fileId }, (r) => r.status === 200],
      ["previews.text", "previews.text", { fileId }, has],
      ["files.trash.list", "files.trash.list", {}, names],
      ["files.share (make a share link or share it on)", "files.share", { fileId, subject: { kind: "person", id: carol.personId }, level: "view" }, (r) => r.status === 200],
    ];
    const reads = async (token: string): Promise<Map<string, string>> => {
      const out = new Map<string, string>();
      for (const [door, cap, input, open] of doors) {
        const r = await api(d, token, cap, input);
        out.set(door, `${open(r) ? "OPEN" : "closed"} (${r.status})`);
        // Ana's share, the control, is taken back at once: a grant she made would let Carol in by a normal share, and that is not the door being measured
        if (cap === "files.share" && r.status === 200) await ok(d, token, "access.unshare", { resource: { type: "file", id: fileId }, subject: { kind: "person", id: carol.personId } });
      }
      return out;
    };
    const carolSees = await reads(carol.token);
    const anaSees = await reads(ana.token);
    // what Carol's refusal says, beside the answer for a file that does not exist: neither may name the file or carry its content
    const ghost = `fil_${"0".repeat(32)}`;
    for (const cap of ["files.get", "files.read"] as const) {
      const real = await api(d, carol.token, cap, { fileId, as: "text" });
      const none = await api(d, carol.token, cap, { fileId: ghost, as: "text" });
      const code = (r: { data: unknown }): string => String((r.data as { error?: { code?: string } }).error?.code ?? "");
      note(`(2) ${cap} refused, beside a file that does not exist`, `real ${real.status} ${code(real)}; none ${none.status} ${code(none)}; names the file: ${/Code notes/.test(JSON.stringify(real.data))}; holds the fact: ${has(real)}`);
      assert.equal(/Code notes/.test(JSON.stringify(real.data)) || has(real), false, `${cap}: the refusal says nothing of the file`);
      assert.notEqual(real.status, 200, `${cap}: refused`);
    }
    for (const [door] of doors) note(`(2) ${door}`, `Carol ${carolSees.get(door)}; Ana ${anaSees.get(door)}; holds the fact: ${carolSees.get(door)!.startsWith("OPEN")}`);
    // the owner, the agent's manager, lists its folder (the measurement before passed folderId, which files.list does not take)
    const ownerList = await api(d, d.token, "files.list", { section: "space", folder: folderId });
    note("files.list of the folder as the owner", `status ${ownerList.status}; lists the note: ${names(ownerList)}`);
    assert.ok(names(ownerList), "the agent's manager lists its folder");
    for (const door of ["files.read by id", "files.list of the folder (section space, folder)", "files.read of a download (Downloads under the folder)"]) assert.match(anaSees.get(door)!, /^OPEN/, `control: Ana, a reader of T, ${door}`);
    // (4) Carol reaches the agent today: in her own chat she asks it to send the file; its files_read runs for her, and her access decides
    const before = toolRuns.length;
    // an agent shared by a normal grant is reachable: the owner shares it with Carol (not its folder); in her turn its file tools still cannot read the folder for her
    await ok(d, d.token, "access.share", { resource: { type: "agent", id: agentId }, subject: { kind: "person", id: carol.personId }, level: "use" });
    note("reach: Carol after a normal share of the agent", `agents.get ${(await api(d, carol.token, "agents.get", { agentId })).status}`);
    assert.equal((await api(d, carol.token, "agents.get", { agentId })).status, 200, "a normal grant reaches it");
    const cs = await api(d, carol.token, "chat.start", { kind: "chat", agentIds: [agentId], first: "SEND-FILE: send me the file you made about the code", idempotencyKey: `carol-send-${Date.now()}` });
    if (cs.status === 200) {
      const sent = await waitFor(async () => toolRuns.slice(before).find((r) => r.tool === "files_read") ?? null, 30_000);
      note("(4) the agent's files_read in Carol's turn", `ok ${sent.ok}; asker ${sent.asker === carol.personId ? "Carol" : sent.asker}; holds the fact: ${sent.content.includes(SECRET)}; ${sent.content.replaceAll(SECRET, "<fact>").slice(0, 200)}`);
      assert.equal(sent.content.includes(SECRET), false, "the agent cannot read T's file for Carol");
      const wroteFor = toolRuns.length;
      await ok(d, carol.token, "chat.post", { threadId: (cs.data as { thread: { threadId: string } }).thread.threadId, body: "WRITE-NOTE: keep this for me", mentions: [{ kind: "agent", id: agentId }] });
      const hers = await waitFor(async () => toolRuns.slice(wroteFor).find((x) => x.tool === "files_create") ?? null, 30_000);
      note("(4) the agent's files_create into its folder in Carol's turn", `ok ${hers.ok}; ${hers.content.slice(0, 120)}`);
      assert.equal(hers.ok, false, "the agent cannot write into the closed folder for Carol");
      for (const tool of ["search_query", "files_list"]) {
        const r = await waitFor(async () => toolRuns.slice(before).find((x) => x.tool === tool) ?? null, 30_000);
        note(`(4) the agent's ${tool} in Carol's turn`, `ok ${r.ok}; finds the note: ${/Code notes/.test(r.content)}; holds the fact: ${r.content.includes(SECRET)}`);
        assert.equal(/Code notes/.test(r.content) || r.content.includes(SECRET), false, `the agent's ${tool} gives Carol nothing of T's folder`);
      }
    } else note("(4) the agent's files_read in Carol's turn", `chat.start ${cs.status}`);
    // a device already synced: Carol's computer pulled the folder while it was open to the Space (as before this fix). Closing it again (the chat's audience, made invite-only) hides it in the
    // next pull, the row the app wipes
    const pull = async (cursor: number, id: string): Promise<{ next: number; has: boolean; hides: boolean }> => {
      const r = await fetch(`${d.url}/sync/v1/pull`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${carol.token}` }, body: JSON.stringify({ cursor, epoch: 0 }) });
      const b = (await r.json()) as { data: { next: number; changes: unknown[]; hide: unknown[] } };
      return { next: b.data.next, has: JSON.stringify(b.data.changes).includes(id), hides: JSON.stringify(b.data.hide).includes(id) };
    };
    note("(2) sync.pull for Carol's device", `has the file: ${(await pull(0, fileId)).has}`);
    // the chat's audience changes: made public, the folder opens to the Space with it; a file written then reaches Carol's device (as every file of such a folder did before this fix)
    await ok(d, d.token, "channels.update", { channelId: ch.channelId, visibility: "public" });
    const openNow = await api(d, carol.token, "files.read", { fileId, as: "text" });
    note("audience: #legal made public, Carol reads the file", `status ${openNow.status}; holds the fact: ${has(openNow)}`);
    const synced = (await ok(d, d.token, "files.create", { folderId, name: "While public.md", content: { text: `Written while #legal was public: ${SECRET}` } })).file.fileId as string;
    // files do not travel over the sync feed in this build (no module emits sync.row for a file; only records fold into it): the owner's own pull has no file either
    const first = await pull(0, synced);
    const mine = await fetch(`${d.url}/sync/v1/pull`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ cursor: 0, epoch: 0 }) });
    const ownerHas = JSON.stringify(((await mine.json()) as { data: { changes: unknown[] } }).data.changes).includes(synced);
    note("(2) sync.pull for Carol's device, while #legal is public", `has the file written then: ${first.has}; the owner's own pull has it: ${ownerHas}`);
    await ok(d, d.token, "channels.update", { channelId: ch.channelId, visibility: "invite" });
    const closedAgain = await api(d, carol.token, "files.read", { fileId: synced, as: "text" });
    note("audience: #legal made invite-only again, Carol reads that file", `status ${closedAgain.status}; holds the fact: ${has(closedAgain)}`);
    const after = await pull(first.next, synced);
    note("(2) sync.pull after it closed again: the file on her device is taken back", `hide row for the file: ${after.hides}; sent again: ${after.has}`);
    assert.equal(has(closedAgain), false, "made invite-only again, the folder closes again");
    // a file the feed had sent must come back as a hide row; one it never sent must not be sent now
    assert.ok(!first.has || after.hides, "a file Carol's device already holds is taken back by the next pull");
    assert.equal(after.has, false, "a closed folder's file is not sent to her device");
    // archived: the channel keeps its readers, and so does the folder
    await ok(d, d.token, "channels.archive", { channelId: ch.channelId });
    const archivedCarol = await api(d, carol.token, "files.read", { fileId: dlFile, as: "text" });
    const archivedAna = await api(d, ana.token, "files.read", { fileId: dlFile, as: "text" });
    note("audience: #legal archived", `Carol ${archivedCarol.status}, holds the fact: ${has(archivedCarol)}; Ana ${archivedAna.status}`);
    assert.equal(has(archivedCarol), false, "archived, the folder stays closed to Carol");
    await ok(d, d.token, "channels.unarchive", { channelId: ch.channelId });
    // leaving: Ana leaves #legal and loses the folder in the same call, the note the agent wrote in a turn she asked for included: a file an agent makes in its own folder is the agent's
    await ok(d, ana.token, "channels.leave", { channelId: ch.channelId });
    const anaList = await api(d, ana.token, "files.list", { section: "space", folder: folderId });
    const anaDl = await api(d, ana.token, "files.read", { fileId: dlFile, as: "text" });
    const anaOwn = await api(d, ana.token, "files.read", { fileId, as: "text" });
    note("Ana leaves #legal: the folder", `files.list ${anaList.status}, lists files others made in it: ${/rivera\.pdf|While public/.test(JSON.stringify(anaList.data))}; a download in it ${anaDl.status}, holds the fact: ${has(anaDl)}`);
    note("Ana leaves #legal: the note the agent wrote in her turn", `files.read ${anaOwn.status}; holds the fact: ${has(anaOwn)}`);
    // out of the chat, Ana reads the agent as Carol does: as if it did not exist
    const leftReach = await reach(ana);
    for (const [door, v] of leftReach) { note(`reach: Ana after leaving #legal: ${door}`, v); assert.equal(v, "as if it did not exist", `Ana, out of #legal: ${door}`); }
    assert.equal(has(anaOwn), false, "the agent's note is the agent's: Ana, out of the chat, no longer reads it");
    assert.equal(has(anaDl), false, "leaving the home chat takes the folder in the same call");
    assert.equal(/rivera\.pdf|While public/.test(JSON.stringify(anaList.data)), false, "and its listing");
    for (const [door] of doors) assert.doesNotMatch(carolSees.get(door)!, /^OPEN/, `Carol, never in #legal: ${door}`);

    // Carol asks the agent in a new chat: what does the engine put in front of the model for her?
    const start = await api(d, carol.token, "chat.start", { kind: "chat", agentIds: [agentId], first: "What is the Rivera settlement code?", idempotencyKey: `carol-ask-${Date.now()}` });
    note("chat.start with the agent, asking for the fact", `status ${start.status}`);
    if (start.status === 200) {
      const ct = (start.data as { thread: { threadId: string } }).thread.threadId;
      await waitFor(async () => (seen.some((s) => s.threadId === ct) ? true : null), 30_000).catch(() => null);
      const hers = seen.filter((s) => s.threadId === ct);
      note("the engine's input for Carol's turn (transcript, recall, context)", `${hers.length} turn(s); holds the fact: ${hers.some((s) => s.input.includes(SECRET))}`);
      const ptr = await api(d, carol.token, "memory.pointer", { threadId: ct, agentId, text: "What is the Rivera settlement code?" });
      note("memory.pointer (what recall gives her turn)", `status ${ptr.status}; holds the fact: ${JSON.stringify(ptr.data).includes(SECRET)}`);
      // the one thing that is not a product question
      assert.equal(hers.some((s) => s.input.includes(SECRET)), false, "T's content never reaches Carol through the agent's context or recall");
      assert.equal(JSON.stringify(ptr.data).includes(SECRET), false, "memory recall never hands her T's content");
    }
    // every door, the agent's files folder among them (it follows its home chat, 12 Nov 2026): none hands Carol T's content
    assert.ok(!rows.some(([door, what]) => door !== "sanity: the agent's turn in T" && !door.startsWith("control") && !door.startsWith("audience: #legal made public") && /holds the fact: true/.test(what)), `no door hands Carol T's content:\n${rows.map((r) => r.join(" | ")).join("\n")}`);
  } finally {
    await d.stop();
    await stub.close?.();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
