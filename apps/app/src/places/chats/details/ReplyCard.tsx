// The hover card of a reply (owner, 3 Nov 2026): hover the agent's face or name on any reply and a small card says which model answered and how hard it thought, the AI account it ran on,
// who asked, where it ran, what it cost, its tokens and how long it took, with Details to open the right pane on everything. It reads chat.reply_details when it opens (once per reply).
// Pressing the face or name still opens the agent; Escape closes the card; the card stays while the pointer is on it.
import { useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Overlay } from "../../../../../../ui/src/Overlay/index.tsx";
import { Face } from "../needsyou/parts.tsx";
import { webProps } from "../memory/parts.tsx";
import { cardLines } from "./model.ts";
import type { DetailsContext } from "./model.ts";
import { peekReplyDetails } from "./read.ts";
import type { ReadDetails } from "./read.ts";

/** What a conversation gives its replies for their details. */
export interface ReplyDetailsActions {
  read(messageId: string): Promise<ReadDetails>;
  /** Opens the right pane on the Details tab of this reply. */
  open(messageId: string): void;
  meId: string;
  nameOf(id: string): string;
}

export const CARD_W = 292;
const OPEN_MS = 320;
const CLOSE_MS = 180;

export const contextOf = (a: ReplyDetailsActions, r: ReadDetails | null): DetailsContext => ({ meId: a.meId, nameOf: a.nameOf, accountName: (ref) => r?.accounts.get(ref) });

/** Wraps the face and name of a reply: hovering them, or focusing them, opens the card under them. */
export function ReplyHover({ messageId, details, children }: { messageId: string; details: ReplyDetailsActions; children: ReactNode }): ReactElement {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const wait = useRef<ReturnType<typeof setTimeout> | null>(null);
  const over = useRef({ face: false, card: false });
  const clear = (): void => { if (wait.current) { clearTimeout(wait.current); wait.current = null; } };
  useEffect(() => clear, []);
  const showAt = (el: unknown): void => {
    const box = (el as { getBoundingClientRect?: () => { left: number; top: number; bottom: number } } | null)?.getBoundingClientRect?.();
    const g = globalThis as { innerWidth?: number; innerHeight?: number };
    const w = g.innerWidth ?? 1200, h = g.innerHeight ?? 800;
    // under the face, or above it when the card would run off the bottom
    if (box) setAt({ left: Math.max(8, Math.min(box.left, w - CARD_W - 8)), top: box.bottom + 6 + 300 > h ? Math.max(8, box.top - 306) : box.bottom + 6 });
  };
  const closeSoon = (): void => { clear(); wait.current = setTimeout(() => { if (!over.current.face && !over.current.card) setAt(null); }, CLOSE_MS); };
  return (
    <>
      <View
        testID={`reply-hover-${messageId}`} style={st.wrap}
        {...webProps({
          onMouseEnter: (e: { currentTarget: unknown }) => { over.current.face = true; clear(); const el = e.currentTarget; wait.current = setTimeout(() => showAt(el), OPEN_MS); },
          onMouseLeave: () => { over.current.face = false; closeSoon(); },
          onKeyDown: (e: { key: string }) => { if (e.key === "Escape") setAt(null); },
        })}
      >{children}</View>
      {at ? (
        <ReplyCard
          messageId={messageId} details={details} at={at}
          onEnter={() => { over.current.card = true; clear(); }} onLeave={() => { over.current.card = false; closeSoon(); }} onClose={() => setAt(null)}
        />
      ) : null}
    </>
  );
}

export function ReplyCard({ messageId, details, at, onEnter, onLeave, onClose }: {
  messageId: string; details: ReplyDetailsActions; at: { left: number; top: number }; onEnter?: () => void; onLeave?: () => void; onClose: () => void;
}): ReactElement {
  const [read, setRead] = useState<{ status: "loading" } | { status: "ready"; r: ReadDetails } | { status: "failed" }>(() => { const r = peekReplyDetails(messageId); return r ? { status: "ready", r } : { status: "loading" }; });
  useEffect(() => {
    let live = true;
    details.read(messageId).then((r) => { if (live) setRead({ status: "ready", r }); }, () => { if (live) setRead({ status: "failed" }); });
    return () => { live = false; };
  }, [messageId]);  // eslint-disable-line react-hooks/exhaustive-deps
  const card = read.status === "ready" ? cardLines(read.r.details, contextOf(details, read.r)) : null;
  const agentId = read.status === "ready" ? read.r.details.agentId : "";
  return (
    <Overlay>
      <View
        testID={`reply-card-${messageId}`} accessibilityRole="none" accessibilityLabel={card ? `${card.head}, ${card.sub}` : "Reply details"}
        {...webProps({ role: "dialog", onMouseEnter: onEnter, onMouseLeave: onLeave, onKeyDown: (e: { key: string }) => { if (e.key === "Escape") onClose(); } })}
        style={[st.card, { left: at.left, top: at.top } as object]}
      >
        {card ? (
          <>
            <View style={st.head}>
              <Face name={card.head} seedId={agentId} kind="agent" size={32} />
              <View style={st.headText}>
                <Text numberOfLines={1} style={st.name}>{card.head}</Text>
                <Text numberOfLines={1} testID={`reply-card-model-${messageId}`} style={st.sub}>{card.sub}</Text>
              </View>
            </View>
            {card.lines.map((l) => (l.kind === "kv" ? (
              // ui-rows-lint: not a list (label and value pairs of one card, no hover or selection)
              <View key={l.key} testID={`reply-card-${l.key}`} style={st.kv}>
                <Text style={st.k}>{l.label}</Text>
                <Text numberOfLines={2} style={st.v}>{l.value}</Text>
              </View>
            ) : l.kind === "note" ? <Text key={l.key} style={st.note}>{l.text}</Text> : null))}
          </>
        ) : <Text style={st.note}>{read.status === "failed" ? "The details could not be read just now." : "Loading"}</Text>}
        <Pressable accessibilityRole="button" testID={`reply-card-details-${messageId}`} onPress={() => { details.open(messageId); onClose(); }} style={({ hovered }: { hovered?: boolean }) => [st.more, hovered ? st.moreOver : null] as object}>
          <Text style={st.moreText}>Details</Text>
        </Pressable>
      </View>
    </Overlay>
  );
}

const st = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  card: { position: "fixed", width: CARD_W, paddingTop: 12, paddingHorizontal: 14, paddingBottom: 6, borderRadius: 14, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-pop)", zIndex: 60 } as object,
  head: { flexDirection: "row", alignItems: "center", gap: 11, paddingBottom: 8 },
  headText: { flex: 1, minWidth: 0 },
  name: { fontSize: 14.5, fontWeight: "600", color: "var(--ink)" as string },
  sub: { fontSize: 12.5, color: "var(--ink-3)" as string },
  kv: { flexDirection: "row", justifyContent: "space-between", gap: 14, paddingVertical: 6, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  k: { fontSize: 13, color: "var(--ink-3)" as string },
  v: { fontSize: 13, color: "var(--ink)" as string, textAlign: "right", flexShrink: 1 },
  note: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string, paddingVertical: 4 },
  more: { marginTop: 6, marginHorizontal: -8, paddingHorizontal: 8, height: 32, borderRadius: 9, justifyContent: "center" },
  moreOver: { backgroundColor: "var(--hover)" as string },
  moreText: { fontSize: 13, color: "var(--ink)" as string },
});
