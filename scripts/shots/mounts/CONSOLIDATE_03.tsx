// Mount (lane l-consolidate, 5 Nov): an agent's reply with [1] [2] citation marks over a crew of two helpers, the real MessageView and citeRender. ?part=
//   open     the row is hovered and the [1] chip's card is open: the message's hover toolbar steps aside, so it does not cover the card
//   closed   the same message hovered with no card: the hover toolbar shows
// The hover is driven by dispatching mouse events after load, the way a pointer would arrive.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { MessageView } from "../../../apps/app/src/places/chats/conversation/MessageView.tsx";
import { timeline } from "../../../apps/app/src/places/chats/conversation/model.ts";
import type { Message } from "../../../apps/app/src/places/chats/conversation/model.ts";

export const title = "Citation card and the hover toolbar";

const NOW = Date.UTC(2026, 10, 5, 9, 30);
const NAMES: Record<string, string> = { agt_lead: "Intake", usr_olivia: "Olivia Reed", agt_h1: "Lena", agt_h2: "Omar" };
const member = (id: string, name: string, title: string, found: string, n: number) => ({
  kind: "helper" as const, id, parentThreadId: "thr_cite", title, name, agentId: id, state: "done" as const, found, startedAt: NOW - 600_000 + n, endedAt: NOW - 120_000, elapsedMs: 480_000, tokensIn: 3200, tokensOut: 900, costMicros: 8000,
});
const STATUS = { members: [member("agt_h1", "Lena", "Check the lease dates", "The lease ends 30 June, with a 60-day notice window.", 1), member("agt_h2", "Omar", "Read the fee schedule", "The fee is flat, $450 a filing, no hourly add-on.", 2)], totals: { members: 2, working: 0, done: 2, needsYou: 0, failed: 0, stopped: 0 } } as never;

const message = (): Message => ({
  messageId: "msg_cite", threadId: "thr_cite", threadSeq: 1, author: { kind: "agent", id: "agt_lead" }, kind: "agent",
  body: "The lease ends on 30 June and the notice window is 60 days [1]. Filing is a flat $450, with no hourly add-on [2]. I would send notice by the end of April.",
  blocks: [], depth: 0, attachments: [], reactions: [], pinned: false, createdAt: NOW,
} as unknown as Message);

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "open"), []);
  const items = useMemo(() => timeline([message()], { meId: "usr_olivia", nameOf: (id: string) => NAMES[id] ?? id, kindOf: (id: string) => (id.startsWith("agt_") ? "agent" : "person"), clock: { now: NOW + 60_000, offsetMin: -300 } }), []);
  const actions = useMemo(() => ({
    nameOf: (id: string) => NAMES[id] ?? id, copy() {}, openThread() {}, setPinned() {}, react() {}, remove() {}, openAgent() {}, showMenu() {},
    crew: { status: STATUS, selected: null, peek() {}, stopAll() {}, openPane() {}, retry() {}, merge() {} },
  }), []);
  useEffect(() => {
    if (part === null) return undefined;
    const doc = (globalThis as { document?: Document }).document;
    const fire = (el: Element | null, types: string[]): void => { for (const t of types) el?.dispatchEvent(new (globalThis as { MouseEvent: typeof MouseEvent }).MouseEvent(t, { bubbles: true, cancelable: true, view: globalThis as never })); };
    const timer = setTimeout(() => {
      const row = doc?.querySelector('[data-testid="hover-msg_cite"]')?.parentElement ?? null;
      fire(row, ["mouseover", "mouseenter", "pointerover", "pointerenter"]);
      if (part === "open") setTimeout(() => { const chip = doc?.querySelector('[data-testid="cite-1"]') ?? null; fire(chip, ["mouseover", "mouseenter", "pointerover", "pointerenter"]); }, 300);
    }, 600);
    return () => clearTimeout(timer);
  }, [part]);
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return (
    <View style={{ flex: 1, minHeight: 420, padding: 40, paddingTop: 80, backgroundColor: "var(--win)" as string }}>
      <View style={{ maxWidth: 720, width: "100%" }}>{items.map((it) => <MessageView key={it.key} item={it} actions={actions as never} meId="usr_olivia" />)}</View>
    </View>
  );
}
