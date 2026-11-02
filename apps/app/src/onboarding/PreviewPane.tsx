// The live preview beside a step: what it has set up so far, read from the Space, in its own quiet frame. It refreshes when a step changes and when the Local folders card adds or removes
// a folder. A step whose preview has nothing to say yet (no folder added) draws nothing at all, not an empty frame.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { CapCall } from "../shell/session/caps.ts";
import type { CardKind, Progress } from "./flow.ts";
import { foldersVersion, watchFolders } from "./folders-model.ts";
import { previewFor } from "./preview.ts";
import type { Preview } from "./preview.ts";

export function PreviewPane({ call, card, progress, fallback }: { call: CapCall | null; card: CardKind; progress: Progress; fallback: string }): ReactElement | null {
  const [p, setP] = useState<Preview | null>(null);
  const folders = useSyncExternalStore(watchFolders, foldersVersion, foldersVersion);
  const key = `${JSON.stringify(progress)}:${card === "local_folders" ? folders : 0}`;
  useEffect(() => {
    if (!call) { setP(null); return undefined; }
    let off = false;
    void previewFor(call, card).then((r) => { if (!off) setP(r); });
    return () => { off = true; };
  }, [call, card, key]);
  return <PreviewView preview={p} fallback={card === "local_folders" ? "" : fallback} />;
}

export function PreviewView({ preview, fallback }: { preview: Preview | null; fallback: string }): ReactElement | null {
  if (!preview) return fallback ? <View style={s.frame}><Text style={s.hint}>{fallback}</Text></View> : null;
  if (preview.items.length === 0 && preview.hint === "") return null;
  return (
    <View testID="preview-pane" style={[s.frame, s.col]}>
      <Text style={s.head}>{preview.heading}</Text>
      {/* ui-rows-lint: not a list (the preview shows tags, not list rows) */}
      {preview.items.length === 0 ? <Text testID="preview-empty" style={s.hint}>{preview.hint}</Text> : preview.items.map((i) => (
        <View key={i.id} testID="preview-item" style={s.chip}><Text style={s.chipText} numberOfLines={1}>{i.label}</Text>{i.note ? <Text style={s.chipNote} numberOfLines={1}>{i.note}</Text> : null}</View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  frame: { padding: 14, borderRadius: 12, backgroundColor: "var(--win)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  col: { gap: 10 },
  head: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: "var(--ink)" as string },
  hint: { fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: "var(--sunk)" as string, gap: 2 },
  chipText: { fontSize: 13.5, color: "var(--ink)" as string, lineHeight: 19 },
  chipNote: { fontSize: 12, color: "var(--ink-3)" as string },
});
