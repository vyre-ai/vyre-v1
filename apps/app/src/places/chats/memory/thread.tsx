// The memory of one open chat, provided above the conversation: what was learned from each message (one read for the whole thread, kept so a line stays on the page after its fact is undone,
// and shows Restore), the known subjects of the Space (one page list for the thread, matched in a pure function), and the one flash line with Undo that Remember, Forget and Add to a page
// use. Where the shell gave the chat no memory the provider draws its children and nothing else, so every memory surface is simply absent.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChatMemoryContext, useRead } from "./data.tsx";
import type { ChatMemoryData } from "./data.tsx";
import { subjectIndex } from "./model.ts";
import type { LearnedRow, SubjectIndex, SubjectPage } from "./model.ts";

interface LearnedItemOut { fact: { factId: string; text: string; sourceRef: string; sourceKind: string; learnedAt: number; subject?: { title: string; pageId: string } }; at: number }
interface LearnedOut { items: LearnedItemOut[] }
interface PagesOut { pages: SubjectPage[] }

export interface Flash { id: number; text: string; undo?: () => void | Promise<unknown> }

export interface ThreadMemory {
  memory: ChatMemoryData;
  threadId: string;
  index: SubjectIndex;
  pages: readonly SubjectPage[];
  /** What was learned from this message, in the order it was learned. Includes a line whose fact is no longer current (flagged by `current`). */
  learnedFrom(messageId: string): Array<LearnedRow & { current: boolean }>;
  /** Every current fact learned in this thread, by message (for "Forget this"). */
  currentFrom(messageId: string): LearnedRow[];
  /** A corrected fact takes the place of the old one on the page. */
  supersede(oldId: string, next: LearnedRow): void;
  flash(text: string, undo?: () => void | Promise<unknown>): void;
}

const Ctx = createContext<ThreadMemory | null>(null);

export function useThreadMemory(): ThreadMemory | null {
  return useContext(Ctx);
}

export const FLASH_MS = 8000;

export function ChatMemoryProvider({ memory, threadId, children }: { memory: ChatMemoryData | undefined; threadId: string; children: ReactNode }): ReactElement {
  if (!memory) return <>{children}</>;
  return <ChatMemoryContext value={memory}><WithMemory memory={memory} threadId={threadId}>{children}</WithMemory></ChatMemoryContext>;
}

function WithMemory({ memory, threadId, children }: { memory: ChatMemoryData; threadId: string; children: ReactNode }): ReactElement {
  const learnedQ = useRead<LearnedOut>(memory.store, "memory.learned", { threadId, limit: 200 });
  const pagesQ = useRead<PagesOut>(memory.store, "memory.page.list", {});
  const seen = useRef(memory.store.kept<LearnedRow>(`learned:${threadId}`));
  const [, tick] = useState(0);
  const [flash, setFlash] = useState<Flash | null>(null);
  const counter = useRef(0);

  const current = useMemo(() => {
    const out = new Map<string, LearnedRow>();
    if (learnedQ.status === "ready") {
      for (const it of learnedQ.data.items) {
        if (it.fact.sourceKind !== "chat") continue;
        out.set(it.fact.factId, { factId: it.fact.factId, text: it.fact.text, sourceRef: it.fact.sourceRef, at: it.at, ...(it.fact.subject ? { subjectTitle: it.fact.subject.title, pageId: it.fact.subject.pageId } : {}) });
      }
    }
    return out;
  }, [learnedQ]);
  for (const [id, row] of current) seen.current.set(id, row);

  const pages = useMemo<readonly SubjectPage[]>(() => (pagesQ.status === "ready" ? pagesQ.data.pages : []), [pagesQ]);
  const index = useMemo(() => subjectIndex(pages), [pages]);

  useEffect(() => {
    if (flash === null) return undefined;
    const t = setTimeout(() => setFlash((f) => (f && f.id === flash.id ? null : f)), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);

  const value = useMemo<ThreadMemory>(() => ({
    memory, threadId, index, pages,
    learnedFrom: (messageId) => [...seen.current.values()].filter((r) => r.sourceRef === messageId).sort((a, b) => a.at - b.at).map((r) => ({ ...r, current: current.has(r.factId) })),
    currentFrom: (messageId) => [...current.values()].filter((r) => r.sourceRef === messageId),
    supersede: (oldId, next) => { seen.current.delete(oldId); seen.current.set(next.factId, next); tick((n) => n + 1); },
    flash: (text, undo) => { counter.current += 1; setFlash({ id: counter.current, text, ...(undo ? { undo } : {}) }); },
  }), [memory, threadId, index, pages, current]);

  const dismiss = useCallback(() => setFlash(null), []);
  return (
    <Ctx.Provider value={value}>
      {children}
      {flash ? <FlashLine flash={flash} onClose={dismiss} /> : null}
    </Ctx.Provider>
  );
}

/** One quiet line over the composer: what just happened, with Undo where it can be taken back. */
export function FlashLine({ flash, onClose }: { flash: Flash; onClose: () => void }): ReactElement {
  return (
    <View testID="memory-flash" accessibilityRole="alert" accessibilityLiveRegion="polite" style={st.flash}>
      <Text style={st.text}>{flash.text}</Text>
      {flash.undo ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Undo" testID="memory-flash-undo" onPress={() => { const u = flash.undo; onClose(); void u?.(); }} style={st.btn}>
          <Text style={st.undo}>Undo</Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" testID="memory-flash-close" onPress={onClose} style={st.btn}><Text style={st.close}>Dismiss</Text></Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  flash: { position: "absolute", left: 16, bottom: 120, maxWidth: 460, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-pop)" as string },
  text: { flexShrink: 1, fontSize: 12.5, color: "var(--ink)" as string },
  btn: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  undo: { fontSize: 12.5, fontWeight: "600", color: "var(--accent)" as string },
  close: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
