// Vault item > Who can use it: the people, groups and agents that hold the item, each a ui/Row with their level on the right ("Use", "View", "Edit", "Manage"). A direct grant has a menu to
// change the level or stop sharing (vault.share, vault.unshare); a grant that comes from the folder or a role shows its level and says so. The list is access.shares_of, never a value.
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ReactElement } from "react";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { menuTrigger } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { Btn, Glyph } from "../layout/parts.tsx";
import type { Share } from "../layout/model.ts";

export const LEVEL_LABEL: Readonly<Record<Share["level"], string>> = { use: "Use", view: "View", edit: "Edit", manage: "Manage" };
const LEVEL_NOTE: Readonly<Record<Share["level"], string>> = {
  use: "Works with it without seeing the value", view: "Can reveal values (asks once, logged)", edit: "Can edit the fields", manage: "Can edit, share and delete",
};
const LEVELS: readonly Share["level"][] = ["use", "view", "edit", "manage"];
const KIND_LABEL: Readonly<Record<Share["subject"]["kind"], string>> = { person: "Person", group: "Group", role: "Role", agent: "Agent", actor: "Outside", service: "Service", link: "Link" };

/** The menu of one grant's level: the four levels with the current one checked, then Stop sharing. */
export function levelEntries(current: Share["level"], pick: (l: Share["level"]) => void, remove: () => void): MenuEntry[] {
  const out: MenuEntry[] = [{ head: "Can" }];
  for (const l of LEVELS) out.push({ label: `${LEVEL_LABEL[l]}`, checked: current === l, onSelect: () => pick(l) });
  out.push({ separator: true }, { label: "Stop sharing", danger: true, onSelect: remove });
  return out;
}

/** What a level lets a person do, for the tooltip and the screen reader. */
export const levelNote = (l: Share["level"]): string => LEVEL_NOTE[l];

function Mark({ name, kind }: { name: string; kind: Share["subject"]["kind"] }): ReactElement {
  const round = kind === "person";
  return (
    <View aria-hidden style={[s.mark, { borderRadius: round ? 11 : 7 }]}>
      <Text style={s.markText}>{(name.trim()[0] ?? "?").toUpperCase()}</Text>
    </View>
  );
}

export interface WhoCanUseProps {
  shares: readonly Share[];
  nameOf: (subject: Share["subject"]) => string;
  meId: string;
  /** You hold Manage on the item: levels can change and access can stop. */
  canManage: boolean;
  onLevel: (share: Share, level: Share["level"]) => void;
  onRemove: (share: Share) => void;
  onShare: () => void;
  onMenu: (entries: MenuEntry[], x: number, y: number) => void;
}

export function WhoCanUse({ shares, nameOf, meId, canManage, onLevel, onRemove, onShare, onMenu }: WhoCanUseProps): ReactElement {
  const rows: ReactElement[] = [];
  for (const sh of shares) {
    if (sh.subject.kind === "person" && sh.subject.id === meId) continue;
    const name = nameOf(sh.subject);
    const key = `${sh.subject.kind}:${sh.subject.id}`;
    const direct = sh.through === "direct" && canManage;
    const open = (x: number, y: number): void => onMenu(levelEntries(sh.level, (l) => onLevel(sh, l), () => onRemove(sh)), x, y);
    rows.push(
      <View key={key} {...(direct ? menuTrigger(open) : {})}>
        <Row
          id={`who:${key}`}
          title={name}
          note={sh.through === "folder" ? `${KIND_LABEL[sh.subject.kind]} · from the folder` : sh.through === "group" || sh.through === "role" ? `${KIND_LABEL[sh.subject.kind]} · through a ${sh.through}` : KIND_LABEL[sh.subject.kind]}
          leading={<Mark name={name} kind={sh.subject.kind} />}
          trailing={direct ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`${name} can ${LEVEL_LABEL[sh.level]}. Change`} testID={`who-level-${key}`} onPress={(e) => { const r = rectOf(e); open(r.x, r.y); }} style={s.level}>
              <Text style={s.levelText}>{LEVEL_LABEL[sh.level]}</Text><Glyph name="chevd" size={10} />
            </Pressable>
          ) : <Text style={s.levelFixed} testID={`who-level-${key}`}>{LEVEL_LABEL[sh.level]}</Text>}
        />
      </View>,
    );
  }
  return (
    <View testID="item-who">
      <View style={s.head}>
        <Text style={s.h2}>Who can use it</Text>
        <View style={{ flex: 1 }} />
        {canManage ? <Btn label="Share" icon="share" onPress={onShare} testID="who-share" /> : null}
      </View>
      {rows.length === 0 ? <Text style={s.empty} testID="who-empty">Only you.</Text> : rows}
    </View>
  );
}

function rectOf(e: unknown): { x: number; y: number } {
  const ev = e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } }; nativeEvent?: { pageX?: number; pageY?: number } };
  const box = ev.currentTarget?.getBoundingClientRect?.();
  return box ? { x: box.left, y: box.bottom } : { x: ev.nativeEvent?.pageX ?? 0, y: ev.nativeEvent?.pageY ?? 0 };
}

const s = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", marginTop: 10, marginBottom: 6 },
  h2: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  empty: { fontSize: 13, color: "var(--ink-3)" as string, paddingHorizontal: 4, paddingVertical: 6 },
  mark: { width: 24, height: 24, alignItems: "center", justifyContent: "center", marginRight: 10, backgroundColor: "var(--sunk)" as string, ...({ boxShadow: "inset 0 0 0 1px var(--line)" } as object) },
  markText: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-2)" as string },
  level: { flexDirection: "row", alignItems: "center", gap: 5, height: 26, paddingHorizontal: 8, borderRadius: 7 },
  levelText: { fontSize: 13, color: "var(--ink-2)" as string },
  levelFixed: { fontSize: 13, color: "var(--ink-3)" as string, paddingHorizontal: 8 },
});
