// The Space feels alive (lane r42-alive), two calm lines at the top of Tasks and nothing else:
//   StillCard  "Still need these?": the few tasks the Space cannot tell about, each with why it is asked, Keep or Archive per row or all. Never a notification. It replaces the old "not moved in weeks" fold.
//   AliveLine  "Since Tuesday: 3 put away, 2 new for you": what the Space did on its own, built from the log (tasks.changes), each item with its reason and Put back.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { Row } from "../../../../../../ui/src/Row/index.tsx";

type Call = (cap: string, input: unknown) => Promise<unknown>;
type Card = CapMap["tasks.still_needed"]["out"];
type Changes = CapMap["tasks.changes"]["out"];
const DAY = 86_400_000;
const SEEN_KEY = "vyre.tasks.alive.seen";

function Btn({ label, testID, onPress }: { label: string; testID: string; onPress(): void }): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      style={({ hovered }: { hovered?: boolean }) => [st.btn, hovered === true && st.over]}
    >
      <Text style={st.btnText}>{label}</Text>
    </Pressable>
  );
}

export function StillCard({
  call,
  rev,
  openTask,
  onChanged,
}: {
  call: Call;
  rev: string | undefined;
  openTask(id: string): void;
  onChanged(): void;
}): ReactElement | null {
  const [card, setCard] = useState<Card | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback((): void => {
    void call("tasks.still_needed", {}).then(
      (o) => setCard(o as Card),
      () => undefined,
    );
  }, [call]);
  useEffect(load, [load, rev]);
  const answer = (ids: readonly string[], a: "keep" | "archive"): void => {
    if (busy || ids.length === 0) return;
    setBusy(true);
    void call("tasks.still_answer", { taskIds: [...ids], answer: a }).then(
      () => {
        setBusy(false);
        load();
        onChanged();
      },
      () => {
        setBusy(false);
        load();
      },
    );
  };
  if (!card || card.items.length === 0) return null;
  const ids = card.items.map((i) => i.task.id);
  return (
    <View testID="tasks-still" style={st.wrap}>
      <View style={st.box}>
        <View style={st.head}>
          <View style={{ flex: 1, minWidth: 170 }}>
            <Text style={st.title}>Still need these?</Text>
            <Text style={st.sub}>{`${card.total} ${card.total === 1 ? "task" : "tasks"} may be finished`}</Text>
          </View>
          {open ? (
            <View style={st.btns}>
              <Btn label="Keep all" testID="still-keep-all" onPress={() => answer(ids, "keep")} />
              <Btn label="Archive all" testID="still-archive-all" onPress={() => answer(ids, "archive")} />
            </View>
          ) : (
            <Btn label="Go through them" testID="still-open" onPress={() => setOpen(true)} />
          )}
        </View>
        {open
          ? card.items.map((i) => (
              <Row
                key={i.task.id}
                title={i.task.title}
                note={i.why}
                tall
                onPress={() => openTask(i.task.id)}
                trailing={
                  <View style={st.btns}>
                    <Btn label="Keep" testID="still-keep" onPress={() => answer([i.task.id], "keep")} />
                    <Btn label="Archive" testID="still-archive" onPress={() => answer([i.task.id], "archive")} />
                  </View>
                }
              />
            ))
          : null}
      </View>
    </View>
  );
}

const readSeen = (): number | null => {
  try {
    const v = Number(globalThis.localStorage?.getItem(SEEN_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
};
const writeSeen = (at: number): void => {
  try {
    globalThis.localStorage?.setItem(SEEN_KEY, String(at));
  } catch {
    /* a per-viewer convenience: without storage the line shows again */
  }
};

/** "Since Tuesday": the weekday of the time the line reaches back to. */
export const sinceWords = (since: number, now: number): string =>
  now - since < DAY
    ? "Since this morning"
    : `Since ${new Intl.DateTimeFormat("en-GB", { weekday: "long" }).format(since)}`;

/** The words of the counts: only what happened, never a zero. */
export function aliveWords(c: Pick<Changes, "items" | "fresh">): string {
  const put = c.items.length;
  const parts: string[] = [];
  if (put > 0) parts.push(`${put} put away`);
  if (c.fresh > 0) parts.push(`${c.fresh} new for you`);
  return parts.join(", ");
}

export function AliveLine({
  call,
  now,
  rev,
  openTask,
  onChanged,
}: {
  call: Call;
  now: number;
  rev: string | undefined;
  openTask(id: string): void;
  onChanged(): void;
}): ReactElement | null {
  const [since] = useState(() => readSeen() ?? now - 7 * DAY);
  const [data, setData] = useState<Changes | null>(null);
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false);
  const load = useCallback((): void => {
    void call("tasks.changes", { since }).then(
      (o) => setData(o as Changes),
      () => undefined,
    );
  }, [call, since]);
  useEffect(load, [load, rev]);
  if (gone || !data || (data.items.length === 0 && data.fresh === 0)) return null;
  const putBack = (id: string): void => {
    void call("tasks.unarchive", { taskId: id }).then(
      () => {
        load();
        onChanged();
      },
      () => undefined,
    );
  };
  return (
    <View testID="tasks-alive" style={st.wrap}>
      <View style={st.box}>
        <View style={st.head}>
          <Pressable
            accessibilityRole="button"
            testID="alive-open"
            onPress={() => setOpen((o) => !o)}
            style={{ flex: 1, minWidth: 0 }}
          >
            <Text numberOfLines={1} style={st.title}>{`${sinceWords(since, now)}: ${aliveWords(data)}`}</Text>
          </Pressable>
          <Btn
            label="Got it"
            testID="alive-seen"
            onPress={() => {
              writeSeen(now);
              setGone(true);
            }}
          />
        </View>
        {open
          ? data.items.map((i) => (
              <Row
                key={i.taskId}
                title={i.title}
                note={i.why}
                onPress={() => openTask(i.taskId)}
                trailing={<Btn label="Put back" testID="alive-put-back" onPress={() => putBack(i.taskId)} />}
              />
            ))
          : null}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { width: "100%", maxWidth: 700, alignSelf: "center", paddingHorizontal: 16, paddingBottom: 6 },
  box: {
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: "var(--sunk)" as string,
  },
  head: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, rowGap: 4 },
  title: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  sub: { fontSize: 13, color: "var(--ink-3)" as string },
  btns: { flexDirection: "row", gap: 4 },
  btn: { height: 28, justifyContent: "center", paddingHorizontal: 10, borderRadius: 9 },
  btnText: { fontSize: 13, color: "var(--ink-2)" as string },
  over: { backgroundColor: "var(--hover)" as string },
});
