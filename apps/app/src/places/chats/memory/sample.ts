// The sample behind the chat's memory tests and screenshots: the Brooks weekly update chat of the approved mockup (Assistant, Ian Brooks, three recalled memories, an exact quote, a Learned line)
// as a conversation sample whose messages are replaced, over the Knowledge sample's facts and pages. Reads of the memory capabilities answer from the Knowledge sample's resolvers; writes change its
// rows (and so the next read). Nothing here is used by the app.
import type { Row } from "../../../../../../client/src/index.ts";
import { KNOW_NOW, createKnowSample } from "../../files/memory/sample-know.ts";
import type { KnowSample } from "../../files/memory/sample-know.ts";
import { createSample } from "../conversation/sample.ts";
import type { Sample } from "../conversation/sample.ts";
import type { ConversationData } from "../conversation/data.tsx";
import type { Message } from "../conversation/model.ts";
import { createSample as createPaneSample } from "../rightpane/sample.ts";
import type { ChatRightPaneData } from "../rightpane/data.tsx";
import { createMemoryStore } from "./data.tsx";
import type { ChatMemoryData } from "./data.tsx";

const T = (d: number, h: number, m = 0): number => Date.UTC(2025, 9, d, h, m);
const CHAT_THREAD = "c1";
/** The thread id the Knowledge sample's links and recalled replies use for this chat. */
export const KNOW_THREAD = "thr_k2";
export const ME = "usr_irfad";
export const ASSISTANT = "agt_assistant";

const NAMES: Record<string, string> = { usr_irfad: "Irfad Imtiaz", usr_maya: "Maya Chen", usr_omar: "Omar Haddad", agt_assistant: "Assistant", agt_intake: "Intake", agt_docs: "Docs", agt_billing: "Billing", agt_scout: "Scout", agt_research: "Research" };

export const MESSAGE_IDS = { ask: "msg_k2_0", reply: "msg_k2_1", told: "msg_k2_2", held: "msg_k2_3" } as const;

const REPLY = "Here is the update for Ian Brooks. It is three bullets and no attachment, and it goes out after 9:00 his time.\n\n- Kickoff is done, and the logistics dashboard is on track for Nov 14.\n- The Growth plan is unchanged this month.\n- Next update: Friday.\n\nI have two addresses for Ian. Which should I use?";

function messages(): Message[] {
  const base = { threadId: CHAT_THREAD, blocks: [], depth: 0, attachments: [], reactions: [], pinned: false } as const;
  return [
    { ...base, messageId: MESSAGE_IDS.ask, threadSeq: 1, author: { kind: "person", id: ME }, kind: "text", body: "Draft this week's update for Ian Brooks.", createdAt: T(24, 9, 31) },
    {
      ...base, messageId: MESSAGE_IDS.reply, threadSeq: 2, author: { kind: "agent", id: ASSISTANT }, kind: "agent", body: REPLY, createdAt: T(24, 9, 31),
      blocks: [
        { type: "step", v: 1, id: "s1", data: { title: "Recalled what it knows about Ian Brooks", sub: "3 memories, only what you can open yourself", secs: 3 }, state: "done", traceId: "tr_s1" },
        { type: "step", v: 1, id: "s2", data: { title: "Drafted the update", sub: "three bullets, no attachment", secs: 3 }, state: "done", traceId: "tr_s2" },
      ],
    },
    { ...base, messageId: MESSAGE_IDS.told, threadSeq: 3, author: { kind: "person", id: ME }, kind: "text", body: "Ian told me today he prefers updates on Fridays. Hold it until then.", createdAt: T(24, 9, 37) },
    { ...base, messageId: MESSAGE_IDS.held, threadSeq: 4, author: { kind: "agent", id: ASSISTANT }, kind: "agent", body: "Held. It will go out **Friday at 9:00** his time, to the address you pick on his page.", createdAt: T(24, 9, 38) },
  ] as unknown as Message[];
}

export interface ChatMemorySample {
  conv: Sample;
  know: KnowSample;
  data: ConversationData;
  memory: ChatMemoryData;
  /** The right pane's data for the same chat: the assistant, the same memory store, and this chat's messages (so the Knows tab can tell which reply was the last). */
  pane: ChatRightPaneData;
  /** What the nav handlers were asked to open: "link:...", "page:...", "graph:...", "knowledge", "source:...", "knows". */
  opened: string[];
  /** Capability calls the memory store made (reads and writes), in order. */
  calls: Array<{ cap: string; input: unknown }>;
  /** Every cap the chat asked for that the sample has no answer for goes here and rejects, as an older server would. */
  absent: Set<string>;
  /** Reads the store should have in its cache before a static render (a render runs no effects). */
  warm(extra?: Array<[string, unknown]>): Promise<void>;
}

/** The person's profile as memory.profile.get answers it for a chat: the private part only when nobody else reads the chat. */
export function aboutYou(audience: "private" | "shared") {
  const at = KNOW_NOW - 4 * 86_400_000;
  const fact = (factId: string, text: string, place: "public" | "private", extra: Record<string, unknown> = {}) => ({ factId, text, place, layer: "person", ownerRef: ME, status: "current", sourceKind: "chat", sourceRef: KNOW_THREAD, validFrom: at, learnedAt: at, ...extra });
  return {
    audience, basics: [],
    public: [fact("fct_about_pub", "Prefers short client emails with no exclamation marks.", "public", { lineLink: `vyre://thread/${KNOW_THREAD}?m=msg_about1` })],
    private: audience === "private" ? [fact("fct_about_priv", "Picks up the kids at 3:30 on Thursdays.", "private"), fact("fct_about_sug", "Out of office every second Friday.", "private", { suggested: true })] : [],
  };
}

/** The lessons the sample's Assistant kept from the person's corrections (kind lesson), as memory.facts.list answers them. One was caught on the held reply's line. */
export const LESSON_IDS = { sara: "fct_lesson_sara", dollars: "fct_lesson_dollars" } as const;
export function lessonRows(): Array<Record<string, unknown>> {
  const base = { layer: "person", ownerRef: ME, agentId: ASSISTANT, kind: "lesson", status: "current", sourceKind: "chat", sourceRef: KNOW_THREAD, validFrom: KNOW_NOW - 86_400_000, lowRisk: false };
  return [
    { ...base, factId: LESSON_IDS.sara, text: "Notes to Sara: three lines, the number first.", learnedAt: KNOW_NOW - 3_600_000, sourceLink: `/chats/${KNOW_THREAD}#${MESSAGE_IDS.held}`, by: ME, byKind: "person", lesson: { how: "refuse", used: 1, scope: "you" } },
    { ...base, factId: LESSON_IDS.dollars, text: "Round money in notes to whole dollars.", learnedAt: KNOW_NOW - 9 * 86_400_000, sourceLink: `/chats/${KNOW_THREAD}#msg_old`, by: ME, byKind: "person", lesson: { how: "rewrite", used: 4, scope: "space" } },
  ];
}

export interface ChatMemoryOptions { /** The Assistant has kept lessons from corrections, and the switch "Learn from my corrections" is on. */ lessons?: boolean; fail?: string; withoutCaps?: string[]; noMemory?: boolean; /** Who reads this chat, for About you at the top of Knows: only you (default) or other people too. */ audience?: "private" | "shared" }

export function createChatMemorySample(o: ChatMemoryOptions = {}): ChatMemorySample {
  const conv = createSample("idle");
  const know = createKnowSample({ now: KNOW_NOW });
  conv.replica.remove("messages", ["m1", "e1", "m2", "m3", "m4", "m5"]);
  const thread = (conv.replica.rows("threads") as unknown as Array<Row & { threadId: string }>)[0]!;
  conv.replica.put("threads", [{ ...thread, title: "Brooks weekly update", agents: [{ agentId: ASSISTANT, mode: "lead", model: "opus" }], members: [{ kind: "person", id: ME }, { kind: "agent", id: ASSISTANT }] } as unknown as Row]);
  conv.replica.put("messages", messages().map((m) => ({ id: m.messageId, ...m }) as unknown as Row));

  // the fact the last reply taught came from that reply's line
  const state = know.snapshot();
  for (const f of state.facts) if (f.text === "Prefers updates on Fridays." && f.status === "current") { f.sourceRef = MESSAGE_IDS.held; f.sourceLink = `vyre://thread/${KNOW_THREAD}?m=${MESSAGE_IDS.held}`; }
  know.replica.put("state", [{ id: "s", ...state } as unknown as Row]);

  const opened: string[] = [];
  const calls: Array<{ cap: string; input: unknown }> = [];
  const absent = new Set<string>(o.withoutCaps ?? []);
  const tr = (input: unknown): unknown => (input && typeof input === "object" && (input as { threadId?: string }).threadId === CHAT_THREAD ? { ...(input as object), threadId: KNOW_THREAD } : input);
  const READS = new Set(["memory.used", "memory.knows", "memory.quote", "memory.learned", "memory.page.list", "memory.page.get", "memory.facts.list", "memory.map.get", "memory.counts"]);
  // lessons: their own little backend (the Knowledge sample knows no lessons): the list, the switch, sharing, the instruction and the undo of each
  const lessons = lessonRows();
  const gone = new Set<string>();
  const sw = { on: true };
  const lessonCall = (cap: string, input: unknown): unknown => {
    const i = (input ?? {}) as Record<string, unknown>;
    switch (cap) {
      case "memory.facts.list": return i["kind"] === "lesson" ? { facts: sw.on ? lessons.filter((l) => !gone.has(String(l["factId"]))) : [], total: 2 } : undefined;
      case "settings.get": return i["key"] === "memory.lessons" ? { row: { key: "memory.lessons", value: sw.on } } : undefined;
      case "settings.set": if (i["key"] !== "memory.lessons") return undefined; sw.on = i["value"] === true; return { row: { value: sw.on }, previous: !sw.on };
      case "memory.promote": { const l = lessons.find((x) => x["factId"] === i["factId"])!; (l["lesson"] as { scope: string }).scope = "proposed"; return { promotionId: "prm_1", promoted: false, taskId: "tsk_1" }; }
      case "agents.instruction.append": return { agent: {}, added: true, versionId: "ver_2", undoVersionId: "ver_1" };
      case "agents.restore_version": return { agent: {} };
      case "memory.forget": { for (const id of (i["factIds"] as string[]) ?? []) gone.add(id); return undefined; }
      case "memory.restore": gone.delete(String(i["factId"])); return undefined;
      case "memory.undo": if (!lessons.some((l) => l["factId"] === i["factId"])) return undefined; gone.add(String(i["factId"])); return { fact: {}, trashed: true };
      default: return undefined;
    }
  };
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input });
    if (absent.has(cap)) throw new Error(`unknown capability ${cap}`);
    if (o.lessons) {
      const r = lessonCall(cap, input);
      if (r !== undefined) return r;
      const mine = lessons.filter((l) => !gone.has(String(l["factId"])));
      const asked = (input ?? {}) as { threadId?: string; messageId?: string };
      if (cap === "memory.learned") { const base = (await baseCall(cap, input)) as { items: unknown[]; total?: number }; const items = [...mine.filter((l) => String(l["sourceLink"]).endsWith(`#${MESSAGE_IDS.held}`)).map((l) => ({ fact: l, at: l["learnedAt"], what: "learned", actor: ASSISTANT, actorKind: "agent", sourceKind: "chat", sourceRef: KNOW_THREAD, undone: false })), ...base.items]; return { ...base, items }; }
      if (cap === "memory.used" && asked.messageId === MESSAGE_IDS.reply) { const base = (await baseCall(cap, input)) as { facts: unknown[] }; return { ...base, facts: [...mine.slice(0, 1), ...base.facts] }; }
    }
    return baseCall(cap, input);
  };
  const baseCall = async (cap: string, input: unknown): Promise<unknown> => {
    if (absent.has(cap)) throw new Error(`unknown capability ${cap}`);
    if (cap === "memory.profile.get") return aboutYou(o.audience ?? "private");
    if (o.fail && !READS.has(cap)) throw new Error(o.fail);
    if (READS.has(cap)) {
      const snap = know.data.live(cap as never, tr(input) as never).getSnapshot() as { status: string; data?: unknown };
      if (snap.status !== "ready") throw new Error(`unknown capability ${cap}`);
      return snap.data;
    }
    return know.data.call(cap, tr(input));
  };
  const store = createMemoryStore(call);
  const memory: ChatMemoryData = {
    store, now: () => KNOW_NOW, me: { id: ME, name: NAMES[ME]! }, nameOf: (id) => NAMES[id] ?? id,
    nav: {
      openLink: (l) => void opened.push(`link:${l}`), openPage: (id) => void opened.push(`page:${id}`), openGraph: (id) => void opened.push(`graph:${id}`),
      openKnowledge: () => void opened.push("knowledge"), openSource: (k, r) => void opened.push(`source:${k}:${r}`), openAboutYou: () => void opened.push("about-you"),
    },
    showKnows: () => void opened.push("knows"),
  };
  const data: ConversationData = {
    ...conv.data, nameOf: (id) => NAMES[id] ?? id, kindOf: (id) => (id.startsWith("agt_") ? "agent" : "person"),
    ...(o.noMemory ? {} : { memory }),
  };
  const paneSample = createPaneSample("personal");
  paneSample.replica.resolve("chat.messages.list", () => ({ messages: messages(), hasMore: false }));
  const pane: ChatRightPaneData = { ...paneSample.data, threadId: CHAT_THREAD, agent: { agentId: ASSISTANT, name: "Assistant" }, space: { name: "Northwind", personal: false }, memory };
  const sample: ChatMemorySample = {
    conv, know, data, memory, pane, opened, calls, absent,
    async warm(extra = []) {
      const reads: Array<[string, unknown]> = [
        ["memory.page.list", {}], ["memory.learned", { threadId: CHAT_THREAD, limit: 200 }], ["memory.used", { threadId: CHAT_THREAD, messageId: MESSAGE_IDS.reply }],
        ["memory.used", { threadId: CHAT_THREAD, messageId: MESSAGE_IDS.held }], ...extra,
      ];
      for (const [cap, input] of reads) await store.read(cap, input).catch(() => undefined);
    },
  };
  return sample;
}
