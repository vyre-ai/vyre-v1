// Copy from another Space (spec 3.9): the photo, name, handle, time zone and hours, or contact you keep in another Space, brought here in one go. Each is ticked when the other
// Space has a value; the title is never copied and the sheet says so. Applying writes through settings.copy_profile and the page says Saved with Undo.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { COPY, useScreenQuery, useSettingsData } from "./data.tsx";
import { hoursSummary } from "./model.ts";
import type { Hours } from "./model.ts";
import { useSaved } from "./saved.tsx";
import { Glyph, SmallButton, pointer, shadow, webOnly } from "./ui.tsx";
import type { KeyEventLike } from "./ui.tsx";

type Source = CapMap["settings.copy_source"]["out"];
type Field = "photo" | "name" | "handle" | "timezone" | "hours" | "contact";

export interface CopyItem { field: Field; label: string; value: string }

/** The rows the sheet offers: only fields the other Space has a value for. */
export function copyItems(src: Source): CopyItem[] {
  const out: CopyItem[] = [];
  if (src.photoFileId) out.push({ field: "photo", label: "Photo", value: "Your photo" });
  if (src.name) out.push({ field: "name", label: "Name", value: src.name });
  if (src.handle) out.push({ field: "handle", label: "Handle", value: `@${src.handle}` });
  if (src.timezone) out.push({ field: "timezone", label: "Time zone", value: src.timezone });
  if (src.hours) out.push({ field: "hours", label: "Working hours", value: hoursSummary(src.hours as Hours) });
  if (src.contact && (src.contact.email || src.contact.phone)) out.push({ field: "contact", label: "Contact", value: [src.contact.email, src.contact.phone].filter(Boolean).join(", ") });
  return out;
}

/** The `values` the capability takes, for the ticked fields. */
export function copyValues(src: Source, fields: readonly Field[]): Record<string, unknown> {
  const all: Record<Field, unknown> = { photo: src.photoFileId, name: src.name, handle: src.handle, timezone: src.timezone, hours: src.hours, contact: src.contact };
  const out: Record<string, unknown> = {};
  for (const f of fields) out[f] = all[f];
  return out;
}

export function CopyFromSpace({ onClose }: { onClose(): void }): ReactElement {
  const data = useSettingsData();
  const saved = useSaved();
  const q = useScreenQuery<Source>(COPY, "source", {});
  const [off, setOff] = useState<ReadonlySet<Field>>(new Set());
  const [busy, setBusy] = useState(false);
  const other = data.spaces.find((sp) => !sp.current)?.name ?? "your other Space";
  const items = q.status === "ready" ? copyItems(q.data) : [];
  const picked: Field[] = [];
  for (const it of items) if (!off.has(it.field)) picked.push(it.field);
  const apply = async (): Promise<void> => {
    if (q.status !== "ready" || picked.length === 0) return;
    setBusy(true);
    try {
      await data.call("settings.copy_profile", { fields: picked, values: copyValues(q.data, picked) });
      saved.saved(`Copied from ${other}`);
      onClose();
    } catch (e) { saved.failed(e instanceof Error ? e.message : "That did not copy."); setBusy(false); }
  };
  const rows: ReactElement[] = [];
  for (const it of items) {
    const on = !off.has(it.field);
    rows.push(
      <Pressable
        key={it.field} accessibilityRole="checkbox" accessibilityState={{ checked: on }} aria-checked={on} accessibilityLabel={`${it.label}: ${it.value}`} testID={`copy-${it.field}`}
        onPress={() => setOff((cur) => { const n = new Set(cur); if (n.has(it.field)) n.delete(it.field); else n.add(it.field); return n; })}
        style={[c.row, pointer]}
      >
        <View style={[c.box, on && { backgroundColor: "var(--accent)" as string, borderColor: "var(--accent)" as string }]}>{on ? <Glyph name="check" size={11} color="var(--accent-ink)" /> : null}</View>
        <Text style={c.label}>{it.label}</Text>
        <Text numberOfLines={1} style={c.value}>{it.value}</Text>
      </Pressable>,
    );
  }
  return (
    <View style={c.layer} accessibilityViewIsModal testID="copy-sheet" {...webOnly({ onKeyDown: (e: KeyEventLike) => { if (e.key === "Escape") onClose(); } })}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" style={c.dim} onPress={onClose} />
      <View style={[c.sheet, shadow("var(--sh-pop)")]} accessibilityLabel="Copy from another Space" role="dialog">
        <Text accessibilityRole="header" style={c.title}>{`Copy from ${other}`}</Text>
        <Text style={c.note}>Bring over what you keep there. Your title is never copied.</Text>
        <View style={c.list}>{rows}</View>
        {q.status === "ready" && items.length === 0 ? <Text style={c.note} testID="copy-empty">Nothing to copy yet. That Space has no profile details to bring over.</Text> : null}
        <View style={c.actions}>
          <SmallButton label="Cancel" onPress={onClose} testID="copy-cancel" />
          <SmallButton label={`Copy ${picked.length}`} primary disabled={busy || picked.length === 0} onPress={() => void apply()} testID="copy-apply" />
        </View>
      </View>
    </View>
  );
}

const c = StyleSheet.create({
  layer: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", zIndex: 50 },
  dim: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,.32)" },
  sheet: { width: 420, maxWidth: "92%", padding: 18, gap: 10, borderRadius: 14, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  title: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  note: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string },
  list: { borderTopWidth: 1, borderTopColor: "var(--line)" as string, marginTop: 4 },
  row: { height: 40, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  box: { width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: "var(--line-2)" as string, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 13.5, color: "var(--ink)" as string, width: 110 },
  value: { flex: 1, fontSize: 13, color: "var(--ink-3)" as string },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 6 },
});
