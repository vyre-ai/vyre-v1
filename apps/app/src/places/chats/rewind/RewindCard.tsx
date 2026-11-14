// The Rewind card (chat gap G36, G37): "Go back to", the points of this chat with their time and file count, and, before anything is pressed, what going back undoes and what it never touches. Opened from the
// chat's menu, a message's menu ("Rewind to here") and /rewind; each opens this one card. One press on a point selects it; "Go back" calls chat.rewind. Off in a chat with other people.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useConversationData } from "../conversation/data.tsx";
import { LEAVES, NONE, UNDOES, UNDO_NOTE, pointLine, whyOff } from "./model.ts";
import type { RewindPoint } from "./model.ts";

type Read =
  | { state: "loading" }
  | { state: "off"; why?: string | undefined }
  | { state: "ready"; points: RewindPoint[] };

export function RewindCard({
  threadId,
  onClose,
  clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
  start,
}: {
  threadId: string;
  onClose(): void;
  clock?(ms: number): string;
  /** Rewind to here: the point nearest this time is selected first. */
  start?: number | undefined;
}): ReactElement {
  const data = useConversationData();
  const [read, setRead] = useState<Read>({ state: "loading" });
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let gone = false;
    try {
      void Promise.resolve(data.call("engine.rewind.points", { threadId })).then(
        (r) => {
          if (gone) return;
          const out = r as { available: boolean; why?: string; points: RewindPoint[] };
          if (!out.available) return setRead({ state: "off", why: out.why });
          setRead({ state: "ready", points: out.points });
          const near =
            start !== undefined
              ? [...out.points].sort((a, b) => Math.abs(a.at - start) - Math.abs(b.at - start))[0]
              : out.points[0];
          if (near) setPick(near.pointId);
        },
        () => !gone && setRead({ state: "off" }),
      );
    } catch {
      setRead({ state: "off" });
    }
    return () => {
      gone = true;
    };
  }, [data, threadId, start]);
  const go = (): void => {
    if (busy || pick === null) return;
    setBusy(true);
    setFailed(false);
    try {
      void Promise.resolve(
        data.call("chat.rewind", { threadId, pointId: pick, idempotencyKey: `rewind-${threadId}-${pick}` }),
      ).then(
        () => onClose(),
        () => {
          setBusy(false);
          setFailed(true);
        },
      );
    } catch {
      setBusy(false);
      setFailed(true);
    }
  };
  return (
    <View testID="rewind-card" style={st.card}>
      <Text accessibilityRole="header" style={st.title}>
        Go back to
      </Text>
      {read.state === "off" ? <Text style={st.note}>{whyOff(read.why)}</Text> : null}
      {read.state === "ready" && read.points.length === 0 ? <Text style={st.note}>{NONE}</Text> : null}
      {read.state === "ready" ? (
        <View accessibilityRole="radiogroup" style={st.list}>
          {read.points.map((p) => {
            const l = pointLine(p, clock);
            const on = p.pointId === pick;
            return (
              <Pressable
                key={p.pointId}
                testID={`rewind-point-${p.pointId}`}
                accessibilityRole="radio"
                aria-checked={on}
                onPress={() => setPick(p.pointId)}
                style={[st.row, on && st.rowOn]}
              >
                <View style={[st.dot, on && st.dotOn]} />
                <Text style={st.when}>{l.when}</Text>
                <Text numberOfLines={1} style={st.what}>
                  {l.what}
                </Text>
                <Text style={st.files}>{l.files}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {/* said before anything is pressed */}
      <Text testID="rewind-undoes" style={st.note}>
        {UNDOES}
      </Text>
      <Text testID="rewind-leaves" style={st.note}>
        {LEAVES}
      </Text>
      <Text style={st.note}>{UNDO_NOTE}</Text>
      {failed ? <Text style={st.warn}>It did not go back. Nothing changed.</Text> : null}
      <View style={st.foot}>
        <Pressable
          testID="rewind-go"
          accessibilityRole="button"
          disabled={busy || pick === null || read.state !== "ready"}
          onPress={go}
          style={[st.go, (busy || pick === null) && st.dim]}
        >
          <Text style={st.goText}>Go back</Text>
        </Pressable>
        <Pressable testID="rewind-cancel" accessibilityRole="button" onPress={onClose} style={st.cancel}>
          <Text style={st.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  card: {
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "var(--line)" as string,
    backgroundColor: "var(--surface)" as string,
    maxWidth: 520,
  },
  title: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  list: { gap: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  rowOn: { backgroundColor: "var(--hover)" as string },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: "var(--ink-3)" as string },
  dotOn: { borderColor: "var(--accent)" as string, backgroundColor: "var(--accent)" as string },
  when: { fontSize: 13, color: "var(--ink)" as string, width: 64 },
  what: { fontSize: 13, color: "var(--ink-2)" as string, flexShrink: 1, flexGrow: 1, minWidth: 0 },
  files: { fontSize: 12.5, color: "var(--ink-3)" as string },
  note: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string },
  warn: { fontSize: 12.5, color: "var(--warn)" as string },
  foot: { flexDirection: "row", gap: 8, marginTop: 4 },
  go: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: "var(--accent)" as string },
  dim: { opacity: 0.5 },
  goText: { fontSize: 13, fontWeight: "600", color: "var(--on-accent)" as string },
  cancel: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "var(--line)" as string,
  },
  cancelText: { fontSize: 13, color: "var(--ink)" as string },
});
