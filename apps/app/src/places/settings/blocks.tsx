// Shared page blocks: the registry rows of a page in their sections, the page's own card (profile), a read hook for the capabilities that are not live queries, and the bar for a usage figure.
import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSettingsData } from "./data.tsx";
import { sectionsFor } from "./model.ts";
import type { PageKey, SettingRow } from "./model.ts";
import { SettingRowFor } from "./rows.tsx";
import { Section } from "./ui.tsx";

/** The rows of the registry that belong to a page, grouped under their headings. `found` is the key the search is pointing at. */
export function RegistrySections({ page, rows, found, skip = [] }: { page: PageKey; rows: readonly SettingRow[]; found?: string | null; skip?: readonly string[] }): ReactElement {
  const parts: ReactElement[] = [];
  for (const sec of sectionsFor(page, rows)) {
    const list = sec.rows.filter((r) => !skip.includes(r.key));
    if (list.length === 0) continue;
    const items: ReactElement[] = [];
    list.forEach((r, i) => items.push(<SettingRowFor key={r.key} row={r} first={i === 0} found={found === r.key} />));
    parts.push(<Section key={sec.title} title={sec.title}>{items}</Section>);
  }
  return <>{parts}</>;
}

/** Run a read that the screen does not keep live (a catalogue) once, and hold its answer. */
export function useRead<T>(cap: string, input: unknown = {}): T | null {
  const data = useSettingsData();
  const key = JSON.stringify(input);
  const [out, setOut] = useState<T | null>(() => (data.peek?.(cap, JSON.parse(key) as unknown) as T | undefined) ?? null);
  useEffect(() => {
    let live = true;
    void data.call(cap, JSON.parse(key) as unknown).then((v) => { if (live) setOut(v as T); }).catch(() => { if (live) setOut(null); });
    return () => { live = false; };
  }, [data, cap, key]);
  return out;
}

export function Bar({ ratio, tone = "accent" }: { ratio: number; tone?: "accent" | "warn" }): ReactElement {
  const pct = Math.max(0, Math.min(1, ratio));
  return (
    <View style={s.track} aria-hidden>
      <View style={[s.fill, { width: `${Math.round(pct * 100)}%` as unknown as number, backgroundColor: (tone === "warn" ? "var(--warn)" : "var(--accent)") as string }]} />
    </View>
  );
}

export function Hint({ children }: { children: ReactNode }): ReactElement {
  return <Text style={s.hint}>{children}</Text>;
}

export function Everywhere({ text }: { text: string }): ReactElement {
  return <Text style={s.every} testID="everywhere-note">{text}</Text>;
}

const s = StyleSheet.create({
  track: { height: 6, borderRadius: 3, backgroundColor: "var(--press)" as string, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  hint: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string },
  every: { fontSize: 12.5, color: "var(--ink-3)" as string, marginTop: 14 },
});
