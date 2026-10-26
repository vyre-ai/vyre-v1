// The sample helper behind the helper chat tests and screenshots: Research's "Firms 1-3" helper (done, three steps) and "Supplier mirrors" (still running), filled from the
// prototype. A fake replica holds the thread and its messages; engine.stop closes the thread, so Stop really works in a mount.
import { createFakeReplica, createScreenHooks } from "../../../../../../client/src/index.ts";
import type { FakeReplica, Row } from "../../../../../../client/src/index.ts";
import { screensById } from "../../../../../../generated/screens.ts";
import { namesFor, nameOf } from "../../../fixtures/index.ts";
import type { Connection, HelperChatData, HelperNav } from "./data.tsx";
import type { Message, Thread } from "./model.ts";

/** Friday 24 October 2025, 10:00 (UTC, so every machine prints the same times). */
export const SAMPLE_NOW = Date.UTC(2025, 9, 24, 10, 0, 0);
const at = (h: number, min: number, sec = 0): number => Date.UTC(2025, 9, 24, h, min, sec);

export type Variant = "done" | "running";

export const NAMES: Record<string, string> = namesFor("northwind", { usr_irfad: "You" });

function build(variant: Variant): { thread: Thread; messages: Message[] } {
  const done = variant === "done";
  const parent = done ? { title: "Competitor pricing", threadId: "c2" } : { title: "Supplier records search", threadId: "c6" };
  const agent = done ? "agt_research" : "agt_scout";
  const title = done ? "Firms 1–3" : "Supplier mirrors";
  const started = done ? at(9, 20) : at(9, 56);
  const thread: Thread = {
    threadId: done ? "h1" : "h4", kind: "helper", title, parentThreadId: parent.threadId, listed: false, planMode: false, members: [{ kind: "agent", id: agent }],
    agents: [{ agentId: agent, mode: "lead", model: "haiku" }], createdAt: started, path: [parent, { title, threadId: done ? "h1" : "h4" }],
    ...(done ? { closedAt: started + 31_000 } : {}),
  };
  const step = (n: number, t: string, sub: string, state: "live" | "done"): Message["blocks"][number] => ({ type: "step", v: 1, id: `s${n}`, data: { title: t, sub }, state, traceId: `tr_s${n}` });
  const msg = (n: number, seq: number, author: string, body: string, createdAt: number, blocks: Message["blocks"] = []): Message => ({
    messageId: `m${n}`, threadId: thread.threadId, threadSeq: seq, author: { kind: "agent", id: author }, kind: "agent", body, blocks, depth: 0, attachments: [], reactions: [], pinned: false, createdAt,
  });
  const messages: Message[] = done
    ? [
      msg(1, 1, agent, "Read the pricing pages of Harlow & Price, Grant Legal and Meyer Law. Return consult price, free-consult policy and the page link for each.", started),
      msg(2, 2, agent, "Harlow & Price $300 · Grant Legal free first 30 min · Meyer Law $250", started + 31_000, [
        step(1, "Opened harlowprice.example/pricing", "headless Chrome", "done"), step(2, "Opened grantlegal.example/fees", "headless Chrome", "done"), step(3, "Opened meyerlaw.example/consult", "headless Chrome", "done"),
      ]),
    ]
    : [
      msg(1, 1, agent, "While the main supplier site needs a login, check the three public mirror sites for the same parcel records and return what's there.", started),
      msg(2, 2, agent, "", started + 20_000, [step(1, "Opened records.supplier-mirror-1.example", "headless Chrome", "done"), step(2, "Searching parcel 104-22-009", "headless Chrome", "live")]),
    ];
  return { thread, messages };
}

export interface Sample {
  data: HelperChatData;
  replica: FakeReplica;
  calls: { cap: string; input: unknown }[];
  /** what the nav handlers were asked to open */
  opened: string[];
  setOnline(online: boolean): void;
  failNext(cap: string): void;
}

export function createSample(variant: Variant = "done", o: { online?: boolean } = {}): Sample {
  const replica = createFakeReplica("northwind");
  const calls: { cap: string; input: unknown }[] = [];
  const opened: string[] = [];
  const failing = new Set<string>();
  const listeners = new Set<() => void>();
  let online = o.online ?? true;
  const { thread, messages } = build(variant);
  replica.put("threads", [{ id: thread.threadId, ...thread }]);
  replica.put("messages", messages.map((m) => ({ id: m.messageId, ...m })));
  replica.resolve("threads.get", (_t, input) => {
    const r = (replica.rows("threads") as unknown as (Thread & Row)[]).find((x) => x.threadId === input.threadId);
    if (!r) throw new Error("no such thread");
    const { id: _id, ...rest } = r;
    return { thread: rest as Thread };
  });
  replica.resolve("chat.messages.list", (_t, input) => ({
    messages: (replica.rows("messages") as unknown as (Message & Row)[]).filter((m) => m.threadId === input.threadId).map(({ id: _id, ...rest }) => rest as Message),
    hasMore: false,
  }));
  const writes: Record<string, (input: any) => unknown> = {
    "engine.stop": (i: { threadId: string }) => {
      const cur = (replica.rows("threads") as unknown as (Thread & Row)[]).find((x) => x.threadId === i.threadId);
      if (cur) replica.put("threads", [{ ...cur, closedAt: SAMPLE_NOW }]);
      return { stopped: true };
    },
  };
  const nav: HelperNav = { openThread: (id) => void opened.push(`thread:${id}`) };
  const connection: Connection = { get: () => (online ? "online" : "offline"), subscribe: (l) => { listeners.add(l); return () => void listeners.delete(l); } };
  const data: HelperChatData = {
    screens: createScreenHooks(replica, screensById),
    async call(cap, input) {
      calls.push({ cap, input });
      if (failing.delete(cap)) throw new Error(`${cap} failed`);
      const w = writes[cap];
      if (!w) throw new Error(`no write for ${cap}`);
      return w(input);
    },
    connection,
    threadId: thread.threadId,
    nameOf: (id) => NAMES[id] ?? nameOf("northwind", id),
    nav,
    clock: () => ({ now: SAMPLE_NOW, offsetMin: 0 }),
  };
  return {
    data, replica, calls, opened,
    setOnline(v) { online = v; for (const l of [...listeners]) l(); },
    failNext(cap) { failing.add(cap); },
  };
}
