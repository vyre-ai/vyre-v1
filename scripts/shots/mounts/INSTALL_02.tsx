// Mount for lane l-install, in context (team lead, 4 Nov): the install card inside the real chat feed, the Skills list in the chat's right pane, and the Console's Skills page with Installed from links.
//   ?part=chat&kind=skill | plugin | mcp | remote | member | done | update     the real Conversation over the sample thread, with the user's link, the Assistant's line and the card
//   ?part=pane      the chat's right pane on Skills        ?part=console   Console > Skills, Installed from links at the foot
// The query is read after mount (rule 25). Scripted answers: the install and skill reads; every other read goes to the sample.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import { createSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";
import type { Message } from "../../../apps/app/src/places/chats/conversation/model.ts";
import { ChatRightPane } from "../../../apps/app/src/places/chats/rightpane/ChatRightPane.tsx";
import { createChatMemorySample } from "../../../apps/app/src/places/chats/memory/sample.ts";
import { ConsoleShell } from "../../../apps/app/src/console/shell/ConsoleShell.tsx";
import { ConsoleDataProvider } from "../../../apps/app/src/console/shell/data.tsx";
import { createSampleConsole } from "../../../apps/app/src/console/shell/sample.ts";
import { consolePageFor } from "../../../apps/app/src/shell/providers/console.tsx";
import { INSTALLS, KEY, PLANS, WHO } from "./INSTALL_01.tsx";

export const title = "Install from a link, in context";

interface RootLike { setAttribute(name: string, value: string): void; style: { setProperty(name: string, value: string): void; removeProperty(name: string): void } }
type Doc = { documentElement?: RootLike };
type Call = (cap: string, input: unknown) => Promise<unknown>;

const NOV4 = Date.UTC(2026, 10, 4, 9, 0);
const NAMES: Record<string, string> = { usr_dana: "Dana Ortiz", usr_maya: "Maya Chen", usr_irfad: "Irfad Imtiaz", usr_sara: "Sara Malik", agt_mira: "Mira", agt_ember: "Ember" };
const LINKS: Record<string, string> = { skill: "https://github.com/acme/pdf-tools install this for me", plugin: "https://github.com/acme/review-kit install this", mcp: "https://github.com/acme/sql-reader install this", remote: "https://mcp.tasks.example/sse add this server", member: "https://github.com/acme/pdf-tools install this for me", done: "https://github.com/acme/pdf-tools install this for me", update: "Check pdf-tools for a newer version" };
const SAYS: Record<string, string> = {
  skill: "Found it. It is a skill with one file and no scripts. I read it before holding the install.\n\nI will not install anything until you say so.",
  plugin: "It is a plugin: one command and one skill. It needs your GitHub token, which stays in Vault.\n\nI will not install anything until you say so.",
  mcp: "It is an MCP server that runs as a program. It needs somewhere to run, so pick one below.\n\nI will not install anything until you say so.",
  remote: "That is a remote MCP server, not a repo, so there is no commit to pin. It runs on their side.\n\nI will not install anything until you say so.",
};

/** What the plan says for a kind: the scripted install.get, the Vault with nothing in it, the check for a newer version. */
const keyOf = (kind: string): string => (kind === "mcpadded" ? "mcp" : kind === "older" ? "update" : KEY[kind] ?? "skill");
const VERSIONS: Record<string, string> = { skill: "1.2.0", plugin: "0.9.4", mcp: "2.1.0", update: "1.3.0" };
export function scripted(kind: string): Call {
  const k = keyOf(kind);
  return async (cap, input) => {
    const i = (input ?? {}) as Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
    switch (cap) {
      case "install.get": { const raw = PLANS[k] as Record<string, unknown>; const plan = { ...raw, ...(VERSIONS[k] ? { version: VERSIONS[k] } : {}), ...(k === "update" ? { diff: kind === "older" ? { ...(raw["diff"] as object), from: "7d03be8".padEnd(40, "0"), to: "a41f9c2".padEnd(40, "0"), fromVersion: "1.3.0", toVersion: "1.2.0", older: true, newAccess: [] } : { ...(raw["diff"] as object), fromVersion: "1.2.0", toVersion: "1.3.0", newAccess: ["cdn.example.com"] } } : {}) }; return { plan: kind === "member" ? { ...plan, who: WHO(false) } : kind === "done" ? { ...plan, state: "installed" } : plan }; }
      case "vault.items.list": return { items: [{ name: "GitHub token (yours)" }, ...(kind === "mcpadded" ? [{ name: "DATABASE_URL" }] : [])] };
      case "install.list": return { installs: INSTALLS.map((x, n) => ({ ...x, at: NOV4 - n * 86_400_000, ...(x.kind === "skill" ? { version: "1.2.0" } : x.kind === "mcp_local" ? { version: "2.1.0" } : {}), installed: { for: n === 0 ? "space" : "me" } })) };
      case "access.principals.list": return { principals: Object.entries(NAMES).filter(([id]) => id.startsWith("usr_")).map(([id, name]) => ({ id, name })) };
      case "install.check_update": { if (i["installId"] !== "ins_1") return { changed: false }; const u = PLANS["update"] as Record<string, unknown>; return { changed: true, plan: { ...u, version: "1.3.0", diff: { ...(u["diff"] as object), fromVersion: "1.2.0", toVersion: "1.3.0", newAccess: ["cdn.example.com"] } } }; }
      case "skills.page": return {
        waiting: [], builtin: [], agents: [], policy: { scriptsAdminOnly: true }, admin: true, me: "usr_irfad", space: [],
        mine: [{ skillId: "sko_1", name: "pdf-tools", description: "", source: "github:acme/pdf-tools@a41f9c2", origin: "acme/pdf-tools", version: "1.2.0", agents: ["*"], enabled: true, needs: [], health: "ok" }, { skillId: "sko_2", name: "Weekly report format", description: "", source: "upload", origin: "", version: "2.0", agents: ["*"], enabled: true, needs: [], health: "ok" }],
        shared: [{ skillId: "sko_9", name: "Brand voice", sharer: "usr_sara", sharerName: "Sara Malik", description: "", toSpace: false, source: "", origin: "", perms: {}, state: "added", growth: [], version: "3.1" }, { skillId: "sko_10", name: "Client intake", sharer: "usr_omar", sharerName: "Omar Reyes", description: "", toSpace: false, source: "", origin: "", perms: {}, state: "added", growth: [], version: "1.0" }],
      };
      case "skills.of_agents": return { skills: [{ skillId: "sko_5", name: "Write a brief", description: "", agentId: "agt_mira", agentName: "Mira", version: "1.4", source: "agent", rev: 2, updatedAt: NOV4 }, { skillId: "sko_6", name: "Review a pull request", description: "", agentId: "agt_ember", agentName: "Ember", version: "0.9", source: "github:acme/review-kit@3be07d1", rev: 1, updatedAt: NOV4 }] };
      case "skills.members": return { skills: [] };
      case "skills.history": return { revisions: [{ rev: 1, by: "usr_irfad", authorKind: "person", version: "1.2.0", summary: "Installed from a link · a41f9c2", at: NOV4 }] };
      default: void i; return undefined;
    }
  };
}

function useSkin(skin: string): void {
  useMemo(() => {
    const root = (globalThis as { document?: Doc }).document?.documentElement;
    const themeRoot: ThemeRoot = { setAttribute: (n, v) => { root?.setAttribute(n, v); }, setProperty: (n, v) => { root?.style.setProperty(n, v); }, removeProperty: (n) => { root?.style.removeProperty(n); } };
    return createThemeController({ personId: "irfad", spaceId: "nw", spaceSkin: { nw: skin }, prefersDark: skin === "graphite", root: themeRoot, storage: null });
  }, [skin]);
}

/** Fall back to the real answer for any capability the script does not know. */
const over = (own: Call, real: Call): Call => async (cap, input) => { const v = await own(cap, input); return v === undefined ? real(cap, input) : v; };

function useChatData(kind: string) {
  return useMemo(() => {
    const s = createSample("idle");
    const rows = (s.replica.rows("messages") as unknown as (Message & { id: string })[]).filter((m) => m.threadId === s.data.threadId).sort((a, b) => a.threadSeq - b.threadSeq);
    const last = rows[rows.length - 1]!;
    // the thread starts with the link: the card is the last thing on a short feed, whole on screen
    s.replica.remove("messages", rows.map((m) => m.id));
    const k = keyOf(kind);
    const plan = PLANS[k] as { planId: string; name: string; kind: string };
    const at = (n: number): number => last.createdAt + n * 60_000;
    const mk = (n: number, author: Message["author"], body: string, blocks: unknown[] = []): Message => ({ messageId: `msg_inst_${n}`, threadId: s.data.threadId, threadSeq: last.threadSeq + n, author, kind: author.kind === "agent" ? "agent" : "person", body, depth: 0, attachments: [], reactions: [], pinned: false, createdAt: at(n), blocks } as unknown as Message);
    const agent = { kind: "agent", id: "agt_intake" } as Message["author"];
    const me = { kind: "person", id: s.data.me.id } as Message["author"];
    const block = { type: "install_plan", v: 1, id: "blk_inst", state: "done", traceId: "tr", data: { planId: plan.planId, name: plan.name, kind: plan.kind, ...(kind === "update" || kind === "older" ? { update: true, installId: "ins_1" } : {}) } };
    const msgs = kind === "update" || kind === "older"
      ? [mk(1, me, kind === "older" ? "Check pdf-tools again" : (LINKS[kind] ?? LINKS["mcp"]!)), mk(2, agent, kind === "older" ? "The repository now points at an older pdf-tools, 1.2.0, while 1.3.0 is installed. I will not change anything until you say so." : "pdf-tools has a newer version. I will not update anything until you say so.", [block])]
      : [mk(1, me, (LINKS[kind] ?? LINKS["mcp"]!)), mk(2, agent, SAYS[kind === "member" || kind === "done" ? "skill" : kind === "mcpadded" ? "mcp" : kind]!, [block])];
    s.replica.put("messages", msgs.map((m) => ({ id: m.messageId, ...m })));
    const d = s.data as unknown as { nav?: object };
    return { ...s.data, nav: { ...(d.nav ?? {}), openSkills: () => undefined }, call: over(scripted(kind), s.data.call as Call) as never } as typeof s.data;
  }, [kind]);
}

function Chat({ kind }: { kind: string }): ReactNode {
  const data = useChatData(kind);
  return <View testID="install2-chat" style={{ flex: 1, backgroundColor: "var(--win)" as string }}><Conversation data={data} /></View>;
}

function Pane(): ReactNode {
  const chat = useChatData("done");
  const s = useMemo(() => createChatMemorySample({}), []);
  const [ready, setReady] = useState(false);
  useEffect(() => { void s.warm([]).then(() => setReady(true)); }, [s]);
  const pane = useMemo(() => ({ ...s.pane, call: over(scripted("skill"), s.pane.call as Call) as never, nameOf: (id: string) => NAMES[id] ?? id }), [s]);
  if (!ready) return <View style={{ flex: 1 }} />;
  return <View style={{ flex: 1, flexDirection: "row", backgroundColor: "var(--win)" as string }}><View style={{ flex: 1 }}><Conversation data={chat} /></View><ChatRightPane data={pane as never} open onToggle={() => undefined} initialTab="skills" window={{ start: 0, end: 500 }} /></View>;
}

function Console(): ReactNode {
  const cons = useMemo(() => { const base = createSampleConsole().data; return { ...base, call: over(scripted("skill"), base.call as Call) as never, name: (id: string) => NAMES[id] ?? id }; }, []);
  return <ConsoleDataProvider value={cons}><View style={{ flex: 1, minHeight: 900 }}><ConsoleShell embedded initialPage="skills" renderPage={(id, state) => consolePageFor(id, state as Record<string, string | undefined>)} /></View></ConsoleDataProvider>;
}

export default function Mount(): ReactNode {
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const q = new URLSearchParams(search ?? "");
  useSkin(q.get("skin") ?? "paper");
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  const part = q.get("part") ?? "chat";
  if (part === "pane") return <Pane />;
  if (part === "console") return <Console />;
  return <Chat kind={q.get("kind") ?? "skill"} />;
}
