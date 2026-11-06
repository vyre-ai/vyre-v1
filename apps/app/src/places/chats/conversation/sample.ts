// The sample conversation behind the tests and screenshots: Northwind's "Rivera intake" chat with Intake (leads) and Docs (listens), from the prototype. A fake replica holds the thread,
// its messages and its helpers; the writes the conversation makes (post, edit, stop, mode, plan) really change the replica, so a mount behaves like the app does.
import { createFakeReplica, createScreenHooks } from "../../../../../../client/src/index.ts";
import type { FakeReplica, Row } from "../../../../../../client/src/index.ts";
import { screensById } from "../../../../../../generated/screens.ts";
import { createStreamStore } from "../../../../../../ui/src/stream/index.ts";
import type { FrameScheduler, StreamStore } from "../../../../../../ui/src/stream/index.ts";
import type { ConversationData, Connection, ConversationNav } from "./data.tsx";
import type { Candidate, Helper, Message, MessageBlock, Thread } from "./model.ts";

/** Friday 24 October 2025, 10:00 (UTC, so every machine prints the same times). */
export const SAMPLE_NOW = Date.UTC(2025, 9, 24, 10, 0, 0);
const at = (h: number, min: number, sec = 0, dayOffset = 0): number => Date.UTC(2025, 9, 24 + dayOffset, h, min, sec);

export type Variant = "idle" | "streaming" | "busy" | "errors" | "plan" | "long" | "nolead" | "closed" | "channel" | "runson" | "vaultkey" | "lastpick";

export const NAMES: Record<string, string> = {
  agt_intake: "Intake", agt_docs: "Docs", agt_research: "Research", agt_scout: "Scout", agt_billing: "Billing",
  usr_irfad: "You", usr_maya: "Maya Chen", usr_omar: "Omar Haddad",
};
const KINDS: Record<string, "person" | "agent"> = { agt_intake: "agent", agt_docs: "agent", agt_research: "agent", agt_scout: "agent", agt_billing: "agent", usr_irfad: "person", usr_maya: "person", usr_omar: "person" };

export const DIRECTORY: Candidate[] = Object.entries(NAMES).map(([id, name]) => ({ id, name, kind: KINDS[id] ?? "person" }));

/** A frame scheduler the sample flushes by hand, so a streamed delta is on the page when push returns (the tests and the held screenshot need no timers). */
let queued: ((time: number) => void) | null = null;
const manual: FrameScheduler = { request: (cb) => { queued = cb; return 1; }, cancel: () => { queued = null; } };
const flush = (): void => { const cb = queued; queued = null; cb?.(0); };

const step = (id: string, title: string, sub: string, secs: number, state: "live" | "done" = "done"): MessageBlock => ({ type: "step", v: 1, id, data: { title, sub, secs }, state, traceId: `tr_${id}` });
const card = (id: string, type: string, data: Record<string, unknown>, state?: "live" | "done" | "waiting" | "error"): MessageBlock => ({ type, v: 1, id, data, ...(state ? { state } : {}), traceId: `tr_${id}` });

const INTAKE_REPLY = "Tuesday has two openings, **2:00** and **4:00**, and Thursday has **10:00**. I've sent Elena the intake form and noted Maya's referral on her record.\n\nWhich time should I book?";

function build(variant: Variant): { thread: Thread; messages: Message[]; helpers: Helper[] } {
  const base: Omit<Thread, "agents"> = { threadId: "c1", kind: "chat", title: "Rivera intake", listed: true, planMode: false, members: [{ kind: "person", id: "usr_irfad" }, { kind: "agent", id: "agt_intake" }, { kind: "agent", id: "agt_docs" }], createdAt: at(9, 24) };
  const agents: Thread["agents"] = variant === "nolead" || variant === "channel"
    ? [{ agentId: "agt_intake", mode: "listen", model: "opus" }, { agentId: "agt_docs", mode: "listen", model: "sonnet" }]
    : [{ agentId: "agt_intake", mode: "lead", model: "opus" }, { agentId: "agt_docs", mode: "listen", model: "sonnet" }];
  const thread: Thread = { ...base, agents, ...(variant === "closed" ? { closedAt: at(9, 50) } : {}), ...(variant === "channel" ? { kind: "channel" as Thread["kind"], title: "intake", channelId: "ch_intake" } : {}) };
  let seq = 0;
  const m = (id: string, author: { kind: "person" | "agent"; id: string }, body: string, createdAt: number, o: Partial<Message> = {}): Message => ({
    messageId: id, threadId: "c1", threadSeq: ++seq, author, kind: author.kind === "agent" ? "agent" : "text", body, blocks: [], depth: 0, attachments: [], reactions: [], pinned: false, createdAt, ...o,
  });
  const me = { kind: "person" as const, id: "usr_irfad" };
  const intake = { kind: "agent" as const, id: "agt_intake" };
  const docs = { kind: "agent" as const, id: "agt_docs" };
  const messages: Message[] = [];
  if (variant === "channel") {
    // a channel where agents listen until named: Maya asked without naming one, then so did you (owner ruling, 3 Nov 2026)
    thread.members = [...thread.members, { kind: "person", id: "usr_maya" }];
    messages.push(
      m("c1", { kind: "person", id: "usr_maya" }, "Did the Rivera intake form come back?", at(9, 20)),
      m("c2", me, "Can someone check the Rivera dates before Tuesday?", at(9, 21)),
    );
    return { thread, messages, helpers: [] };
  }
  if (variant === "runson") {
    // where a chat runs (lane l-runson): pinned to this computer; it went to sleep mid-turn once (the turn went on on the server), and now it is off and the next message waits for it
    thread.title = "Rivera engagement letter";
    const status = (id: string, data: Record<string, unknown>): MessageBlock => ({ type: "turn_status", v: 1, id, data });
    messages.push(
      m("r1", me, "Pull this year's fee schedule and draft the Rivera engagement letter.", at(9, 40)),
      m("r2", intake, "", at(9, 41), { blocks: [status("st1", { state: "note", text: "Your computer went to sleep; continuing on the Northwind server" })] }),
      m("r3", intake, "Drafted the engagement letter from the standard template with this year's consult fee. The retainer is **$2,500**; Maya has not confirmed it yet.", at(9, 42), {
        blocks: [step("s1", "Read fee-schedule-2025.csv", "Projects/Rivera matter", 3), step("s2", "Filled the engagement letter", "templates/engagement-letter.docx", 6), card("b1", "file", { name: "rivera-engagement-letter.docx", sub: "Word · 38 KB", id: "doc1" }, "done")],
      }),
      m("r4", me, "Now check the retainer clause against Maya's notes.", at(9, 50)),
      m("r5", intake, "", at(9, 50, 5), { blocks: [status("st2", { state: "device_wait", text: "Your computer is off. This chat runs when it is back." })] }),
    );
    return { thread, messages, helpers: [] };
  }
  if (variant === "vaultkey" || variant === "lastpick") {
    // lane l-chatrely (6 Nov): a turn that needs the Vault's key when the server has none says exactly what is missing; a chat with no pick of its own shows the model the person picked last
    thread.title = "Rivera engagement letter";
    thread.agents = [{ agentId: "agt_intake", mode: "lead" }];
    messages.push(m("v1", me, "Pull this year's fee schedule and draft the Rivera engagement letter.", at(9, 40)));
    if (variant === "vaultkey") messages.push(m("v2", intake, "", at(9, 40, 20), { blocks: [{ type: "turn_status", v: 1, id: "vk1", data: { state: "failed", turnId: "t_vk", code: "engine.vault_locked" } } as MessageBlock] }));
    return { thread, messages, helpers: [] };
  }
  if (variant === "long") {
    for (let i = 0; i < 150; i++) {
      const t = at(8, 0, 0) + i * 60_000;
      messages.push(i % 2 === 0 ? m(`f${i}`, me, `Question ${i + 1}: how many consults are booked for week ${(i % 5) + 1}?`, t) : m(`f${i}`, intake, `Week ${(i % 5) + 1} has **${(i % 7) + 2}** consults booked.`, t));
    }
  }
  if (variant === "errors") {
    thread.title = "Rivera engagement letter";
    thread.agents = [{ agentId: "agt_docs", mode: "lead", model: "opus" }];
    thread.members = [{ kind: "person", id: "usr_irfad" }, { kind: "agent", id: "agt_docs" }];
    messages.push(
      m("d1", docs, "The engagement letter for Elena Rivera is drafted from the standard template with the consult fee filled in.", at(8, 50), {
        blocks: [step("s1", "Used the standard engagement letter", "templates/engagement-letter.docx", 22), card("b1", "file", { name: "rivera-engagement-letter.docx", sub: "Word · 38 KB", id: "doc1" }, "done")],
      }),
      m("d2", docs, "", at(8, 50, 30), { blocks: [card("b2", "changeset", { changesetId: "chg_cs2", folderName: "Rivera matter", fileCount: 1, added: 38, removed: 0, state: "open" }, "waiting")] }),
    );
  } else {
    messages.push(
      m("m1", me, "New client: Elena Rivera, referred by Maya. Can you book her a consult this week and send the intake form?", at(9, 24)),
      m("e1", intake, "Intake is on it", at(9, 24, 20), { kind: "quiet" }),
      m("m2", intake, INTAKE_REPLY, at(9, 25), {
        blocks: [step("s1", "Checked Maya's calendar this week", "calendar.free(maya, week)  →  Tue 14:00 · Tue 16:00 · Thu 10:00", 5), step("s2", "Found Elena Rivera in Records", "Contact · created from Maya's email · 23 Oct", 4), step("s3", "Filled the intake form in Chrome", "intake form · name, email, phone", 5)],
      }),
      m("m3", me, "Book 2pm.", at(9, 30)),
      m("m4", intake, "Booked **Tuesday at 2:00** with Maya. Elena gets the invite with the form link, and I'll post in **#intake** when the form comes back.", at(9, 31), {
        blocks: [step("s4", "Booked Tue 2:00 with Maya", "calendar.book(maya, Tue 14:00)", 3), step("s5", "Updated Elena's record", "Stage → Consult booked", 3), card("pl1", "file", { kind: "plan", name: "Rivera onboarding plan", id: "plan1", openComments: 1 }, "done"), card("b1", "file", { name: "client-intake.pdf", sub: "PDF · 207 KB", id: "pdf1" }, "done")],
      }),
      m("m5", intake, "Maya's calendar blocks Thursday mornings, and I offered Thursday 10:00 earlier. I'd like to change my instructions so it doesn't happen again.", at(9, 34), {
        blocks: [card("b2", "changeset", {
          changesetId: "chg_cs1", file: "AGENT.md", agent: "Intake", lines: 93, owner: "Maya Chen",
          why: "Maya's calendar blocks Thursday mornings for client visits, and I offered Thursday 10:00 earlier this week. I would like to stop offering it.",
          hunks: [
            { sec: "## How you work", del: "4. Offer three consult times using the booking tool.", add: "4. Offer three consult times using the booking tool. Skip Thursday mornings." },
            { sec: "## You do not", del: "", add: "- Offer Thursday morning times. Maya blocks them." },
          ],
        }, "waiting")],
      }),
    );
  }
  const helpers: Helper[] = [];
  if (variant === "streaming") {
    messages.push(
      m("m6", me, "Thanks. Can you also draft the engagement letter for her?", at(9, 55)),
      m("m7", intake, "", at(9, 56), { blocks: [step("s6", "Read the standard engagement letter", "templates/engagement-letter.docx", 4), step("s7", "Filled in the consult fee", "fee-schedule.csv", 4)] }),
    );
  }
  if (variant === "busy") {
    messages.push(
      m("m6", me, "Compare our consult pricing with firms within 20 miles, and have Docs check the letter.", at(9, 50)),
      m("m7", intake, "", at(9, 51), { blocks: [step("s6", "Found 9 firms within 20 miles", "maps search · 9 results", 4), step("s7", "Split the work across 3 helpers", "3 helpers · 3 firms each", 0, "live")] }),
      m("m8", docs, "", at(9, 52), { blocks: [step("s8", "Reading rivera-engagement-letter.docx", "Projects/Rivera matter", 0, "live")] }),
    );
    helpers.push(
      { threadId: "h1", title: "Firms 1–3", status: "running", agentId: "agt_intake", model: "haiku", startedAt: at(9, 51, 10) },
      { threadId: "h2", title: "Firms 4–6", status: "running", agentId: "agt_intake", model: "haiku", startedAt: at(9, 51, 12) },
    );
  }
  if (variant === "errors") {
    messages.push(m("m6", docs, "", at(9, 52), {
      blocks: [card("er1", "error", {
        code: "restricted", message: "Docs did not read fee-schedule.csv", cause: "The file is labelled Restricted, and this chat runs on Opus, a cloud model. Restricted data only goes to a model on your computer.",
        next: [["local", "Switch to Llama 3.3 on this computer"], ["access", "Ask for access"]], retryable: true, turnId: "turn_9", traceId: "tr_5e20b4",
        steps: [["Steps", "Opened the matter folder · 0.4s, read engagement-letter.docx · 0.2s, read fee-schedule.csv · refused"], ["Machine", "irfad-macbook"], ["Model", "Opus · your Claude account"], ["Key used", "Your Claude subscription"], ["Denials", "fee-schedule.csv: Restricted, not available to Anthropic"]],
      }, "error")],
    }));
  }
  if (variant === "plan") {
    messages.push(
      m("m6", me, "Plan the onboarding for the Rivera matter before you change anything.", at(9, 55)),
      m("m7", intake, "Here is the plan. Nothing changes until you approve it.", at(9, 56), {
        blocks: [card("p1", "plan", { title: "Rivera onboarding plan", state: "proposed", threadId: "c1", planId: "plan_1", docFileId: "plan1", steps: [{ stepId: "a", text: "Send the engagement letter", state: "done" }, { stepId: "b", text: "Collect the retainer", state: "pending" }, { stepId: "c", text: "Open the matter folder", state: "pending" }, { stepId: "d", text: "Schedule the kickoff", state: "pending" }] }, "waiting"),
          card("q1", "question", { prompt: "Who signs the engagement letter?", mode: "single", options: [{ key: "maya", label: "Maya Chen" }, { key: "omar", label: "Omar Haddad" }] }, "waiting")],
      }),
    );
    thread.planMode = true;
  }
  return { thread, messages, helpers };
}

export interface Sample {
  data: ConversationData;
  replica: FakeReplica;
  calls: { cap: string; input: unknown }[];
  /** what the nav handlers were asked to open */
  opened: string[];
  copied: string[];
  toasts: string[];
  setOnline(online: boolean): void;
  failNext(cap: string): void;
  /** chat.post waits until this is called, so the page can be looked at while a send is out. */
  holdPosts(): void;
  releasePosts(): void;
  /** The stream of the message still being written (variant "streaming"). */
  stream: StreamStore;
  /** Adds text to the open message, as the engine's deltas do. */
  push(delta: string): void;
}

export interface SampleOptions { online?: boolean; streamText?: string; /** the chat's stored title (the sample has "Rivera intake"; "" is a chat with none yet) */ title?: string; /** the chat's members, in place of the sample's (a group chat for the header faces) */ members?: Thread["members"]; /** The signed-in person can only view this chat: they may add viewers, not members. */ viewOnly?: boolean; /** What the chat really has for a newcomer: both a files folder and a record (default), a folder only, or neither. */ scope?: "both" | "folder" | "none" }

const HELD_TEXT = "I read the standard engagement letter and filled in the **consult fee** from the fee schedule. Two things need your eye:\n\n1. The retainer is `$2,500`, which Maya has not confirmed\n2. Elena's address is the old one from the web form";

export function createSample(variant: Variant = "idle", o: SampleOptions = {}): Sample {
  const replica = createFakeReplica("northwind");
  const calls: { cap: string; input: unknown }[] = [];
  const opened: string[] = [];
  const copied: string[] = [];
  const toasts: string[] = [];
  const failing = new Set<string>();
  const listeners = new Set<() => void>();
  let online = o.online ?? true;
  let held: (() => void)[] | null = null;
  let counter = 0;
  const built = build(variant);
  const { messages, helpers } = built;
  // the files folder and record this chat is about, with names that are not the chat's own, so a shot shows which name is which
  const scope = o.scope ?? "both";
  const about = scope === "none" ? {} : { folderId: "fld_intake_uploads", ...(scope === "both" ? { recordId: "rec_elena_rivera" } : {}) };
  const thread: Thread = { ...built.thread, ...about, ...(o.title === undefined ? {} : { title: o.title }), ...(o.members === undefined ? {} : { members: o.members }) };

  replica.put("threads", [{ id: thread.threadId, ...thread }]);
  replica.put("messages", messages.map((m) => ({ id: m.messageId, ...m })));
  replica.put("helpers", helpers.map((h) => ({ id: h.threadId, ...h })));

  const threadRow = (): Thread & Row => (replica.rows("threads") as unknown as (Thread & Row)[]).find((x) => x.threadId === thread.threadId)!;
  const msgRows = (): Message[] => (replica.rows("messages") as unknown as (Message & Row)[]).filter((m) => m.threadId === thread.threadId).map(({ id: _id, ...rest }) => rest as Message).sort((a, b) => a.threadSeq - b.threadSeq);
  const putMsg = (msg: Message): void => replica.put("messages", [{ id: msg.messageId, ...msg }]);

  // a thread under a message (agents reply in threads): its own row and its own messages, by id
  const rowOf = (id: string): (Thread & Row) | undefined => (replica.rows("threads") as unknown as (Thread & Row)[]).find((x) => x.threadId === id);
  replica.resolve("engine.last_pick.get", () => (variant === "lastpick" ? { model: "glm-5", provider: "opencode-go", effort: "high" } : {}) as never);
  replica.resolve("threads.get", (_t, input) => { const { id: _id, ...rest } = rowOf(input.threadId) ?? threadRow(); return { thread: rest as Thread }; });
  replica.resolve("threads.list", (_t, input) => ({ threads: (replica.rows("threads") as unknown as (Thread & Row)[]).filter((x) => input.parentThreadId !== undefined && x.parentThreadId === input.parentThreadId).map(({ id: _id, ...rest }) => rest as Thread), hasMore: false }));
  replica.resolve("chat.messages.list", (_t, input) => {
    const limit = input.limit ?? 50;
    const mine = input.threadId !== undefined && input.threadId !== thread.threadId;
    const rows = mine ? (replica.rows("messages") as unknown as (Message & Row)[]).filter((m) => m.threadId === input.threadId).map(({ id: _id, ...rest }) => rest as Message).sort((a, b) => a.threadSeq - b.threadSeq) : msgRows();
    const all = rows.filter((m) => input.before === undefined || m.threadSeq < input.before);
    return { messages: all.slice(Math.max(0, all.length - limit)), hasMore: all.length > limit };
  });
  replica.resolve("chat.helpers.list", () => ({ helpers: (replica.rows("helpers") as unknown as (Helper & Row)[]).map(({ id: _id, ...rest }) => rest as Helper) }));

  const setThread = (patch: Partial<Thread>): void => { const cur = threadRow(); replica.put("threads", [{ ...cur, ...patch }]); };
  const finishLive = (agentId?: string): void => {
    for (const m of msgRows()) {
      if ((agentId === undefined || m.author.id === agentId) && m.blocks.some((b) => b.state === "live")) putMsg({ ...m, blocks: m.blocks.map((b) => (b.state === "live" ? { ...b, state: "done" as const } : b)) });
    }
  };

  const writes: Record<string, (input: any) => unknown> = {
    "chat.post": (i: { threadId: string; body: string; idempotencyKey: string; mentions?: { kind: "person" | "agent"; id: string }[] }) => {
      const prev = msgRows();
      const msg: Message = { messageId: `srv_${++counter}`, threadId: i.threadId, threadSeq: (prev[prev.length - 1]?.threadSeq ?? 0) + 1, author: { kind: "person", id: "usr_irfad" }, kind: "text", body: i.body, blocks: [], depth: 0, attachments: [], reactions: [], pinned: false, createdAt: SAMPLE_NOW };
      putMsg(msg);
      return { message: msg };
    },
    "chat.edit": (i: { messageId: string; body: string }) => { const cur = msgRows().find((m) => m.messageId === i.messageId); if (cur) putMsg({ ...cur, body: i.body, editedAt: SAMPLE_NOW }); return { message: cur }; },
    "chat.react": (i: { messageId: string; emoji: string; remove?: boolean }) => {
      const cur = msgRows().find((m) => m.messageId === i.messageId);
      if (cur) {
        const others = cur.reactions.filter((r) => r.emoji !== i.emoji);
        const mine = cur.reactions.find((r) => r.emoji === i.emoji);
        putMsg({ ...cur, reactions: i.remove ? (mine && mine.by.length > 1 ? [...others, { emoji: i.emoji, by: mine.by.slice(1) }] : others) : [...others, { emoji: i.emoji, by: [...(mine?.by ?? []), "usr_irfad"] }] });
      }
      return { ok: true };
    },
    "chat.pin": (i: { messageId: string }) => { const cur = msgRows().find((m) => m.messageId === i.messageId); if (cur) putMsg({ ...cur, pinned: true }); return { ok: true }; },
    "chat.unpin": (i: { messageId: string }) => { const cur = msgRows().find((m) => m.messageId === i.messageId); if (cur) putMsg({ ...cur, pinned: false }); return { ok: true }; },
    "chat.delete_message": (i: { messageId: string }) => { replica.remove("messages", [i.messageId]); return { deleted: true }; },
    "chat.thread": (i: { messageId: string }) => ({ thread: { ...threadRow(), threadId: `t_${i.messageId}`, kind: "thread" } }),
    "chat.answer_block": (i: { blockId: string; answer: unknown }) => {
      for (const m of msgRows()) if (m.blocks.some((b) => b.id === i.blockId)) putMsg({ ...m, blocks: m.blocks.map((b) => (b.id === i.blockId ? { ...b, state: "done" as const, data: { ...(b.data as object), answer: i.answer } } : b)) });
      return { ok: true };
    },
    "chat.approve_plan": () => {
      for (const m of msgRows()) if (m.blocks.some((b) => b.type === "plan" && b.state === "waiting")) putMsg({ ...m, blocks: m.blocks.map((b) => (b.type === "plan" ? { ...b, state: "live" as const } : b)) });
      return { ok: true };
    },
    // the Add people and agents sheet (lane l-addsheet): the directory it reads and the calls it makes
    "threads.get": () => { const { id: _id, ...rest } = threadRow(); return { thread: rest as Thread }; },
    "files.folder.get": (i: { folderId: string }) => ({ folder: { folderId: i.folderId, name: "Client intake uploads", path: "/Client intake uploads", fileCount: 3, folderCount: 0, scope: "space", label: 0 } }),
    "search.resolve": (i: { itemId: string }) => ({ hit: { kind: "record", id: i.itemId, title: "Elena Rivera", link: `vyre://record/${i.itemId}`, score: 1 } }),
    "access.principals.list": () => ({ principals: [
      { id: "usr_irfad", kind: "person", name: "You", status: "active", roles: ["rol_owner"], groups: [], createdAt: SAMPLE_NOW },
      { id: "usr_maya", kind: "person", name: "Maya Chen", status: "active", roles: [], groups: [], title: "Partner", createdAt: SAMPLE_NOW },
      { id: "usr_omar", kind: "person", name: "Omar Haddad", status: "active", roles: [], groups: [], title: "Operations", createdAt: SAMPLE_NOW },
    ] }),
    "agents.list": () => ({ agents: ["agt_intake", "agt_docs", "agt_research", "agt_scout", "agt_billing", "out_cc"].map((id, n) => ({ agentId: id, name: id === "out_cc" ? "Claude Code" : NAMES[id] ?? id, kind: "agent", ...(id === "out_cc" ? { runtime: "outside" } : {}), face: id, status: "awake", ownerId: "usr_irfad", folderId: "fld", accountPolicy: "asker", accountFallback: [], toolsAllowed: [], toolsDenied: [], vaultKeys: [], limits: {}, captureMode: "auto", hasComputer: false, templateVersion: 1, createdAt: SAMPLE_NOW, lastActiveAt: SAMPLE_NOW - n })) }),
    "mcp.connected.list": () => ({ agents: [{ agentId: "out_cc", clientName: "Claude Code", connectedAt: SAMPLE_NOW, calls: 0 }] }),
    "mcp.connected.link": () => ({ url: "https://northwind.vyre.run/mcp", claudeCode: "claude mcp add --transport http vyre https://northwind.vyre.run/mcp" }),
    "access.check": (i: { action: { level: string } }) => ({ decision: { effect: o.viewOnly === true && i.action.level !== "view" ? "deny" : "allow", reason: "", steps: [], decisionId: "dec_1" } }),
    "channels.get": () => ({ channel: { channelId: "ch_intake", mainThreadId: thread.threadId, name: "intake", visibility: "invite", archived: false, members: threadRow().members, agents: threadRow().agents } }),
    "channels.members.add": () => ({ ok: true }),
    "threads.members.add": (i: { personId: string }) => { const cur = threadRow(); setThread({ members: [...cur.members, { kind: "person", id: i.personId }] }); return { thread: threadRow() }; },
    "threads.agent_settings.set": (i: { agentId: string; mode?: "lead" | "listen" | "quiet"; when?: "always" | "topics" | "hours"; topics?: string | null; style?: "short" | "full" }) => {
      const cur = threadRow();
      setThread({ agents: cur.agents.map((a) => (a.agentId !== i.agentId ? (i.mode === "lead" && a.mode === "lead" ? { ...a, mode: "listen" as const } : a) : { ...a, ...(i.mode !== undefined ? { mode: i.mode === "lead" ? ("lead" as const) : ("listen" as const), quiet: i.mode === "quiet" } : {}), ...(i.when !== undefined ? { when: i.when } : {}), ...(i.style !== undefined ? { style: i.style } : {}) })) });
      return { thread: threadRow() };
    },
    "threads.agent.create": (i: { name: string; mode?: "lead" | "listen" | "quiet" }) => {
      const cur = threadRow();
      const id = `agt_new${++counter}`;
      NAMES[id] = i.name;
      KINDS[id] = "agent";
      setThread({ agents: [...cur.agents, { agentId: id, mode: "listen", quiet: i.mode === "quiet", owned: true }], members: [...cur.members, { kind: "agent", id }] });
      return { thread: threadRow(), agentId: id };
    },
    "threads.outside_agent.add": (i: { agentId: string }) => { const cur = threadRow(); NAMES[i.agentId] = "Claude Code"; setThread({ agents: [...cur.agents, { agentId: i.agentId, mode: "listen" }], members: [...cur.members, { kind: "agent", id: i.agentId }] }); return { thread: threadRow() }; },
    "threads.outside_agent.remove": (i: { agentId: string }) => { const cur = threadRow(); setThread({ agents: cur.agents.filter((a) => a.agentId !== i.agentId), members: cur.members.filter((m) => m.id !== i.agentId) }); return { thread: threadRow() }; },
    "threads.invite_guest": () => ({ inviteId: "inv_1", link: "https://northwind.vyre.run/join/inv_1" }),
    "threads.poke": (i: { agentId: string; note?: string }) => {
      const prev = msgRows();
      const seq = (prev[prev.length - 1]?.threadSeq ?? 0) + 1;
      putMsg({ messageId: `poke_${++counter}`, threadId: thread.threadId, threadSeq: seq, author: { kind: "person", id: "usr_irfad" }, kind: "quiet", body: `You poked ${NAMES[i.agentId] ?? i.agentId}`, blocks: [{ type: "poke", v: 1, id: `bp_${counter}`, data: { agentId: i.agentId, by: "usr_irfad" }, state: "done", traceId: "tr_poke" }], depth: 0, attachments: [], reactions: [], pinned: false, createdAt: SAMPLE_NOW } as Message);
      putMsg({ messageId: `pokeR_${counter}`, threadId: thread.threadId, threadSeq: seq + 1, author: { kind: "agent", id: i.agentId }, kind: "agent", body: "Here is where it stands: the letter is drafted and waiting on Maya.", blocks: [{ type: "poked", v: 1, id: `bq_${counter}`, data: { agentId: i.agentId, by: "usr_irfad" }, state: "done", traceId: "tr_poke" }], depth: 0, attachments: [], reactions: [], pinned: false, createdAt: SAMPLE_NOW + 1000 } as Message);
      return { messageId: `poke_${counter}`, delivered: "engine" };
    },
    "engine.interrupt": () => ({ ok: true }),
    "engine.models.list": () => ({ models: [
      { provider: "anthropic", model: "opus", title: "Opus", driver: "claude_code", allowed: true },
      { provider: "anthropic", model: "sonnet", title: "Sonnet", driver: "claude_code", allowed: true },
      { provider: "anthropic", model: "haiku", title: "Haiku", driver: "claude_code", allowed: true },
      { provider: "local", model: "llama-3.3", title: "Llama 3.3 on this computer", driver: "local", allowed: true },
    ] }),
    "engine.set_model": (i: { agentId?: string; model: string; provider: string }) => {
      const cur = threadRow();
      setThread({ agents: cur.agents.map((a) => (a.agentId === i.agentId ? { ...a, model: i.model } : a)) });
      return { model: i.model, provider: i.provider };
    },
    "changesets.approve": () => ({ approved: true }),
    "changesets.discard": () => ({ discarded: true }),
    "changesets.request_changes": () => ({ sent: 1 }),
    "chat.plan.reject": () => ({ ok: true }),
    "engine.stop": (i: { agentId?: string }) => { finishLive(i.agentId); return { stopped: true }; },
    "engine.stop_all": () => { finishLive(); return { stopped: true }; },
    "engine.set_mode": (i: { agentId: string; mode: "lead" | "listen" }) => {
      const cur = threadRow();
      const agents = cur.agents.map((a) => (a.agentId === i.agentId ? { ...a, mode: i.mode } : i.mode === "lead" && a.mode === "lead" ? { ...a, mode: "listen" as const } : a));
      setThread({ agents });
      return { mode: i.mode, leadAgentId: agents.find((a) => a.mode === "lead")?.agentId ?? null };
    },
    "threads.add_agent": (i: { agentId: string; mode?: "lead" | "listen" }) => { const cur = threadRow(); setThread({ agents: [...cur.agents, { agentId: i.agentId, mode: i.mode ?? "listen" }], members: [...cur.members, { kind: "agent", id: i.agentId }] }); return { ok: true }; },
    "threads.remove_agent": (i: { agentId: string }) => { const cur = threadRow(); setThread({ agents: cur.agents.filter((a) => a.agentId !== i.agentId), members: cur.members.filter((m) => m.id !== i.agentId) }); return { ok: true }; },
    // where agents reply (lane l-threadreplies): the chat's own row carries the choice
    "threads.set_agent_replies": (i: { threadId: string; inThreads: boolean }) => { setThread({ agentRepliesInThreads: i.inThreads }); return { thread: threadRow() }; },
    "threads.set_plan_mode": (i: { planMode: boolean }) => { setThread({ planMode: i.planMode }); return { planMode: i.planMode }; },
    "threads.make_channel": () => ({ channelId: "ch_new" }),
    "threads.reopen": () => { const { closedAt: _c, ...rest } = threadRow(); replica.put("threads", [rest]); return { ok: true }; },
    "engine.turn.retry": () => ({ turn: { turnId: "turn_10" } }),
    // where the chat runs: each of the person's computers with its real state, the Space, their server (lane l-runson)
    "engine.placement.options": () => ({
      private: true, pinned: true, effective: { target: "device", deviceId: "dev_mac" }, automatic: { target: "device", deviceId: "dev_imac" },
      options: [
        { target: "device", deviceId: "dev_mac", current: true, name: "This computer", online: false, reason: "Off" },
        { target: "device", deviceId: "dev_imac", name: "Office iMac", online: true },
        { target: "space", name: "The Space", online: true },
        { target: "server", serverId: "srv_home", name: "home-box", online: false, reason: "Off" },
      ],
    }),
    "engine.placement.set": (i: { target: string; once?: boolean }) => ({ target: i.target }),
    "engine.turn.get": (i: { turnId: string }) => ({ what: {
      turn: { turnId: i.turnId, threadId: "c1", agentId: "agt_intake", asker: "usr_irfad", engine: "claude_code", model: "opus", state: "failed", traceId: "tr_r9", startedAt: at(9, 41), endedAt: at(9, 52), tokensIn: 0, tokensOut: 0, costMicros: 0,
        error: { code: "turn_timeout", message: "That took too long, so it was stopped.", next: [], traceId: "tr_r9" }, ranOn: [{ kind: "computer", name: "Irfad's MacBook" }, { kind: "space", name: "the Northwind server" }] },
      machine: "device", steps: [], denials: [], fallbacks: [],
    } }),
  };

  const nav: ConversationNav = {
    openAgent: (id) => void opened.push(`agent:${id}`),
    openThread: (id) => void opened.push(`thread:${id}`),
    togglePane: () => void opened.push("pane"),
    openBeside: (kind, id) => void opened.push(`beside:${kind}:${id}`),
  };
  const connection: Connection = { get: () => (online ? "online" : "offline"), subscribe: (l) => { listeners.add(l); return () => void listeners.delete(l); } };

  const stream = createStreamStore(manual);
  const streamText = o.streamText ?? HELD_TEXT;
  if (variant === "streaming") { stream.push(streamText); flush(); }
  const liveId = "m7";

  const data: ConversationData = {
    screens: createScreenHooks(replica, screensById),
    async call(cap, input) {
      calls.push({ cap, input });
      if (failing.delete(cap)) throw new Error(`${cap} failed`);
      const w = writes[cap];
      if (!w) throw new Error(`no write for ${cap}`);
      if (cap === "chat.post" && held) await new Promise<void>((resolve) => held!.push(resolve));
      return w(input);
    },
    connection,
    threadId: thread.threadId,
    me: { id: "usr_irfad", name: "Irfad Imtiaz" },
    nameOf: (id) => NAMES[id] ?? id,
    kindOf: (id) => KINDS[id] ?? "person",
    nav,
    clock: () => ({ now: SAMPLE_NOW, offsetMin: 0 }),
    lists: {
      people: [{ t: "Maya Chen", s: "Partner" }, { t: "Omar Haddad", s: "Operations" }],
      agents: [{ t: "Intake", s: "Books consults and gathers client details" }, { t: "Docs", s: "Drafts and reviews documents" }, { t: "Research", s: "Finds and compares things" }, { t: "Scout", s: "Searches records" }, { t: "Billing", s: "Invoices and reminders" }],
      commands: ["later", "memory", "fork"],
    },
    directory: DIRECTORY.filter((c) => c.id !== "usr_irfad"),
    newKey: () => `key_${++counter}`,
    streamOf: (id) => (variant === "streaming" && id === liveId ? stream : undefined),
    copy: (t) => void copied.push(t),
    toast: (t) => void toasts.push(t),
  };
  return {
    data, replica, calls, opened, copied, toasts, stream,
    setOnline(v) { online = v; for (const l of [...listeners]) l(); },
    failNext(cap) { failing.add(cap); },
    holdPosts() { held = []; },
    releasePosts() { const h = held; held = null; for (const r of h ?? []) r(); },
    push(delta) { stream.push(delta); flush(); },
  };
}
