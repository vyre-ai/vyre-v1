// Mount for where a chat runs (lane l-runson), over the Northwind sample conversation pinned to this computer. ?part=
//   chat     (default) the computer went to sleep mid-turn once ("continuing on the Northwind server"), and now it is off: the next message waits, with Run it on the server instead
//   menu     the model panel open on Runs on: Automatic, This computer (off), the Office iMac (on), the Space, and their server home-box (off)
//   details  a turn's Details: where it ran, "Irfad's MacBook, then the Northwind server"
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import { createSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";

export const title = "Where a chat runs";

type Doc = { querySelector(s: string): { click?: () => void } | null };
const click = (sel: string): boolean => { const el = (globalThis as { document?: Doc }).document?.querySelector(sel); el?.click?.(); return !!el; };

export default function Mount(): ReactNode {
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const part = new URLSearchParams(search ?? "").get("part") ?? "chat";
  const sample = useMemo(() => {
    const s = createSample("runson");
    if (part === "details") {
      s.replica.put("messages", [{ id: "r6", messageId: "r6", threadId: "c1", threadSeq: 6, author: { kind: "agent", id: "agt_intake" }, kind: "agent", body: "", blocks: [{ type: "turn_status", v: 1, id: "st3", data: { state: "failed", code: "turn_timeout", turnId: "turn_r9" } }], depth: 0, attachments: [], reactions: [], pinned: false, createdAt: Date.UTC(2025, 9, 24, 9, 52) }]);
    }
    return s;
  }, [part]);
  useEffect(() => {
    if (search === null) return undefined;
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (part === "menu") {
      timers.push(setTimeout(() => { click("[data-testid='composer-strip']"); }, 500));
      timers.push(setTimeout(() => { click("[data-testid='model-runs-row']"); }, 1100));
    }
    if (part === "details") timers.push(setTimeout(() => { click("[data-testid='err-what']"); }, 600));
    return () => { for (const t of timers) clearTimeout(t); };
  }, [search, part]);
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}><Conversation data={sample.data} /></View>;
}
