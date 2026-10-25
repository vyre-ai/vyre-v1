// Changes save as they are made. The page shows one quiet line, "Saved" with Undo, for the latest change (it fades after six seconds); a refused change says why in a sentence.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Glyph, pointer } from "./ui.tsx";

export interface SavedLine { id: number; text: string; undo?: () => Promise<void> | void; tone: "saved" | "error" }
interface Api { line: SavedLine | null; saved(text: string, undo?: () => Promise<void> | void): void; failed(text: string): void; undo(): void; dismiss(): void }
const Ctx = createContext<Api | null>(null);
export const SAVED_MS = 6000;

export function SavedProvider({ children, ms = SAVED_MS }: { children: ReactNode; ms?: number }): ReactElement {
  const [line, setLine] = useState<SavedLine | null>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismiss = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = null; setLine(null); }, []);
  const put = useCallback((text: string, tone: SavedLine["tone"], undo?: () => Promise<void> | void) => {
    if (timer.current) clearTimeout(timer.current);
    const id = ++seq.current;
    setLine({ id, text, tone, ...(undo ? { undo } : {}) });
    timer.current = setTimeout(() => setLine((cur) => (cur && cur.id === id ? null : cur)), ms);
  }, [ms]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const api = useMemo<Api>(() => ({
    line,
    saved: (text, undo) => put(text, "saved", undo),
    failed: (text) => put(text, "error"),
    undo() { if (line?.undo) { const u = line.undo; dismiss(); void u(); } },
    dismiss,
  }), [line, put, dismiss]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useSaved(): Api {
  const v = useContext(Ctx);
  if (!v) throw new Error("Settings needs a SavedProvider above it");
  return v;
}

/** The line itself: a fixed-height slot so the page never jumps when it appears. */
export function SavedBar(): ReactElement {
  const { line, undo } = useSaved();
  return (
    <View style={s.slot} accessibilityLiveRegion="polite" testID="saved-slot">
      {line ? (
        <View style={s.line} testID={line.tone === "error" ? "saved-error" : "saved"}>
          <Glyph name={line.tone === "error" ? "x" : "check"} size={12} color={line.tone === "error" ? "var(--danger)" : "var(--ok)"} />
          <Text style={s.text}>{line.text}</Text>
          {line.undo ? <Pressable accessibilityRole="button" accessibilityLabel="Undo" testID="undo" onPress={undo} style={pointer}><Text style={s.link}>Undo</Text></Pressable> : null}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  slot: { height: 28, justifyContent: "center" },
  line: { flexDirection: "row", alignItems: "center", gap: 7 },
  text: { fontSize: 12.5, color: "var(--ink-2)" as string },
  link: { fontSize: 12.5, color: "var(--accent)" as string },
});
