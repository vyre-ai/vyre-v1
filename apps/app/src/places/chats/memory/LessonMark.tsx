// Lessons never print under a reply (owner, 14 Nov 2026). A reply that used lessons carries one quiet mark in its own meta row (the face, the name and the time), with a count when it used more than one;
// the message that taught a lesson carries the same mark once its reply has come. Pressing the mark opens, where it was pressed, a small list: each lesson on one line, cut with an ellipsis (a press on the
// words opens the whole of it), with See (opens Knows) and Remove (forgets it; it stays in Trash 60 days, the flash line has Undo). Escape closes it and focus goes back to the mark.
// The same list is a section of the reply's Details (details/model.ts). A reply that used no lesson, or a server that cannot say, draws nothing.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Overlay } from "../../../../../../ui/src/Overlay/index.tsx";
import { placeNear } from "../../../../../../ui/src/Overlay/anchor.ts";
import { Icon } from "../../files/memory/parts.tsx";
import { forgetFacts } from "./actions.ts";
import { useChatMemory, useRead } from "./data.tsx";
import { isLesson, lessonMarkLabel } from "./model.ts";
import type { UsedOut } from "./model.ts";
import { LinkButton, webProps } from "./parts.tsx";
import { useThreadMemory } from "./thread.tsx";

export interface MarkLesson {
  factId: string;
  text: string;
}

export const MARK_W = 320;

/** The lessons that were put in front of the agent for this reply. Nothing while loading, without memory, or when the reply used none. */
export function useLessonsUsed(messageId: string, threadId: string): MarkLesson[] {
  const mem = useChatMemory();
  const read = useRead<UsedOut>(mem?.store ?? null, "memory.used", mem ? { threadId, messageId } : null);
  if (!mem || read.status !== "ready") return [];
  const seen = new Set<string>();
  return read.data.facts
    .filter((f) => isLesson(f) && !seen.has(f.factId) && !!seen.add(f.factId))
    .map((f) => ({ factId: f.factId, text: f.text }));
}

/** The mark of a reply's meta row. */
export function ReplyLessonsMark({
  messageId,
  threadId,
}: {
  messageId: string;
  threadId: string;
}): ReactElement | null {
  const lessons = useLessonsUsed(messageId, threadId);
  if (lessons.length === 0) return null;
  return <LessonMark id={messageId} lessons={lessons} kind="used" />;
}

/** The quiet mark and its list. `kind` only changes the words ("Used" a lesson, "Learned" a lesson). */
export function LessonMark({
  id,
  lessons,
  kind,
}: {
  id: string;
  lessons: readonly MarkLesson[];
  kind: "used" | "learned";
}): ReactElement | null {
  const mem = useChatMemory();
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const trigger = useRef<unknown>(null);
  if (!mem || lessons.length === 0) return null;
  const label = lessonMarkLabel(kind, lessons.length);
  const close = (): void => {
    setAt(null);
    (trigger.current as { focus?: () => void } | null)?.focus?.();
  };
  const open = (el: unknown): void => {
    const box = (
      el as { getBoundingClientRect?: () => { left: number; top: number; right: number; bottom: number } } | null
    )?.getBoundingClientRect?.();
    const g = globalThis as { innerWidth?: number; innerHeight?: number };
    const win = { width: g.innerWidth ?? 1200, height: g.innerHeight ?? 800 };
    const height = 44 + lessons.length * 40;
    setAt(box ? placeNear(box, { width: Math.min(MARK_W, win.width - 16), height }, win) : { left: 8, top: 8 });
  };
  return (
    <>
      <Pressable
        ref={(r) => {
          trigger.current = r;
        }}
        accessibilityRole="button"
        accessibilityLabel={`${label}. Show ${lessons.length === 1 ? "it" : "them"}`}
        accessibilityState={{ expanded: at !== null }}
        testID={`lesson-mark-${id}`}
        onPress={(e) => (at ? close() : open((e as unknown as { currentTarget: unknown }).currentTarget))}
        {...webProps({ title: label })}
        style={({ hovered }: { hovered?: boolean }) => [
          st.mark,
          hovered === true && st.markOver,
          at !== null && st.markOver,
        ]}
      >
        <Icon name="bulb" size={13} color="var(--ink-3)" />
        {lessons.length > 1 ? (
          <Text testID={`lesson-mark-count-${id}`} style={st.count}>
            {lessons.length}
          </Text>
        ) : null}
      </Pressable>
      {at ? <LessonList id={id} kind={kind} lessons={lessons} at={at} onClose={close} /> : null}
    </>
  );
}

/** The list a mark opens, in the overlay layer. A press outside closes it; so does Escape. */
function LessonList({
  id,
  kind,
  lessons,
  at,
  onClose,
}: {
  id: string;
  kind: "used" | "learned";
  lessons: readonly MarkLesson[];
  at: { left: number; top: number };
  onClose: () => void;
}): ReactElement {
  const mem = useChatMemory()!;
  const thread = useThreadMemory();
  const card = useRef<unknown>(null);
  const [whole, setWhole] = useState<string | null>(null);
  useEffect(() => {
    (card.current as { focus?: () => void } | null)?.focus?.();
    const doc = (
      globalThis as {
        document?: {
          addEventListener(t: string, f: (e: { key: string }) => void): void;
          removeEventListener(t: string, f: (e: { key: string }) => void): void;
        };
      }
    ).document;
    if (!doc) return undefined;
    const key = (e: { key: string }): void => {
      if (e.key === "Escape") onClose();
    };
    doc.addEventListener("keydown", key);
    return () => doc.removeEventListener("keydown", key);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const say = (text: string, undo?: () => void | Promise<unknown>): void => thread?.flash(text, undo);
  return (
    <Overlay>
      <Pressable
        accessibilityLabel="Close the list of lessons"
        accessibilityRole="button"
        testID={`lesson-list-away-${id}`}
        onPress={onClose}
        style={st.away}
        {...webProps({ tabIndex: -1 })}
      />
      <View
        ref={(r) => {
          card.current = r;
        }}
        testID={`lesson-list-${id}`}
        accessibilityLabel={kind === "used" ? "Kept in mind" : "Lessons learned from this message"}
        {...webProps({ role: "dialog", tabIndex: -1 })}
        style={[st.card, { left: at.left, top: at.top } as object]}
      >
        <Text style={st.head}>{kind === "used" ? "Kept in mind" : "Lessons learned from this message"}</Text>
        {lessons.map((l) => (
          // ui-rows-lint: not a list (a handful of rows of one popover, each with its own two buttons)
          <View key={l.factId} testID={`lesson-row-${l.factId}`} style={st.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: whole === l.factId }}
              accessibilityLabel={`${l.text}. ${whole === l.factId ? "Show less" : "Show all of it"}`}
              testID={`lesson-text-${l.factId}`}
              onPress={() => setWhole((w) => (w === l.factId ? null : l.factId))}
              style={st.words}
            >
              <Text numberOfLines={whole === l.factId ? undefined : 1} style={st.text}>
                {l.text}
              </Text>
            </Pressable>
            <View style={st.acts}>
              {mem.showKnows ? (
                <LinkButton
                  label="See"
                  testID={`lesson-see-${l.factId}`}
                  a11y={`See what the agent has learned: ${l.text}`}
                  onPress={() => {
                    onClose();
                    mem.showKnows?.();
                  }}
                />
              ) : null}
              <LinkButton
                label="Remove"
                quiet
                testID={`lesson-remove-${l.factId}`}
                a11y={`Remove this lesson: ${l.text}`}
                onPress={() => {
                  onClose();
                  void forgetFacts(mem, [l.factId], say, "Removed the lesson. It stays in Trash for 60 days.");
                }}
              />
            </View>
          </View>
        ))}
      </View>
    </Overlay>
  );
}

const st = StyleSheet.create({
  mark: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 22,
    minWidth: 22,
    paddingHorizontal: 4,
    borderRadius: 6,
    justifyContent: "center",
  },
  markOver: { backgroundColor: "var(--hover)" as string },
  count: { fontSize: 11.5, fontWeight: "500", color: "var(--ink-3)" as string },
  away: { position: "fixed", left: 0, top: 0, right: 0, bottom: 0 } as object,
  card: {
    position: "fixed",
    width: `min(${MARK_W}px, calc(100vw - 16px))`,
    paddingTop: 10,
    paddingHorizontal: 12,
    paddingBottom: 6,
    borderRadius: 12,
    backgroundColor: "var(--raised)" as string,
    boxShadow: "var(--sh-2), inset 0 0 0 1px var(--line-2)",
    outlineStyle: "none",
  } as object,
  head: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string, marginBottom: 4 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    columnGap: 8,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: "var(--line)" as string,
  },
  words: { flex: 1, minWidth: 0, paddingVertical: 2 },
  text: { fontSize: 13, lineHeight: 18, color: "var(--ink)" as string },
  acts: { flexDirection: "row", alignItems: "center", gap: 2 },
});
