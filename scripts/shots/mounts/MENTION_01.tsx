// Mount for MENTION_01 (lane l-learn2): the @ menu of a shared channel, over the real Conversation with the lists the shell builds (composerLists, candidates) from one directory of people and agents.
// ?who=owner|member: Assistant (the viewer's own, with the V mark), then the other agents of the Space, each with its face, then people. Another person's Assistant ("Maya Lin (Agent)"), the owner's own
// Claude Code ("Irfad Imtiaz (Agent)") and an agent kept from the viewer are not in it, and there is no Report a problem row. ?who=guest: only the agents this chat allows. ?view=ask: the Ask an agent picker the quiet line under your unanswered message opens: your Assistant first, named Assistant, with the agents of the room; another person's Assistant is not in it, and neither is a Report a problem row.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import { createSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";
import { candidates, composerLists } from "../../../apps/app/src/shell/providers/chats-data.ts";

export const title = "The @ menu: Assistant, the Space's agents, people";

const ME = "usr_irfad";
const MY_ASSISTANT = { id: "agt_irfad_assistant", name: "Assistant" };
const PRINCIPALS = [
  { id: ME, name: "Irfad Imtiaz", kind: "person" as const }, { id: "usr_maya", name: "Maya Lin", kind: "person" as const }, { id: "usr_sara", name: "Sara Khan", kind: "person" as const },
  { id: MY_ASSISTANT.id, name: "Assistant", kind: "agent" as const, owner: ME, private: true },
  { id: "agt_intake", name: "Intake", kind: "agent" as const }, { id: "agt_docs", name: "Docs", kind: "agent" as const }, { id: "agt_scout", name: "Scout", kind: "agent" as const },
  { id: "agt_maya_assistant", name: "Maya Lin (Agent)", kind: "agent" as const, owner: "usr_maya", private: true },
  { id: "agt_irfad_cc", name: "Irfad Imtiaz (Agent)", kind: "agent" as const, owner: ME },
];
interface RootLike { setAttribute(name: string, value: string): void; style: { setProperty(name: string, value: string): void; removeProperty(name: string): void } }
type Pick1 = { click?: () => void; focus?: () => void; value?: string; setSelectionRange?: (a: number, b: number) => void; dispatchEvent?: (e: unknown) => boolean };
type Doc = { execCommand?(cmd: string, ui?: boolean, value?: string): boolean; querySelector(s: string): Pick1 | null; documentElement?: RootLike };

export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  return q ? <Page who={q.get("who") ?? "owner"} view={q.get("view") ?? "at"} skin={q.get("skin") ?? "paper"} /> : <View testID="mention-wait" style={{ flex: 1 }} />;
}

function Page({ who, view, skin }: { who: string; view: string; skin: string }): ReactNode {
  useMemo(() => {
    const root = (globalThis as { document?: Doc }).document?.documentElement;
    const themeRoot: ThemeRoot = { setAttribute: (n, v) => { root?.setAttribute(n, v); }, setProperty: (n, v) => { root?.style.setProperty(n, v); }, removeProperty: (n) => { root?.style.removeProperty(n); } };
    return createThemeController({ personId: "irfad", spaceId: "nw", spaceSkin: { nw: skin }, prefersDark: skin === "graphite", root: themeRoot, storage: null });
  }, [skin]);
  const guest = who === "guest";
  const ask = view === "ask";
  const sample = useMemo(() => {
    // the @ menu opens in a shared channel (a one-to-one chat with an agent has none), so both views are the channel
    const s = createSample("channel");
    const me = guest ? "usr_gus" : ME;
    const list = guest ? [...PRINCIPALS, { id: "usr_gus", name: "Gus Guest", kind: "person" as const, guest: true }] : PRINCIPALS;
    const own = guest ? { id: "agt_gus_assistant", name: "Assistant" } : MY_ASSISTANT;
    const call: typeof s.data.call = async (cap, input) => {
      if (cap === "agents.list") return { agents: [{ agentId: "agt_docs", name: "Docs", kind: "agent" }, { agentId: "agt_intake", name: "Assistant", ownerId: ME, kind: "assistant" }, { agentId: "agt_maya_assistant", name: "Assistant", ownerId: "usr_maya", kind: "assistant" }] };
      return s.data.call(cap, input);
    };
    return { ...s.data, ...(ask ? { call } : {}), assistantId: own.id, me: { id: me, name: guest ? "Gus Guest" : "Irfad Imtiaz", ...(guest ? { guest: true } : {}) }, lists: composerLists(list, me, own), directory: candidates(list, me, own) };
  }, [guest, ask]);
  // type the @ a person would, once the page has drawn
  useEffect(() => {
    if (ask) {
      const t = setTimeout(() => (globalThis as { document?: Doc }).document?.querySelector("[data-testid='no-agent-ask']")?.click?.(), 800);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      const d = (globalThis as { document?: Doc }).document;
      const el = d?.querySelector("[data-testid='composer-field']");
      if (!el) return;
      // the composer is a rich editor (a contenteditable page, not a text area): focus it and type the @ a person would
      el.focus?.();
      d?.execCommand?.("insertText", false, "@");
    }, 800);
    return () => clearTimeout(t);
  }, [ask]);
  return <View testID="mention-mount" style={{ flex: 1, backgroundColor: "var(--win)" as string }}><Conversation data={sample} /></View>;
}
