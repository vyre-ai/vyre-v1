// Mount for SESSION_01 (lane l-session): a long running session as the prototype's "rc.22.1 launch night" draws it, in the real Chats place: the compact crew block, hour marks, quiet messages folded into
// "While you were away", jump rows, and the session Overview in the right pane. The conversation sample is the idle chat plus a night of traffic after it; the crew, the goal and the context come from small
// stand-ins for engine.crew.status, goals.list and engine.usage.get.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { ChatsPlace } from "../../../apps/app/src/places/chats/ChatsPlace.tsx";
import { createSample as createConversationSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";
import { createSample as createPaneSample } from "../../../apps/app/src/places/chats/rightpane/sample.ts";
import { createSampleSidebar, northwind } from "../../../apps/app/src/places/chats/sidebar/sample.ts";
import type { Message, MessageBlock } from "../../../apps/app/src/places/chats/conversation/model.ts";

export const title = "A long running session";

// the night ended 14 minutes ago, so every time in it is relative to now and nothing reads years
const START = Date.now() - (285 + 14) * 60_000;
const at = (h: number, m: number, day = 0): number => START + (h * 60 + m + day * 1440 - 1200) * 60_000;
const ME = { kind: "person" as const, id: "usr_irfad" };
const MAYA = { kind: "person" as const, id: "usr_maya" };
const AGENTS = ["agt_intake", "agt_docs", "agt_research", "agt_scout"].map((id) => ({ kind: "agent" as const, id }));
const INTAKE = AGENTS[0]!;
const block = (type: string, id: string, data: Record<string, unknown>, state?: MessageBlock["state"]): MessageBlock => ({ type, v: 1, id, data, ...(state ? { state } : {}), traceId: `tr_${id}` } as MessageBlock);

const CREW = [
  { id: "thr_tess", name: "Tess", title: "Server fixes", agentId: "agt_docs", state: "done", min: 18, found: "74 tests pass on the lane box.", files: [{ path: "images/vyred/compose.server.yml", added: 5, deleted: 0 }, { path: "scripts/install/linux/vyre-server", added: 81, deleted: 16 }], steps: ["Added seccomp and apparmor to the Space compose file", "vyre-server now hands off to the current release", "74 tests pass on the lane box"] },
  { id: "thr_orin", name: "Orin", title: "Chrome extension", agentId: "agt_research", state: "working", min: 7, step: "Writing the version check for the side panel", files: [{ path: "apps/chrome/src/panel.rs", added: 23, deleted: 2 }], steps: ["Registered the connector for Comet, Arc and Brave", "Writing the version check for the side panel", "Running ext-panel.test.ts"] },
  { id: "thr_kai", name: "Kai", title: "Composer polish", agentId: "agt_scout", state: "needs_you", min: 12, step: "Asked you: 12 px or 14 px corners", files: [{ path: "ui/src/Composer/index.tsx", added: 12, deleted: 4 }], steps: ["One-line composer in every place", "Island docked above the composer", "Asked you: 12 px or 14 px corners"] },
  { id: "thr_juno", name: "Juno", title: "Context windows", agentId: "agt_billing", state: "done", min: 11, found: "Docs updated.", files: [{ path: "docs/context-windows.md", added: 40, deleted: 6 }], steps: ["Mapped the 1M context models", "Compaction keeps the last decisions", "Docs updated"] },
] as const;

const CHATTER = [
  "Tess merged the server fixes into the release branch", "Orin finished the side panel version check, 23 tests pass", "Juno updated the context window docs", "CI on the merged branch: 470 passed", "Release build started",
  "Signing the Mac build", "Signing the Windows build", "Uploading the Mac app", "Uploading the Windows installer", "Updated the release notes", "Checked the download links", "Waiting on the Mac upload",
];

function build() {
  const s = createConversationSample("idle", { title: "rc.22.1 launch night" });
  const rows = s.replica.rows("messages") as unknown as Message[];
  s.replica.remove("messages", rows.map((m) => (m as unknown as { id: string }).id));   // the idle chat's own messages: this chat is only the night
  let seq = 0;
  const out: Message[] = [];
  const add = (id: string, author: Message["author"], body: string, createdAt: number, o: Partial<Message> = {}): number => {
    seq += 1;
    out.push({ messageId: id, threadId: "c1", threadSeq: seq, author, kind: author.kind === "agent" ? "agent" : "text", body, blocks: [], depth: 0, attachments: [], reactions: [], pinned: false, createdAt, ...o } as Message);
    return seq;
  };
  add("n0", ME, "Ship rc.22.1 tonight. Everything in RC22-1-BUGS, the composer and the agent workspaces. Keep me posted here, I will be in and out.", at(20, 0));
  add("n9d", ME, "Decided: release after one green CI run", at(20, 3), { pinned: true });
  add("n1", INTAKE, "On it. Tonight is four pieces: server fixes, the Chrome extension, the composer and context windows. I will run them as a crew so they move at the same time, and bring each one back here when it is done.\n\nNothing goes out without your yes. The release and the MLA update each ask you once.", at(20, 4));
  CREW.forEach((c, i) => add(`h${i}`, INTAKE, "", at(20, 5, 0) + i * 1000, { blocks: [block("helper", `hb${i}`, { helperThreadId: c.id, title: c.title, agentId: c.agentId, startedAt: at(20, 5) })] }));
  add("n2", INTAKE, "Crew started: Tess, Orin, Kai and Juno", at(20, 6), { kind: "system" });
  add("n3", MAYA, "agent computers aren't working", at(21, 12));
  const read = add("n4", INTAKE, "Cause: Docker blocks the engine's sandbox on the Space server. The compose file never allowed user namespaces, so every computer stops at a permission error. Tess already has the fix in her branch; it needs one approval to land.", at(21, 15));
  CHATTER.forEach((t, i) => add(`q${i}`, AGENTS[i % 4]!, t, at(21, 40) + i * 9 * 60_000));
  add("n5", INTAKE, "", at(22, 50), { blocks: [block("question", "bq", { threadId: "c1", blockId: "bq", prompt: "Which corner radius: 12 px or 14 px?", mode: "single", options: [{ id: "a", label: "12 px" }, { id: "b", label: "14 px" }], allowOther: false }, "waiting")] });
  add("n6", INTAKE, "Release v1.0.0-rc.22.1 tagged", at(23, 48), { kind: "system" });
  add("n7", ME, "Back. What is left?", at(23, 50));
  add("n8", INTAKE, "Two things need you: approve the release and pick the corner radius for Kai. Everything else is done or running.", at(23, 52));
  add("n9", INTAKE, "Merged #893 into main", at(0, 6, 1), { kind: "system", blocks: [block("result_card", "bc1", { title: "Merged #893 into main", body: "Server fixes, Chrome extension and context windows. 470 tests passed, 0 failed.", actions: [{ key: "view", label: "View the change" }, { key: "checks", label: "Open checks" }] }, "done")] });
  add("n9b", INTAKE, "Release rc.22.1", at(0, 20, 1), { kind: "system", blocks: [block("progress_card", "bc2", { title: "Release rc.22.1", step: "Step 3 of 3", state: "running", steps: [{ label: "Build", state: "done" }, { label: "Sign", state: "done" }, { label: "Publish, uploading the Mac app", state: "running" }], actions: [{ key: "watch", label: "Watch" }, { key: "stop", label: "Stop" }] }, "done")] });
  add("n9c", INTAKE, "The MLA update could not start", at(0, 31, 1), { kind: "system", blocks: [block("status_card", "bc3", { title: "The MLA update could not start", body: "The server ran out of disk (2.1 GB free, needs 4). Free old images, then update.", tone: "warn", fix: { key: "fix", label: "Free space and update" }, more: [{ key: "details", label: "Details" }, { key: "copy", label: "Copy id" }, { key: "report", label: "Report" }] }, "done")] });
  CHATTER.slice(0, 6).forEach((t, i) => add(`r${i}`, AGENTS[(i + 1) % 4]!, t, at(0, 12, 1) + i * 5 * 60_000));
  add("n10", INTAKE, "MLA is on rc.22.1 and healthy. The Mac and Windows links are in the release. Kai still needs your corner answer before the composer change lands.", at(0, 45, 1));
  s.replica.put("messages", out.map((m) => ({ id: m.messageId, ...m })));
  // each helper's own chat, for the steps under its row
  const helperRows: Message[] = CREW.flatMap((c) => c.steps.map((t, i): Message => ({ messageId: `${c.id}_${i}`, threadId: c.id, threadSeq: i + 1, author: { kind: "agent", id: c.agentId }, kind: "agent", body: "", blocks: [block("step", `${c.id}_s${i}`, { title: t, sub: "", secs: 4 }, "done")], depth: 0, attachments: [], reactions: [], pinned: false, createdAt: at(21, 0) + i * 60_000 } as Message)));
  s.replica.put("messages", helperRows.map((m) => ({ id: m.messageId, ...m })));
  const now = Date.now();
  const status = () => {
    const members = CREW.map((c) => ({ kind: "helper" as const, id: c.id, parentThreadId: "c1", title: c.title, name: c.name, agentId: c.agentId, state: c.state, ...("step" in c ? { step: c.step } : {}), ...("found" in c ? { found: c.found } : {}), startedAt: now - c.min * 60_000, ...(c.state === "done" ? { endedAt: now - 60_000 } : {}), elapsedMs: c.min * 60_000, tokensIn: 0, tokensOut: 0, costMicros: 0, files: c.files, branch: `crew/${c.name.toLowerCase()}` }));
    return { members, totals: { members: 4, working: 1, done: 2, needsYou: 1, failed: 0, stopped: 0, tokensIn: 0, tokensOut: 0, costMicros: 0, filesChanged: 5, added: 161, deleted: 28, elapsedMs: 18 * 60_000 } };
  };
  const call = (cap: string, input: unknown): Promise<unknown> => {
    if (cap === "chat.catch_up") return Promise.resolve({ unread: 30, since: read, top: seq, firstMessageId: "q0", people: [], tasks: [], decisions: [], at: [] });
    if (cap === "engine.crew.status") return Promise.resolve(status());
    if (cap === "engine.crew.workspace") return Promise.resolve({ workspace: null });
    return s.data.call(cap, input);
  };
  return { ...s, data: { ...s.data, call, clock: () => ({ ...s.data.clock(), now: Date.now() }) } };
}

export default function Mount(): ReactNode {
  const height = useWindowDimensions().height;
  const parts = useMemo(() => {
    const conv = build();
    const pane = createPaneSample("northwind").data;
    const paneCall = (cap: string, input: unknown): Promise<unknown> => {
      if (cap === "goals.list") return Promise.resolve({ goals: [{ id: "g1", title: "Ship rc.22.1: server fixes, Chrome extension, composer and context windows, then update MLA.", status: "active", owner: "usr_irfad", leadAgentId: "agt_intake", threadId: pane.threadId, deadline: 0, progress: { tasksDone: 2, tasks: 4 }, updatedAt: 0 }] });
      if (cap === "engine.usage.get") return Promise.resolve({ account: null, context: { used: 380_000, window: 1_000_000 }, session: null, week: null, source: "estimate" });
      return pane.call(cap, input);
    };
    return { sidebar: createSampleSidebar(northwind).data, conversation: conv.data, pane: { ...pane, call: paneCall } };
  }, []);
  return <View style={{ height, backgroundColor: "var(--win)" as string }}><ChatsPlace sidebar={parts.sidebar} conversation={parts.conversation} pane={parts.pane} window={{ start: 0, end: 500 }} /></View>;
}
