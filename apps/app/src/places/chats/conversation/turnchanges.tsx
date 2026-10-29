// The card under an agent's reply that lists what the turn changed, with one Undo that puts every record, field and file back. Changes that cannot be taken back (a send, a deploy)
// are listed with "can't be undone" and stay as they are. Undo is the engine.turn.undo capability, so it works for the person who asked and for anyone who may edit what changed.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Block } from "../../../../../../ui/src/kit/types.ts";
import type { BlockHost } from "../../../../../../ui/src/blocks/impl-a/index.tsx";
import { Glyph, TextButton } from "./parts.tsx";
import { collect } from "./model.ts";

export interface TurnChange { label: string; undoable: boolean }

export interface TurnChangesData {
  threadId: string;
  turnId: string;
  summary: string;
  changes: TurnChange[];
  undone: boolean;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export const isTurnChanges = (b: { type: string }): boolean => b.type === "turn_changes";

export function turnChangesData(data: unknown): TurnChangesData {
  const d = isRec(data) ? data : {};
  const changes = collect((Array.isArray(d.changes) ? d.changes : []).filter(isRec), (c): TurnChange => ({ label: str(c.label), undoable: c.undoable === true }));
  return { threadId: str(d.threadId), turnId: str(d.turnId), summary: str(d.summary), changes, undone: d.undone === true };
}

/** Undo shows only while something can still be put back. */
export const canUndo = (d: TurnChangesData, undone: boolean): boolean => !undone && d.changes.some((c) => c.undoable);

/** What the card says once the press has run: how many went back, and what was left (a change that moved on, or one the person may not edit). */
export function undoneLine(undone: number, left: readonly string[]): string {
  const base = `Undone: ${undone} change${undone === 1 ? "" : "s"} put back.`;
  return left.length === 0 ? base : `${base} ${left.length} could not be put back.`;
}

export function TurnChangesCard({ block, host }: { block: Block; host: BlockHost }): ReactElement {
  const d = turnChangesData(block.data);
  const [undone, setUndone] = useState(d.undone);
  const [line, setLine] = useState("");
  const [busy, setBusy] = useState(false);
  const id = block.id;
  // A reload shows the true state: the engine knows whether this turn was already undone, even by someone else.
  useEffect(() => {
    if (d.undone || d.turnId === "") return;
    let live = true;
    void Promise.resolve(host.invoke("engine.turn.changes", { threadId: d.threadId, turnId: d.turnId })).then((r) => {
      if (live && isRec(r) && r.undone === true) setUndone(true);
    }, () => undefined);
    return () => { live = false; };
  }, [host, d.undone, d.threadId, d.turnId]);
  const undo = (): void => {
    if (busy) return;
    setBusy(true);
    void Promise.resolve(host.invoke("engine.turn.undo", { threadId: d.threadId, turnId: d.turnId })).then(
      (r) => {
        const out = isRec(r) ? r : {};
        setUndone(true);
        setLine(undoneLine(typeof out.undone === "number" ? out.undone : 0, Array.isArray(out.left) ? out.left.map(str) : []));
        setBusy(false);
      },
      () => { setLine("Could not undo. It may have been undone already."); setBusy(false); },
    );
  };
  return (
    <View testID={`turnchanges-${id}`} accessibilityLabel={d.summary} style={st.card}>
      <View style={st.head}>
        <Glyph name={undone ? "check" : "edit"} size={14} color="var(--ink-3)" />
        <Text testID={`turnchanges-${id}-summary`} style={st.summary}>{undone ? "Undone" : d.summary}</Text>
        {canUndo(d, undone) ? <TextButton label={busy ? "Undoing" : "Undo"} ring testID={`turnchanges-${id}-undo`} onPress={undo} /> : null}
      </View>
      <View testID={`turnchanges-${id}-list`} style={st.list}>
        {collect(d.changes, (c, i) => (
          <View key={i} style={st.row}>
            <Text testID={`turnchanges-${id}-row-${i}`} numberOfLines={2} style={[st.label, undone && c.undoable && st.struck]}>{c.label}</Text>
            {!c.undoable ? <Text testID={`turnchanges-${id}-fixed-${i}`} style={st.fixed}>{"can't be undone"}</Text> : null}
          </View>
        ))}
      </View>
      {line !== "" ? <Text testID={`turnchanges-${id}-result`} style={st.faint}>{line}</Text> : null}
    </View>
  );
}

const RING = { boxShadow: "inset 0 0 0 1px var(--line-2)" } as object;

const st = StyleSheet.create({
  card: { marginTop: 8, marginBottom: 6, maxWidth: 520, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, gap: 8, ...RING },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  summary: { flex: 1, fontSize: 13, color: "var(--ink)" as string },
  list: { gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { flex: 1, fontSize: 12.5, lineHeight: 18, color: "var(--ink-2)" as string },
  struck: { color: "var(--ink-4)" as string, textDecorationLine: "line-through" },
  fixed: { fontSize: 11.5, color: "var(--ink-3)" as string, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, ...RING },
  faint: { fontSize: 12, color: "var(--ink-3)" as string },
});
