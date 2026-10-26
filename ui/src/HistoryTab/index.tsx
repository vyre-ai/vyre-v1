// ui/HistoryTab: the one History for files, records, Automations, memory, Kits and agent definitions (spec 4.5, 2.16; ARCH 7.5).
// A list of versions with who and why. A version can be compared (opens a diff tab), restored (a new version is added) and, when an agent run wrote it,
// undone with the rest of that run. Undo reverts only writes still at the run's version and reports the rest; sent messages and deployments are never undone.
// Lists use the shared Row with its leading and trailing slots; menus use the shared Menu. Colours are skin tokens (CSS variables on web).
// Keys: arrows move through versions, Enter compares with the previous one, R restores, Escape cancels a confirm.

import { useCallback, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../Avatar/index.tsx";
import { MenuIcon, menuTrigger, useMenu } from "../Menu/index.tsx";
import type { MenuEntry } from "../Menu/index.tsx";
import { Row } from "../Row/index.tsx";
import { HISTORY_ACTIONS } from "./props.ts";
import type { Density, HistoryResourceType, HistoryTabProps, HistoryVersion } from "./props.ts";

export type { Density, HistoryResourceType, HistoryTabProps, HistoryVersion } from "./props.ts";
export { HISTORY_ACTIONS, HISTORY_RESOURCE_TYPES, frozenHistoryTabProps } from "./props.ts";

/* ---------- capabilities (manifests: files, records, automations, memory, kits, agents, runs) ---------- */

export interface HistoryCapabilities {
  /** `<module>.versions`: the list this tab shows. */
  list: string;
  /** `<module>.restore_version`: restoring adds a new version, it never rewrites history. */
  restore: string;
  /** The input key that names the resource. */
  idKey: string;
}

const CAPABILITIES: Readonly<Record<HistoryResourceType, HistoryCapabilities>> = {
  file: { list: "files.versions", restore: "files.restore_version", idKey: "fileId" },
  record: { list: "records.versions", restore: "records.restore_version", idKey: "recordId" },
  automation: { list: "automations.versions", restore: "automations.restore_version", idKey: "automationId" },
  memory: { list: "memory.versions", restore: "memory.restore_version", idKey: "noteId" },
  kit: { list: "kits.versions", restore: "kits.restore_version", idKey: "kitId" },
  agent: { list: "agents.versions", restore: "agents.restore_version", idKey: "agentId" },
};

/** The capability names for a resource type. */
export function capabilitiesFor(type: HistoryResourceType): HistoryCapabilities {
  return CAPABILITIES[type];
}

export const UNDO_RUN_CAPABILITY = "runs.undo" as const;
export const PREVIEW_UNDO_CAPABILITY = "runs.preview_undo" as const;

export type HistoryInvoke = (capability: string, input: Record<string, unknown>) => Promise<unknown> | unknown;

/** The input of `<type>.restore_version`. A record needs its record type too. */
export function restoreInput(type: HistoryResourceType, resourceId: string, versionId: string, recordType?: string): Record<string, unknown> {
  const key = CAPABILITIES[type].idKey;
  return type === "record" && recordType !== undefined
    ? { type: recordType, [key]: resourceId, versionId }
    : { [key]: resourceId, versionId };
}

export function undoRunInput(runId: string, reason?: string): Record<string, unknown> {
  return reason === undefined || reason === "" ? { runId } : { runId, reason };
}

/* ---------- pure logic ---------- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Oct 24" in UTC, so the same version reads the same on every device and in every test. */
export function shortDate(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return `${MONTHS[at.getUTCMonth()] ?? ""} ${at.getUTCDate()}`;
}

/** "Oct 20 at 11:00 am" in UTC, the stamp the Viewing banner gives. */
export function longStamp(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const hour = at.getUTCHours();
  const minute = String(at.getUTCMinutes()).padStart(2, "0");
  return `${MONTHS[at.getUTCMonth()] ?? ""} ${at.getUTCDate()} at ${hour % 12 === 0 ? 12 : hour % 12}:${minute} ${hour < 12 ? "am" : "pm"}`;
}

/** The banner above a page that shows an older version: "Viewing v4 from Oct 20 at 11:00 am by Lena Ortiz. Showing what changed since." */
export function bannerLine(version: HistoryVersion, showingChanges: boolean): string {
  const head = `Viewing v${version.n} from ${longStamp(version.at)} by ${version.who}.`;
  return showingChanges ? `${head} Showing what changed since.` : head;
}

/** Newest first. The frozen props already arrive newest first; this keeps the order whatever the caller sends. */
export function newestFirst(versions: readonly HistoryVersion[]): HistoryVersion[] {
  return versions.slice().sort((a, b) => b.n - a.n);
}

/** The current version is the newest one. */
export function currentVersion(versions: readonly HistoryVersion[]): HistoryVersion | null {
  return newestFirst(versions)[0] ?? null;
}

/** The version before this one, for Compare with previous. Null for the first. */
export function previousOf(versions: readonly HistoryVersion[], id: string): HistoryVersion | null {
  const list = newestFirst(versions);
  const at = list.findIndex((v) => v.id === id);
  return at < 0 ? null : list[at + 1] ?? null;
}

/** Every version one agent run wrote, newest first. */
export function runGroup(versions: readonly HistoryVersion[], runId: string): HistoryVersion[] {
  return newestFirst(versions).filter((v) => v.runId === runId);
}

export interface UndoPlan {
  runId: string;
  /** Writes that will be reverted: still the run's own and undoable. */
  undo: HistoryVersion[];
  /** Writes that stay: changed since, sent, or deployed. */
  keep: HistoryVersion[];
}

/** What Undo this run does: reverts the undoable writes of the run and reports the rest. */
export function undoPlan(versions: readonly HistoryVersion[], runId: string): UndoPlan {
  const group = runGroup(versions, runId);
  return { runId, undo: group.filter((v) => v.undoable), keep: group.filter((v) => !v.undoable) };
}

export function undoLabel(plan: UndoPlan): string {
  if (plan.undo.length === 0) return "Undo this run";
  return plan.undo.length === 1 ? "Undo this run (1 change)" : `Undo this run (${plan.undo.length} changes)`;
}

export interface HistoryCall {
  type: HistoryResourceType;
  resourceId: string;
  recordType?: string;
  invoke?: HistoryInvoke | undefined;
}

/** Restores a version: calls `<module>.restore_version`. Returns the line the tab shows afterwards. */
export async function performRestore(call: HistoryCall, version: HistoryVersion): Promise<string> {
  if (call.invoke) await call.invoke(capabilitiesFor(call.type).restore, restoreInput(call.type, call.resourceId, version.id, call.recordType));
  return `Restored v${version.n} as a new version.`;
}

/** Undoes the run of a version: calls `runs.undo` once and returns the line the tab shows afterwards. */
export async function performUndo(call: HistoryCall, versions: readonly HistoryVersion[], version: HistoryVersion): Promise<string> {
  if (version.runId === null) return "";
  const plan = undoPlan(versions, version.runId);
  if (call.invoke) await call.invoke(UNDO_RUN_CAPABILITY, undoRunInput(version.runId));
  return plan.keep.length > 0 ? `Undid ${plan.undo.length}, ${plan.keep.length} could not be undone.` : `Undid ${plan.undo.length}.`;
}

export const UNDO_NOTE = "Only writes still at the run's version are undone. Sent messages and deployments cannot be undone.";

export const RETENTION_NOTE = "Older versions thin out: all of them for 30 days, then the last one each day for 90 days, then one a week. Named and signed versions stay for ever.";

/** What a restore or an undo asks before it runs. The impact is stated, the answer is yes or no. */
export function confirmText(kind: "restore" | "undo", version: HistoryVersion, plan?: UndoPlan): string {
  if (kind === "restore") return `Restore v${version.n}? It is saved as a new version; nothing is lost.`;
  const undone = plan?.undo.length ?? 0;
  const kept = plan?.keep.length ?? 0;
  return `Undo what this run changed? ${undone} ${undone === 1 ? "change is" : "changes are"} reverted${kept > 0 ? `, ${kept} stay` : ""}.`;
}

export type HistoryKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

/** Next selected version for an arrow key. Does not wrap, so a held key stops at the ends. */
export function moveSelection(versions: readonly HistoryVersion[], from: string | null, key: HistoryKey): string | null {
  const list = newestFirst(versions);
  if (list.length === 0) return null;
  if (key === "Home") return list[0]?.id ?? null;
  if (key === "End") return list[list.length - 1]?.id ?? null;
  const at = list.findIndex((v) => v.id === from);
  if (at < 0) return list[0]?.id ?? null;
  const next = key === "ArrowDown" ? Math.min(list.length - 1, at + 1) : Math.max(0, at - 1);
  return list[next]?.id ?? null;
}

export interface VersionActions {
  compare: boolean;
  restore: boolean;
  undo: boolean;
}

/** Compare needs an earlier version; restore is for any version but the current one; undo needs a run id. */
export function actionsFor(versions: readonly HistoryVersion[], version: HistoryVersion): VersionActions {
  const current = currentVersion(versions);
  return {
    compare: previousOf(versions, version.id) !== null,
    restore: current !== null && current.id !== version.id,
    undo: version.runId !== null && undoPlan(versions, version.runId).undo.length > 0,
  };
}

/** The quiet line under a version: who, and why when there is a reason. */
export function noteLine(version: HistoryVersion): string {
  return version.why.trim() === "" ? version.who : `${version.who} · ${version.why}`;
}

/** Props React Native Web forwards to the DOM but React Native's types do not list. */
function webProps(props: Record<string, unknown>): Record<string, unknown> {
  return Platform.OS === "web" ? props : {};
}

/* ---------- icons ---------- */

const SVG = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">';
const ICON_COMPARE = `${SVG}<path d="M5 3v10M11 3v10M2.500 6H5M2.500 10H5M11 6h2.500M11 10h2.500"/></svg>`;
const ICON_RESTORE = `${SVG}<path d="M3 8a5 5 0 105-5M3 3.500V8h4.500"/></svg>`;
const ICON_UNDO = `${SVG}<path d="M5.500 3L2.500 6l3 3M2.500 6H10a3.500 3.500 0 010 7H6.500"/></svg>`;

/* ---------- the view ---------- */

export interface HistoryTabViewProps extends HistoryTabProps {
  /** The record type, for a record's restore input. */
  recordType?: string;
  /** Called by Compare. `against` is the version it is compared with; the caller opens a diff tab. */
  onCompare?: (version: HistoryVersion, against: HistoryVersion) => void;
  /** Calls `<type>.restore_version` unless `invoke` is given. */
  onRestore?: (version: HistoryVersion) => void;
  onUndoRun?: (runId: string, plan: UndoPlan) => void;
  onSelect?: (versionId: string) => void;
  onDownload?: (version: HistoryVersion) => void;
  /** When given, Restore and Undo this run call the capabilities themselves. */
  invoke?: HistoryInvoke;
  testID?: string;
}

interface Pending {
  kind: "restore" | "undo";
  versionId: string;
}

const ROW_ICON = 24;

export function HistoryTab(props: HistoryTabViewProps): ReactElement {
  const { resourceType, resourceId, versions, density, invoke, onCompare, onRestore, onUndoRun, onSelect, onDownload, recordType } = props;
  const list = useMemo(() => newestFirst(versions), [versions]);
  const current = list[0] ?? null;
  const [picked, setPicked] = useState<string | null>(props.selectedVersionId);
  const [hover, setHover] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [done, setDone] = useState<string>("");
  const { element: menuElement, show } = useMenu();
  const selectedId = picked ?? props.selectedVersionId;
  const selected = list.find((v) => v.id === selectedId) ?? null;

  const select = useCallback((id: string) => {
    setPicked(id);
    setPending(null);
    setDone("");
    if (onSelect) onSelect(id);
  }, [onSelect]);

  const compare = useCallback((version: HistoryVersion) => {
    const against = previousOf(versions, version.id);
    if (against !== null && onCompare) onCompare(version, against);
  }, [versions, onCompare]);

  const compareCurrent = useCallback((version: HistoryVersion) => {
    const head = currentVersion(versions);
    if (head !== null && head.id !== version.id && onCompare) onCompare(version, head);
  }, [versions, onCompare]);

  const askRestore = useCallback((version: HistoryVersion) => {
    if (actionsFor(versions, version).restore) setPending({ kind: "restore", versionId: version.id });
  }, [versions]);

  const askUndo = useCallback((version: HistoryVersion) => {
    if (actionsFor(versions, version).undo) setPending({ kind: "undo", versionId: version.id });
  }, [versions]);

  const confirm = useCallback(() => {
    if (pending === null) return;
    const version = list.find((v) => v.id === pending.versionId);
    setPending(null);
    if (version === undefined) return;
    const call: HistoryCall = { type: resourceType, resourceId, invoke, ...(recordType === undefined ? {} : { recordType }) };
    if (pending.kind === "restore") {
      if (onRestore) onRestore(version);
      void performRestore(call, version).then(setDone);
      return;
    }
    if (version.runId === null) return;
    if (onUndoRun) onUndoRun(version.runId, undoPlan(versions, version.runId));
    void performUndo(call, versions, version).then(setDone);
  }, [pending, list, invoke, resourceType, resourceId, recordType, onRestore, onUndoRun, versions]);

  const menuFor = useCallback((version: HistoryVersion): MenuEntry[] => {
    const can = actionsFor(versions, version);
    const out: MenuEntry[] = [];
    if (can.compare) out.push({ label: "Compare with previous", icon: ICON_COMPARE, onSelect: () => compare(version) });
    if (can.restore) out.push({ label: "Compare with current", icon: ICON_COMPARE, onSelect: () => compareCurrent(version) });
    if (can.restore) out.push({ label: "Restore this version", icon: ICON_RESTORE, onSelect: () => askRestore(version) });
    if (version.runId !== null) out.push({ label: "Undo this run", icon: ICON_UNDO, onSelect: () => askUndo(version) });
    if (onDownload) out.push({ label: "Download this version", icon: "open", onSelect: () => onDownload(version) });
    return out;
  }, [versions, compare, compareCurrent, askRestore, askUndo, onDownload]);

  const onKeyDown = (event: { key: string; preventDefault?: () => void; metaKey?: boolean; ctrlKey?: boolean }): void => {
    const { key } = event;
    if (key === "Escape") {
      if (pending !== null) {
        event.preventDefault?.();
        setPending(null);
      }
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
      event.preventDefault?.();
      const next = moveSelection(versions, selectedId, key);
      if (next !== null) select(next);
      return;
    }
    if (selected === null || event.metaKey === true || event.ctrlKey === true) return;
    if (key === "Enter") {
      event.preventDefault?.();
      compare(selected);
    } else if (key === "r" || key === "R") {
      event.preventDefault?.();
      askRestore(selected);
    }
  };

  const rows: ReactNode[] = [];
  for (const version of list) {
    const isCurrent = current !== null && current.id === version.id;
    const can = actionsFor(versions, version);
    const over = hover === version.id;
    rows.push(
      <View
        key={version.id}
        style={styles.rowBox}
        {...menuTrigger((x, y) => show(menuFor(version), x, y, "context", { label: `v${version.n}` }))}
        {...webProps({ onMouseEnter: () => setHover(version.id), onMouseLeave: () => setHover((h) => (h === version.id ? null : h)) })}
      >
        <Row
          id={`history-${version.id}`}
          title={`v${version.n}`}
          note={noteLine(version)}
          selected={version.id === selectedId}
          leading={(
            <View style={styles.lead}>
              <View testID={`history-dot-${version.id}`} style={[styles.dot, isCurrent ? styles.dotCurrent : styles.dotOld]} />
              <Avatar name={version.who} kind="person" size={18} testID={`history-avatar-${version.id}`} />
            </View>
          )}
          trailing={over && (can.compare || can.restore)
            ? (
              <View style={styles.acts}>
                {can.compare ? <IconButton label="Compare with previous" icon={ICON_COMPARE} testID={`history-compare-${version.id}`} onPress={() => compare(version)} /> : null}
                {can.restore ? <IconButton label="Restore this version" icon={ICON_RESTORE} testID={`history-restore-${version.id}`} onPress={() => askRestore(version)} /> : null}
              </View>
            )
            : (
              <View style={styles.meta}>
                {isCurrent ? <Text style={styles.cur}>Current</Text> : null}
                <Text style={styles.time}>{shortDate(version.at)}</Text>
              </View>
            )}
          onPress={() => select(version.id)}
        />
      </View>,
    );
  }

  const plan = selected !== null && selected.runId !== null ? undoPlan(versions, selected.runId) : null;
  const actionButtons: ReactNode[] = [];
  if (selected !== null) {
    const allowed = actionsFor(versions, selected);
    for (const action of HISTORY_ACTIONS) {
      if (action === "compare") actionButtons.push(<TextButton key={action} label="Compare" testID="history-compare" disabled={!allowed.compare} density={density} onPress={() => compare(selected)} />);
      else actionButtons.push(<TextButton key={action} label="Restore this version" testID="history-restore" disabled={!allowed.restore} density={density} onPress={() => askRestore(selected)} />);
    }
  }
  const can = selected === null ? null : actionsFor(versions, selected);
  const pendingVersion = pending === null ? null : list.find((v) => v.id === pending.versionId) ?? null;

  return (
    <View
      style={styles.root}
      testID={props.testID ?? "history-tab"}
      role="region"
      aria-label="Version history"
      {...webProps({ onKeyDown, dataSet: { resource: resourceType, density } })}
    >
      {list.length === 0 ? (
        <Text style={styles.empty} testID="history-empty">No earlier versions</Text>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listBody} role="listbox" aria-label="Versions">
          {rows}
        </ScrollView>
      )}

      {selected !== null && can !== null ? (
        <View style={styles.bar} testID="history-actions">
          {actionButtons}
          {plan !== null ? (
            <TextButton label={undoLabel(plan)} testID="history-undo" disabled={!can.undo} density={density} onPress={() => askUndo(selected)} />
          ) : null}
        </View>
      ) : null}

      {plan !== null && selected !== null && !(can?.undo ?? false) ? (
        <Text style={styles.note} testID="history-undo-note">{UNDO_NOTE}</Text>
      ) : null}

      {pending !== null && pendingVersion !== null ? (
        <View style={styles.confirm} testID="history-confirm" role="alertdialog" aria-label={confirmText(pending.kind, pendingVersion, plan ?? undefined)}>
          <Text style={styles.confirmText}>{confirmText(pending.kind, pendingVersion, plan ?? undefined)}</Text>
          <View style={styles.confirmBtns}>
            <TextButton label="Cancel" testID="history-cancel" density={density} onPress={() => setPending(null)} />
            <TextButton label={pending.kind === "restore" ? "Restore" : "Undo"} testID="history-confirm-go" primary density={density} onPress={confirm} />
          </View>
        </View>
      ) : null}

      {done !== "" ? <Text style={styles.done} testID="history-done" role="status">{done}</Text> : null}
      <Text style={styles.retention} testID="history-retention">{RETENTION_NOTE}</Text>
      {menuElement}
    </View>
  );
}

export interface VersionBannerProps {
  version: HistoryVersion;
  /** The page shows what changed since this version. Null when the page has no text to compare. */
  showingChanges: boolean | null;
  /** The current version has no Restore. */
  canRestore: boolean;
  onToggleChanges?: () => void;
  onRestore?: (version: HistoryVersion) => void;
  onBack?: () => void;
  testID?: string;
}

/** Viewing vN: a bar over the page with Hide changes (or Show changes), Restore this version and Back to current. */
export function VersionBanner(props: VersionBannerProps): ReactElement {
  const { version, showingChanges, canRestore } = props;
  return (
    <View style={styles.banner} testID={props.testID ?? "version-banner"} role="status" aria-label={bannerLine(version, showingChanges === true)}>
      <MenuIcon icon={ICON_RESTORE} color="var(--accent)" size={15} />
      <Text style={styles.bannerText} numberOfLines={2} testID="version-banner-line">{bannerLine(version, showingChanges === true)}</Text>
      {showingChanges === null ? null : <BannerButton label={showingChanges ? "Hide changes" : "Show changes"} testID="version-changes" onPress={() => props.onToggleChanges?.()} />}
      {canRestore ? <BannerButton label="Restore this version" testID="version-restore" onPress={() => props.onRestore?.(version)} /> : null}
      <BannerButton label="Back to current" testID="version-back" onPress={() => props.onBack?.()} />
    </View>
  );
}

function BannerButton({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable role="button" aria-label={label} testID={testID} onPress={onPress} onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)} style={[styles.bannerBtn, over && styles.bannerBtnOver]}>
      <Text style={styles.bannerBtnText}>{label}</Text>
    </Pressable>
  );
}

function IconButton({ label, icon, onPress, testID }: { label: string; icon: string; onPress: () => void; testID: string }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      role="button"
      aria-label={label}
      testID={testID}
      onPress={onPress}
      onHoverIn={() => setOver(true)}
      onHoverOut={() => setOver(false)}
      style={[styles.iconBtn, over && styles.iconBtnOver]}
      {...webProps({ title: label })}
    >
      <MenuIcon icon={icon} color={over ? "var(--ink)" : "var(--ink-3)"} size={15} />
    </Pressable>
  );
}

function TextButton({ label, onPress, testID, disabled = false, primary = false, density }: { label: string; onPress: () => void; testID: string; disabled?: boolean; primary?: boolean; density: Density }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      role="button"
      aria-label={label}
      aria-disabled={disabled}
      disabled={disabled}
      testID={testID}
      onPress={onPress}
      onHoverIn={() => setOver(true)}
      onHoverOut={() => setOver(false)}
      style={[styles.btn, density === "compact" && styles.btnTouch, primary ? styles.btnPrimary : over && !disabled ? styles.btnOver : null, disabled && styles.btnOff]}
    >
      <Text style={[styles.btnText, primary && styles.btnTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  list: { flexGrow: 0, flexShrink: 1 },
  listBody: { padding: 8, gap: 2 },
  rowBox: { width: "100%" },
  lead: { flexDirection: "row", alignItems: "center", gap: 8, marginRight: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotCurrent: { backgroundColor: "var(--ok)" as string },
  dotOld: { borderWidth: 1.5, borderColor: "var(--ink-4)" as string },
  meta: { flexDirection: "row", alignItems: "center", gap: 7 },
  cur: { color: "var(--ok)" as string, fontSize: 11.5, fontWeight: "500" },
  time: { color: "var(--ink-3)" as string, fontSize: 11.5 },
  acts: { flexDirection: "row", gap: 1 },
  iconBtn: { width: ROW_ICON, height: ROW_ICON, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  iconBtnOver: { backgroundColor: "var(--press)" as string },
  bar: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 14, paddingTop: 10 },
  btn: { height: 28, paddingHorizontal: 11, borderRadius: 7, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "var(--line-2)" as string },
  btnTouch: { height: 36 },
  btnOver: { backgroundColor: "var(--hover)" as string },
  btnPrimary: { backgroundColor: "var(--accent)" as string, borderColor: "transparent" },
  btnOff: { opacity: 0.45 },
  btnText: { color: "var(--ink)" as string, fontSize: 12.5, fontWeight: "500" },
  btnTextPrimary: { color: "var(--accent-ink)" as string },
  note: { color: "var(--ink-3)" as string, fontSize: 12, lineHeight: 17, marginHorizontal: 14, marginTop: 8 },
  confirm: { marginHorizontal: 14, marginTop: 10, padding: 10, borderRadius: 8, backgroundColor: "var(--sunk)" as string, gap: 8 },
  confirmText: { color: "var(--ink)" as string, fontSize: 12.5, lineHeight: 18 },
  confirmBtns: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  done: { color: "var(--ok)" as string, fontSize: 12, marginHorizontal: 14, marginTop: 8 },
  retention: { color: "var(--ink-3)" as string, fontSize: 12, lineHeight: 17, marginHorizontal: 14, marginTop: 10, marginBottom: 16 },
  banner: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: "var(--accent-wash)" as string },
  bannerText: { flex: 1, minWidth: 180, color: "var(--ink)" as string, fontSize: 12.5, lineHeight: 18, marginLeft: 4 },
  bannerBtn: { height: 26, paddingHorizontal: 9, borderRadius: 6, justifyContent: "center" },
  bannerBtnOver: { backgroundColor: "var(--hover)" as string },
  bannerBtnText: { color: "var(--accent)" as string, fontSize: 12.5, fontWeight: "500" },
  empty: { color: "var(--ink-3)" as string, fontSize: 12.5, padding: 16 },
});
