import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { CapCall } from "../shell/session/caps.ts";
import type { CardKind, Progress } from "./flow.ts";
import { previewFor } from "./preview.ts";
import type { Preview } from "./preview.ts";

/** The live preview: what the current step has set up, as chips and lines, refreshed when a step changes. */
export function PreviewPane({ call, card, progress, fallback }: { call: CapCall | null; card: CardKind; progress: Progress; fallback: string }): ReactElement {
  const [p, setP] = useState<Preview | null>(null);
  const key = JSON.stringify(progress);
  useEffect(() => {
    if (!call) { setP(null); return undefined; }
    let off = false;
    void previewFor(call, card).then((r) => { if (!off) setP(r); });
    return () => { off = true; };
  }, [call, card, key]);
  return <PreviewView preview={p} fallback={fallback} />;
}

export function PreviewView({ preview, fallback }: { preview: Preview | null; fallback: string }): ReactElement {
  if (!preview) return <Text style={s.hint}>{fallback}</Text>;
  return (
    <View testID="preview-pane" style={s.col}>
      <Text style={s.head}>{preview.heading}</Text>
      {preview.items.length === 0 ? <Text testID="preview-empty" style={s.hint}>{preview.hint}</Text> : preview.items.map((i) => (
        <View key={i.id} testID="preview-item" style={s.chip}><Text style={s.chipText}>{i.label}</Text>{i.note ? <Text style={s.chipNote}>{i.note}</Text> : null}</View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  col: { gap: 8 },
  head: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string, paddingHorizontal: 8 },
  hint: { fontSize: 13, lineHeight: 19, color: "var(--ink-3)" as string, paddingHorizontal: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string, gap: 2 },
  chipText: { fontSize: 13.5, color: "var(--ink)" as string, lineHeight: 19 },
  chipNote: { fontSize: 12, color: "var(--ink-3)" as string },
});
