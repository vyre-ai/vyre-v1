// ui/ShareSheet: one sheet for every resource (spec 2.4, 4.9; ARCH 4.12). A person, group, role or agent at View, Use, Edit or Manage.
// A folder share covers everything inside; an item share sits on top of its folder and can raise inherited access, never lower it.
// A public link is its own row (subject kind link): view only, and only when the Console sharing rule allows it (allowExternal).
// Every change is one access.share or access.unshare call, built by shareInput and unshareInput so the sheet and the contract cannot drift.
// Rows are ui/Row with the controls laid over them (SlotRow), so hover and selection paint the whole row.
// Colours are skin tokens (CSS variables on web), so a skin switch repaints with no re-render.

import { createElement, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";
import { Avatar } from "../Avatar/index.tsx";
import { SlotRow } from "../FolderTree/index.tsx";
import { MenuIcon, useMenu } from "../Menu/index.tsx";
import type { MenuEntry } from "../Menu/index.tsx";
import { SHARE_LEVELS } from "./props.ts";
import type { ShareLevel, ShareRow, ShareSheetProps, ShareSubjectKind } from "./props.ts";

export type { Density, ShareLevel, ShareRow, ShareSheetProps, ShareSubjectKind, ShareVia } from "./props.ts";
export { SHARE_LEVELS, frozenShareSheetProps } from "./props.ts";

/* ---------- contract mapping ---------- */

export const SHARE_CAPABILITY = "access.share" as const;
export const UNSHARE_CAPABILITY = "access.unshare" as const;
/** The link row's subject id: the server makes the link and returns its own id. */
export const LINK_SUBJECT_ID = "public";

export interface ShareSubject {
  kind: ShareSubjectKind;
  id: string;
}

/** Input of access.share (manifests/access.ts). */
export interface ShareInput {
  resource: { type: string; id: string };
  subject: ShareSubject;
  level: ShareLevel;
}

/** Input of access.unshare, by resource and subject. */
export interface UnshareInput {
  resource: { type: string; id: string };
  subject: ShareSubject;
}

/** A link grant is view only, whatever level was asked for. */
export function effectiveLevel(kind: ShareSubjectKind, level: ShareLevel): ShareLevel {
  return kind === "link" ? "view" : level;
}

export function shareInput(props: Pick<ShareSheetProps, "resourceType" | "resourceId">, subject: ShareSubject, level: ShareLevel): ShareInput {
  return { resource: { type: props.resourceType, id: props.resourceId }, subject: { kind: subject.kind, id: subject.id }, level: effectiveLevel(subject.kind, level) };
}

export function unshareInput(props: Pick<ShareSheetProps, "resourceType" | "resourceId">, subject: ShareSubject): UnshareInput {
  return { resource: { type: props.resourceType, id: props.resourceId }, subject: { kind: subject.kind, id: subject.id } };
}

/* ---------- levels ---------- */

const ORDER: readonly ShareLevel[] = ["view", "use", "edit", "manage"];

export function levelLabel(level: ShareLevel): string {
  return SHARE_LEVELS.find((l) => l.id === level)?.label ?? level;
}

/** Levels a row may take: the type's levels; an inherited row can only be raised from where it is. A link is view only. */
export function levelsFor(row: Pick<ShareRow, "subjectKind" | "level" | "via">, offered: readonly ShareLevel[]): ShareLevel[] {
  if (row.subjectKind === "link") return offered.includes("view") ? ["view"] : [];
  const floor = row.via === "folder" || row.via === "space" ? ORDER.indexOf(row.level) : 0;
  return ORDER.filter((l) => offered.includes(l) && ORDER.indexOf(l) >= floor);
}

/** Inherited and owner rows have no remove button. */
export function removable(row: Pick<ShareRow, "via">): boolean {
  return row.via === "grant";
}

/** Rows in the order the sheet shows them: what this resource grants, most access first, then what comes from the folder. */
export function sheetRows(shares: readonly ShareRow[]): { direct: ShareRow[]; inherited: ShareRow[]; link: ShareRow | null } {
  const rank = (r: ShareRow): number => ORDER.indexOf(r.level);
  const byAccess = (a: ShareRow, b: ShareRow): number => rank(b) - rank(a) || a.name.localeCompare(b.name);
  const link = shares.find((r) => r.subjectKind === "link") ?? null;
  const people = shares.filter((r) => r.subjectKind !== "link");
  return {
    direct: people.filter((r) => r.via === "grant").sort(byAccess),
    inherited: people.filter((r) => r.via === "folder" || r.via === "space").sort(byAccess),
    link,
  };
}

export interface DirectoryEntry {
  id: string;
  name: string;
  sub?: string;
}

export interface ShareDirectory {
  people?: readonly DirectoryEntry[];
  groups?: readonly DirectoryEntry[];
  roles?: readonly DirectoryEntry[];
  agents?: readonly DirectoryEntry[];
}

const KIND_LABEL: Record<ShareSubjectKind, string> = { person: "Person", group: "Group", role: "Role", agent: "Agent", link: "Link" };

/** The Add menu: People, Groups, Roles, Agents; entries that already have access show a check and do nothing. */
export function addMenu(directory: ShareDirectory, shares: readonly ShareRow[], onAdd: (subject: ShareSubject, name: string) => void): MenuEntry[] {
  const have = new Set(shares.map((r) => `${r.subjectKind}:${r.subjectId}`));
  const out: MenuEntry[] = [];
  const groups: readonly { head: string; kind: ShareSubjectKind; list: readonly DirectoryEntry[] | undefined }[] = [
    { head: "People", kind: "person", list: directory.people },
    { head: "Groups", kind: "group", list: directory.groups },
    { head: "Roles", kind: "role", list: directory.roles },
    { head: "Agents", kind: "agent", list: directory.agents },
  ];
  for (const g of groups) {
    if (g.list === undefined || g.list.length === 0) continue;
    if (out.length > 0) out.push({ separator: true });
    out.push({ head: g.head });
    for (const e of g.list) {
      const added = have.has(`${g.kind}:${e.id}`);
      out.push({ label: e.name, checked: added, ...(added ? {} : { onSelect: () => onAdd({ kind: g.kind, id: e.id }, e.name) }) });
    }
  }
  return out;
}

/** The line under a row's name. */
export function rowSub(row: ShareRow, folderName?: string): string {
  if (row.via === "folder") return folderName ? `From the folder ${folderName}` : "From the folder";
  if (row.via === "space") return "Everyone in the Space";
  return KIND_LABEL[row.subjectKind];
}

/** The sheet's second line. */
export function sheetSubtitle(props: Pick<ShareSheetProps, "target">, folderName?: string): string {
  if (props.target === "folder") return "Folder. Sharing it covers everything inside.";
  return folderName ? `In the folder ${folderName}. Anything you add here is on top of the folder.` : "Not in a folder.";
}

/* ---------- component ---------- */

export interface ShareSheetViewProps extends ShareSheetProps {
  directory?: ShareDirectory;
  /** The folder an item sits in, when it sits in one. */
  folderName?: string;
  /** Who ends up seeing it: name, how, level. Shown as a quiet box when given. */
  sees?: readonly { name: string; via: string; level: string }[];
  onShare?: (input: ShareInput) => void;
  onUnshare?: (input: UnshareInput) => void;
  onCopyLink?: () => void;
  onClose?: () => void;
  testID?: string;
}

const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});
const CARD_SHADOW = { boxShadow: "var(--sh-pop)" } as unknown as ViewStyle;
const CHEVRON = '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';

function Tile({ name, kind, size = 22, seedId }: { name: string; kind: ShareSubjectKind; size?: number; seedId?: string | undefined }): ReactElement {
  if (kind === "link") return <LinkTile size={size} />;
  return <Avatar name={name} {...(seedId !== undefined ? { seedId } : {})} kind={kind === "group" || kind === "role" ? "group" : kind === "agent" ? "agent" : "person"} size={size} />;
}

/** The link row's tile: an arrow on the neutral tile. */
function LinkTile({ size }: { size: number }): ReactElement {
  return (
    <View style={{ width: size, height: size, borderRadius: "30%" as unknown as number, backgroundColor: "var(--sunk)" as string, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: "var(--ink-2)" as string, fontSize: size * 0.5, fontWeight: "600" }}>{"↗"}</Text>
    </View>
  );
}

function LevelPicker({ label, level, disabled, onPress }: { label: string; level: ShareLevel; disabled?: boolean; onPress: (x: number, y: number) => void }): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${levelLabel(level)}`}
      accessibilityState={{ disabled: disabled === true }}
      disabled={disabled === true}
      onPress={(e: { nativeEvent?: { pageX?: number; pageY?: number } }) => onPress(e.nativeEvent?.pageX ?? 0, e.nativeEvent?.pageY ?? 0)}
      style={({ hovered }: { hovered?: boolean }) => [styles.picker, hovered === true && disabled !== true && styles.pickerHover]}
    >
      <Text style={[styles.pickerText, disabled === true && styles.pickerTextOff]}>{levelLabel(level)}</Text>
      {disabled === true ? null : Platform.OS === "web" ? createElement("span", { style: { display: "inline-flex", color: "var(--ink-3)" }, dangerouslySetInnerHTML: { __html: CHEVRON } }) : <Text style={styles.pickerChev}>{"▾"}</Text>}
    </Pressable>
  );
}

export function ShareSheet(props: ShareSheetViewProps): ReactElement {
  const menu = useMenu();
  const [cleared, setCleared] = useState<string[]>([]);
  const compact = props.density === "compact";
  const offered = props.levels;
  const shares = props.shares.filter((r) => !cleared.includes(`${r.subjectKind}:${r.subjectId}`));
  const { direct, inherited, link } = sheetRows(shares);
  const firstLevel: ShareLevel = ORDER.find((l) => offered.includes(l)) ?? "view";
  const say = (kind: ShareSubjectKind, id: string, level: ShareLevel): void => props.onShare?.(shareInput(props, { kind, id }, level));

  const pickLevel = (row: ShareRow, x: number, y: number): void => {
    const items: MenuEntry[] = [];
    for (const l of levelsFor(row, offered)) items.push({ label: levelLabel(l), checked: l === row.level, onSelect: () => say(row.subjectKind, row.subjectId, l) });
    menu.show(items, x, y, "context", { label: `Access for ${row.name}` });
  };
  const remove = (row: ShareRow): void => {
    setCleared((c) => [...c, `${row.subjectKind}:${row.subjectId}`]);
    props.onUnshare?.(unshareInput(props, { kind: row.subjectKind, id: row.subjectId }));
  };
  const openAdd = (x: number, y: number): void => {
    const items = addMenu(props.directory ?? {}, props.shares, (subject) => say(subject.kind, subject.id, firstLevel));
    menu.show(items, x, y, "context", { label: "Add people" });
  };
  const rowMenu = (row: ShareRow, x: number, y: number): void => {
    const items: MenuEntry[] = [];
    if (levelsFor(row, offered).length > 1) for (const l of levelsFor(row, offered)) items.push({ label: `Can ${levelLabel(l).toLowerCase()}`, checked: l === row.level, onSelect: () => say(row.subjectKind, row.subjectId, l) });
    if (removable(row)) {
      if (items.length > 0) items.push({ separator: true });
      items.push({ label: "Remove", danger: true, onSelect: () => remove(row) });
    }
    if (items.length === 0) items.push({ label: "Copy Name", onSelect: () => void (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard?.writeText(row.name) });
    menu.show(items, x, y, "context", { label: `Access for ${row.name}` });
  };

  const rowNode = (row: ShareRow, inheritedRow: boolean): ReactElement => {
    const pick = levelsFor(row, offered).length > 1;
    const trail = (
      <View style={styles.trail}>
        <LevelPicker label={`Level for ${row.name}`} level={row.level} disabled={!pick} onPress={(x, y) => pickLevel(row, x, y)} />
        {removable(row) ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${row.name}`} onPress={() => remove(row)} testID={`share-remove-${row.subjectId}`} {...webProps({ title: "Remove" })} style={({ hovered }: { hovered?: boolean }) => [styles.x, hovered === true && styles.xHover]}>
            <MenuIcon icon="x" size={14} color="var(--ink-3)" />
          </Pressable>
        ) : <View style={styles.x} />}
      </View>
    );
    return (
      <SlotRow
        key={`${row.subjectKind}:${row.subjectId}:${inheritedRow ? "i" : "d"}`}
        id={`share-${row.subjectId}`}
        title={row.name}
        note={rowSub(row, props.folderName)}
        leadWidth={32}
        lead={<Tile name={row.name} seedId={row.subjectId} kind={row.subjectKind} />}
        trail={trail}
        onMenu={(x, y) => rowMenu(row, x, y)}
      />
    );
  };

  const directNodes: ReactElement[] = [];
  for (const row of direct) directNodes.push(rowNode(row, false));
  const inheritedNodes: ReactElement[] = [];
  for (const row of inherited) inheritedNodes.push(rowNode(row, true));
  const seesNodes: ReactElement[] = [];
  for (const [i, s] of (props.sees ?? []).entries()) {
    seesNodes.push(
      <View key={`${s.name}:${i}`} style={styles.see}>
        <Text style={styles.seeName}>{s.name}</Text>
        <Text style={styles.seeVia}>{s.via}</Text>
        <Text style={styles.seeLevel}>{s.level}</Text>
      </View>,
    );
  }
  const hintParts: string[] = [];
  for (const l of SHARE_LEVELS) if (offered.includes(l.id)) hintParts.push(`${l.label}: ${l.hint.toLowerCase()}`);

  return (
    <View
      accessibilityLabel={`Share ${props.resourceName}`}
      testID={props.testID ?? `share-sheet-${props.resourceId}`}
      style={[styles.card, compact && styles.cardCompact, CARD_SHADOW]}
      {...webProps({ role: "dialog", "aria-modal": true, onKeyDown: (e: { key: string; stopPropagation?: () => void }) => { if (e.key === "Escape") { e.stopPropagation?.(); props.onClose?.(); } } })}
    >
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text style={styles.title} numberOfLines={1}>{`Share “${props.resourceName}”`}</Text>
          <Text style={styles.sub}>{sheetSubtitle(props, props.folderName)}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={props.onClose} testID="share-close" {...webProps({ title: "Close" })} style={({ hovered }: { hovered?: boolean }) => [styles.x, hovered === true && styles.xHover]}>
          <MenuIcon icon="x" size={14} color="var(--ink-3)" />
        </Pressable>
      </View>
      <View style={styles.body}>
        <View style={styles.label}>
          <Text style={styles.labelText}>People with access</Text>
          <View style={styles.grow} />
          <Pressable accessibilityRole="button" accessibilityLabel="Add people, groups, roles or agents" onPress={(e: { nativeEvent?: { pageX?: number; pageY?: number } }) => openAdd(e.nativeEvent?.pageX ?? 0, e.nativeEvent?.pageY ?? 0)} testID="share-add" style={({ hovered }: { hovered?: boolean }) => [styles.add, hovered === true && styles.addHover]}>
            <MenuIcon icon="plus" size={13} color="var(--accent)" />
            <Text style={styles.addText}>Add</Text>
          </Pressable>
        </View>
        <SlotRow
          id="share-owner"
          title={props.ownerName}
          note="Person"
          leadWidth={32}
          lead={<Tile name={props.ownerName} seedId={props.ownerId} kind="person" />}
          trail={<Text style={styles.owner}>Owner</Text>}
        />
        {directNodes}
        {directNodes.length === 0 ? <Text style={styles.empty}>Nobody else yet.</Text> : null}
        {inheritedNodes.length > 0 ? <Text style={[styles.labelText, styles.gap]}>{props.folderName ? `From the folder ${props.folderName}` : "Inherited"}</Text> : null}
        {inheritedNodes}
        {props.allowExternal ? (
          <View>
            <Text style={[styles.labelText, styles.gap]}>Link</Text>
            <SlotRow
              id="share-link"
              title={link ? "Anyone with the link" : "No link"}
              note={link ? "Can view. Outside the Space." : "Make a view-only link for someone outside the Space"}
              leadWidth={32}
              lead={<Tile name="Link" kind="link" />}
              trail={
                <View style={styles.trail}>
                  {link && props.onCopyLink ? (
                    <Pressable accessibilityRole="button" accessibilityLabel="Copy link" onPress={props.onCopyLink} testID="share-copy-link" style={({ hovered }: { hovered?: boolean }) => [styles.picker, hovered === true && styles.pickerHover]}>
                      <Text style={styles.pickerText}>Copy link</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={link ? "Remove link" : "Create link"}
                    onPress={() => (link ? remove(link) : say("link", LINK_SUBJECT_ID, "view"))}
                    testID="share-link-toggle"
                    style={({ hovered }: { hovered?: boolean }) => [styles.picker, hovered === true && styles.pickerHover]}
                  >
                    <Text style={styles.pickerText}>{link ? "Remove" : "Create link"}</Text>
                  </Pressable>
                </View>
              }
            />
          </View>
        ) : null}
        {seesNodes.length > 0 ? (
          <View>
            <Text style={[styles.labelText, styles.gap]}>Who sees this</Text>
            <View style={styles.sees}>{seesNodes}</View>
          </View>
        ) : null}
        <Text style={styles.hint}>{`${hintParts.join(". ")}.${props.target === "item" ? " Access from a folder can be raised on one item, never lowered." : ""}`}</Text>
      </View>
      <View style={styles.foot}>
        <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={props.onClose} testID="share-done" style={({ hovered }: { hovered?: boolean }) => [styles.done, hovered === true && styles.doneHover]}>
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </View>
      {menu.element}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: "100%", maxWidth: 520, alignSelf: "center", borderRadius: 14, backgroundColor: "var(--raised)" as string, overflow: "hidden" },
  cardCompact: { maxWidth: "100%", borderRadius: 14 },
  head: { flexDirection: "row", alignItems: "flex-start", paddingTop: 16, paddingHorizontal: 18, paddingBottom: 6, gap: 8 },
  headText: { flex: 1, minWidth: 0, gap: 2 },
  title: { color: "var(--ink)" as string, fontSize: 15, lineHeight: 20, fontWeight: "600" },
  sub: { color: "var(--ink-3)" as string, fontSize: 12.5, lineHeight: 17 },
  body: { paddingTop: 8, paddingHorizontal: 12, paddingBottom: 14 },
  label: { flexDirection: "row", alignItems: "center", paddingHorizontal: 6, marginTop: 6, marginBottom: 4 },
  labelText: { color: "var(--ink-2)" as string, fontSize: 12.5, fontWeight: "600", paddingHorizontal: 6 },
  gap: { marginTop: 14, marginBottom: 4 },
  grow: { flex: 1 },
  add: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6 },
  addHover: { backgroundColor: "var(--accent-wash)" as string },
  addText: { color: "var(--accent)" as string, fontSize: 12.5, fontWeight: "500" },
  trail: { flexDirection: "row", alignItems: "center", gap: 2, paddingRight: 6 },
  owner: { color: "var(--ink-3)" as string, fontSize: 12.5, paddingRight: 12 },
  picker: { flexDirection: "row", alignItems: "center", gap: 4, height: 26, paddingLeft: 9, paddingRight: 6, borderRadius: 6 },
  pickerHover: { backgroundColor: "var(--hover)" as string },
  pickerText: { color: "var(--ink)" as string, fontSize: 13 },
  pickerTextOff: { color: "var(--ink-3)" as string, paddingRight: 3 },
  pickerChev: { color: "var(--ink-3)" as string, fontSize: 10 },
  x: { width: 24, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  xHover: { backgroundColor: "var(--hover)" as string },
  empty: { color: "var(--ink-3)" as string, fontSize: 13, paddingVertical: 8, paddingHorizontal: 8 },
  sees: { borderRadius: 10, paddingVertical: 4, paddingHorizontal: 10, borderWidth: 1, borderColor: "var(--line)" as string },
  see: { flexDirection: "row", alignItems: "center", minHeight: 30, gap: 9 },
  seeName: { flex: 1, color: "var(--ink)" as string, fontSize: 13 },
  seeVia: { color: "var(--ink-3)" as string, fontSize: 12 },
  seeLevel: { width: 52, textAlign: "right", color: "var(--ink)" as string, fontSize: 12.5, fontWeight: "500" },
  hint: { marginTop: 12, paddingHorizontal: 6, color: "var(--ink-3)" as string, fontSize: 12, lineHeight: 17 },
  foot: { flexDirection: "row", justifyContent: "flex-end", paddingVertical: 12, paddingHorizontal: 18, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  done: { height: 30, paddingHorizontal: 16, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--ink)" as string },
  doneHover: { opacity: 0.9 },
  doneText: { color: "var(--win)" as string, fontSize: 13, fontWeight: "500" },
});
