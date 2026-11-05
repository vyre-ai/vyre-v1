// Mount for lane l-models, scene crewmodels (p-crew.js, 4 Nov 2026): the real chat feed after "Get two helpers: one on GPT-6 from my OpenAI, one on GLM from the Space OpenCode". The strip's header names who runs on
// which model, and each row says the model and the account that pays. ?part=strip (both working) | done (both finished, with the answer) | same (two helpers on one model: no header line)
// The query is read after mount (rule 25). engine.crew.status is scripted; every other read goes to the sample.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import { createSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";
import type { Message } from "../../../apps/app/src/places/chats/conversation/model.ts";

export const title = "Two helpers on two models";

interface RootLike { setAttribute(name: string, value: string): void; style: { setProperty(name: string, value: string): void; removeProperty(name: string): void } }
type Call = (cap: string, input: unknown) => Promise<unknown>;

const ASK = "Get two helpers: one on GPT-6 from my OpenAI to compare the quotes, one reading northwind.com with GLM from the Space OpenCode.";

function members(parent: string, part: string): unknown {
  const now = Date.now();
  const done = part === "done";
  const row = (id: string, title: string, model: string, accountLabel: string, o: Record<string, unknown>) => ({
    kind: "helper", id, parentThreadId: parent, title, agentId: "agt_intake", state: done ? "done" : "working", startedAt: now - (done ? 70_000 : 41_000), ...(done ? { endedAt: now - 2000 } : {}),
    elapsedMs: done ? 68_000 : 41_000, model, accountLabel, why: "you asked", tokensIn: 9_800, tokensOut: 620, costMicros: 41_000, ...o,
  });
  const orin = row("thr_orin", "Compare quotes", part === "same" ? "gpt-6" : "gpt-6", "OpenAI · Irfad's OpenAI", done ? { found: "Harbor is $260 higher up front, but ready two weeks sooner." } : { step: "Reading the Pine Works quote" });
  const pia = row("thr_pia", "northwind.com", part === "same" ? "gpt-6" : "glm-5.2", part === "same" ? "OpenAI · Irfad's OpenAI" : "OpenCode Go · Space OpenCode", done ? { found: "Northwind lists a 4-week onboarding with one named contact." } : { step: "Reading northwind.com" });
  const list = [orin, pia];
  const by = (s: string) => list.filter((m) => m.state === s).length;
  return { members: list, totals: { members: 2, working: by("working"), done: by("done"), needsYou: 0, failed: 0, stopped: 0, tokensIn: 19_600, tokensOut: 1_240, costMicros: 82_000, filesChanged: 0, added: 0, deleted: 0, elapsedMs: done ? 68_000 : 41_000 } };
}

function Chat({ part, skin }: { part: string; skin: string }): ReactNode {
  const data = useMemo(() => {
    const root = (globalThis as { document?: { documentElement?: RootLike } }).document?.documentElement;
    const themeRoot: ThemeRoot = { setAttribute: (n, v) => { root?.setAttribute(n, v); }, setProperty: (n, v) => { root?.style.setProperty(n, v); }, removeProperty: (n) => { root?.style.removeProperty(n); } };
    createThemeController({ personId: "irfad", spaceId: "nw", spaceSkin: { nw: skin }, prefersDark: skin === "graphite", root: themeRoot, storage: null });
    const s = createSample("idle");
    const rows = (s.replica.rows("messages") as unknown as (Message & { id: string })[]).filter((m) => m.threadId === s.data.threadId).sort((a, b) => a.threadSeq - b.threadSeq);
    const last = rows[rows.length - 1]!;
    s.replica.remove("messages", rows.map((m) => m.id));
    const mk = (n: number, author: Message["author"], body: string, blocks: unknown[] = []): Message => ({ messageId: `msg_cm_${n}`, threadId: s.data.threadId, threadSeq: last.threadSeq + n, author, kind: author.kind === "agent" ? "agent" : "person", body, depth: 0, attachments: [], reactions: [], pinned: false, createdAt: last.createdAt + n * 60_000, blocks } as unknown as Message);
    const helper = (id: string, t: string) => ({ type: "helper", v: 1, id: `blk_${id}`, state: part === "done" ? "done" : "running", traceId: "tr", data: { helperThreadId: id, threadId: id, title: t, agentId: "agt_intake", status: part === "done" ? "done" : "working" } });
    const strip = { type: "crew_strip", v: 1, id: "blk_strip", state: "done", traceId: "tr", data: { blocks: [helper("thr_orin", "Compare quotes"), helper("thr_pia", "northwind.com")], ...(part === "done" ? { after: "Harbor costs $260 more up front, but Pine's setup fee closes most of that gap, and Harbor is ready two weeks sooner. Northwind's own page says onboarding takes four weeks, which makes Harbor's two weeks the better fit." } : {}) } };
    const msgs = [mk(1, { kind: "person", id: s.data.me.id } as Message["author"], ASK), mk(2, { kind: "agent", id: "agt_intake" } as Message["author"], "Two helpers. One compares the quotes on GPT-6 from your OpenAI account, one reads northwind.com on GLM 5.2 from the Space OpenCode.", [strip])];
    s.replica.put("messages", msgs.map((m) => ({ id: m.messageId, ...m })));
    const own: Call = async (cap) => (cap === "engine.crew.status" ? members(s.data.threadId, part) : undefined);
    const real = s.data.call as Call;
    return { ...s.data, call: (async (cap: string, input: unknown) => { const v = await own(cap, input); return v === undefined ? real(cap, input) : v; }) as never };
  }, [part, skin]);
  return <View testID="crewmodels-chat" style={{ flex: 1, backgroundColor: "var(--win)" as string }}><Conversation data={data} /></View>;
}

export default function Mount(): ReactNode {
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  const q = new URLSearchParams(search);
  return <Chat part={q.get("part") ?? "strip"} skin={q.get("skin") ?? "paper"} />;
}
