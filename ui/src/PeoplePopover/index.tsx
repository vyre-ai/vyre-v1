// ui/PeoplePopover: the people popover that opens from the face stack or the count in a chat or project header. One component for both. Title "People and agents", one row per member
// (face, name, the role right-aligned in muted text), a divider and one footer action. A row opens the person's profile or the agent's page; a right-click (or long press) offers
// Message, Change role, Remove and Copy Link where allowed. Arrow keys move through the rows and the footer, Enter opens, Escape closes. Rounded 12, the pop shadow, a soft fill under the pointer.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { ViewStyle } from "react-native";
import { Avatar } from "../Avatar/index.tsx";
import { menuTrigger, useMenu } from "../Menu/index.tsx";
import { AccessIcon } from "../AccessSheet/index.tsx";
import { Overlay } from "../Overlay/index.tsx";
import { TITLE, footerOf, memberMenu, walk } from "./model.ts";
import type { MemberAction, MemberPerms, MemberRow, PeopleWhere } from "./model.ts";

export { TITLE, footerOf, memberMenu, walk } from "./model.ts";
export type { MemberAction, MemberKind, MemberMenuItem, MemberPerms, MemberRow, PeopleWhere } from "./model.ts";

export interface PeoplePopoverProps {
  where: PeopleWhere;
  rows: readonly MemberRow[];
  /** The viewer, so Remove is never offered on yourself. */
  meId?: string;
  perms: MemberPerms;
  /** Where the trigger is: the popover sits under it, its right edge to the trigger's. */
  anchor: { x: number; y: number };
  onOpen(row: MemberRow): void;
  onAction(action: MemberAction, row: MemberRow): void;
  /** The footer action: "overview" opens the project's Overview People section, "add" opens the Add sheet. */
  onFooter(id: "overview" | "add"): void;
  onClose(): void;
}

const web = Platform.OS === "web";

function each<T>(list: readonly T[], make: (item: T, at: number) => ReactElement): ReactElement[] {
  const out: ReactElement[] = [];
  list.forEach((item, at) => out.push(make(item, at)));
  return out;
}

export function PeoplePopover({ where, rows, meId, perms, anchor, onOpen, onAction, onFooter, onClose }: PeoplePopoverProps): ReactElement {
  const win = useWindowDimensions();
  const menu = useMenu();
  const [at, setAt] = useState(-1);
  const footer = footerOf(where);
  const count = rows.length + 1;
  useEffect(() => {
    if (!web) return undefined;
    const doc = (globalThis as { document?: { addEventListener(n: string, f: (e: { key: string; preventDefault?(): void }) => void): void; removeEventListener(n: string, f: (e: { key: string; preventDefault?(): void }) => void): void } }).document;
    if (!doc) return undefined;
    const key = (e: { key: string; preventDefault?(): void }): void => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") { e.preventDefault?.(); setAt((a) => walk(a, e.key, count)); return; }
      if (e.key === "Enter" && at >= 0) {
        e.preventDefault?.();
        if (at < rows.length) onOpen(rows[at] as MemberRow); else onFooter(footer.id);
      }
    };
    doc.addEventListener("keydown", key);
    return () => doc.removeEventListener("keydown", key);
  }, [at, count, rows, footer.id, onClose, onOpen, onFooter]);
  const width = Math.min(260, (win.width || 1024) - 16);
  const left = Math.max(8, Math.min(anchor.x - width, (win.width || 1024) - width - 8));
  const top = Math.max(8, anchor.y + 4);
  const place = { position: web ? "fixed" : "absolute", left, top, width } as unknown as ViewStyle;
  const rowMenu = (r: MemberRow, x: number, y: number): void => {
    const items = memberMenu(r, perms, meId);
    menu.show(items.map((i) => ({ label: i.label, ...(i.danger ? { danger: true } : {}), onSelect: () => onAction(i.id, r) })), x, y, "context", { label: `${r.name}` });
  };
  return (
    <Overlay>
      <View style={st.layer}>
        <Pressable accessibilityLabel="Close" accessible={false} onPress={onClose} testID="people-scrim" style={StyleSheet.absoluteFill} />
        <View role="dialog" aria-modal={false} accessibilityLabel={TITLE} testID="people-popover" style={[st.pop, { boxShadow: "var(--sh-pop)" } as unknown as ViewStyle, place]}>
          <Text style={st.head} accessibilityRole="header" testID="people-title">{TITLE}</Text>
          {each(rows, (r, i) => (
            <Pressable
              key={`${r.kind}:${r.id}`} accessibilityRole="button" accessibilityLabel={`${r.name}, ${r.role}`} testID={`people-row-${r.id}`}
              onPress={() => onOpen(r)} {...menuTrigger((x, y) => rowMenu(r, x, y))}
              style={({ hovered }: { hovered?: boolean }) => [st.row, (hovered === true || at === i) && st.lit, at === i && st.kb]}
            >
              {r.kind === "person" ? <Avatar name={r.name} seedId={r.id} size={24} /> : <Avatar name={r.name} seedId={r.id} kind="agent" size={24} />}
              <Text style={st.name} numberOfLines={1}>{r.id === meId ? "You" : r.name}</Text>
              <Text style={st.role} numberOfLines={1} testID={`people-role-${r.id}`}>{r.role}</Text>
            </Pressable>
          ))}
          <View style={st.rule} />
          <Pressable
            accessibilityRole="button" accessibilityLabel={footer.label} testID="people-footer" onPress={() => onFooter(footer.id)}
            style={({ hovered }: { hovered?: boolean }) => [st.row, (hovered === true || at === rows.length) && st.lit, at === rows.length && st.kb]}
          >
            <View style={st.ic}><AccessIcon name={footer.id === "add" ? "plus" : "people"} size={15} color="var(--ink-2)" /></View>
            <Text style={st.name}>{footer.label}</Text>
          </Pressable>
        </View>
        {menu.element}
      </View>
    </Overlay>
  );
}

const st = StyleSheet.create({
  layer: { position: (web ? "fixed" : "absolute") as unknown as "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99997 },
  pop: { padding: 5, borderRadius: 12, backgroundColor: "var(--raised)" as string, minWidth: 220 },
  head: { paddingHorizontal: 8, paddingTop: 7, paddingBottom: 3, fontSize: 11, fontWeight: "600", color: "var(--ink-3)" as string },
  row: { flexDirection: "row", alignItems: "center", gap: 9, height: 32, paddingHorizontal: 8, borderRadius: 6 },
  lit: { backgroundColor: "var(--hover)" as string },
  kb: { backgroundColor: "var(--sel)" as string },
  name: { flex: 1, minWidth: 0, fontSize: 13, color: "var(--ink)" as string },
  role: { fontSize: 12, color: "var(--ink-3)" as string, paddingLeft: 12 },
  ic: { width: 22, alignItems: "center", justifyContent: "center" },
  rule: { height: 1, backgroundColor: "var(--line)" as string, marginVertical: 5, marginHorizontal: 6 },
});
