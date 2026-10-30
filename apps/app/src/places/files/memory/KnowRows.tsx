// The rows the Knowledge screens share (Learned, the lists, History, Trash, Archive, Search): one row shell with its dot, body, right-hand actions (shown on hover, focus or a narrow window) and its
// right-click menu; a fact row (subject, text, source chip, who and when); a Trash row (struck text, why it is here, days left, Restore); a day header; the filter banner; and the small helpers every
// screen needs (a live read that survives a refusal, an action that ends in a Flash or an error line, copy, open the source, who removed a fact). No screen draws its own row.
import { useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { LiveQuery, QueryState } from "../../../../../../client/src/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import { errorText } from "./actions.ts";
import { useMemoryData } from "./data.tsx";
import type { LiveCap, MemoryData, MemoryNav } from "./data.tsx";
import type { FlashState } from "./KnowFrame.tsx";
import { SourceChip } from "./KnowParts.tsx";
import type { KFact, TrailRow } from "./know.ts";
import { Icon } from "./parts.tsx";

export const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- reads and writes

/** A live read that never throws: a capability that refuses (a member reading Archive) comes back as a `loading` state that carries the error, as the real client does. `skip` makes no call at all. */
export function useLiveSafe<C extends LiveCap>(cap: C, input: CapMap[C]["in"], skip = false): QueryState<CapMap[C]["out"]> {
  const { live } = useMemoryData();
  const key = JSON.stringify(input);
  const q = useMemo((): LiveQuery<CapMap[C]["out"]> => {
    if (skip) { const idle: QueryState<CapMap[C]["out"]> = { status: "loading" }; return { subscribe: () => () => undefined, getSnapshot: () => idle }; }
    const inner = live(cap, JSON.parse(key) as CapMap[C]["in"]);
    // The fake replica throws on the first read of a refused call and answers `loading` on the next, so a refusal is remembered until a read is ready again.
    let failed: QueryState<CapMap[C]["out"]> | null = null;
    return {
      subscribe: inner.subscribe,
      getSnapshot() {
        try {
          const snap = inner.getSnapshot();
          if (snap.status === "ready") { failed = null; return snap; }
          return failed !== null && snap.error === undefined ? failed : snap;
        } catch (e) {
          const message = e instanceof Error ? e.message : "The read failed";
          if (failed === null || failed.status !== "loading" || failed.error?.message !== message) failed = { status: "loading", error: { message } };
          return failed;
        }
      },
    };
  }, [live, cap, key, skip]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}

/** True when a read was refused for the person's role (a member asking for Archive). */
export function isDenied(s: QueryState<unknown>): boolean {
  return s.status === "loading" && s.error !== undefined && /role_lacks_permission|permission/.test(`${s.error.code ?? ""} ${s.error.message}`);
}

/** The line a read that failed shows, or null when it did not fail. */
export function readError(s: QueryState<unknown>, what: string): string | null {
  return s.status === "loading" && s.error ? errorText(new Error(s.error.message), what) : null;
}

/** What a screen keeps for its writes: the Flash line, the error line, and `run`, which does one call and ends in one or the other. */
export function useDoing(): { flash: FlashState | null; setFlash: (f: FlashState | null) => void; err: string | null; run: <T>(what: string, p: () => Promise<T>, ok: (v: T) => FlashState | null) => void } {
  const [flash, setFlash] = useState<FlashState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = <T,>(what: string, p: () => Promise<T>, ok: (v: T) => FlashState | null): void => {
    setErr(null);
    p().then((v) => setFlash(ok(v))).catch((e: unknown) => { setFlash(null); setErr(errorText(e, what)); });
  };
  return { flash, setFlash, err, run };
}

export function ErrorLine({ text }: { text: string | null }): ReactElement | null {
  return text ? <Text accessibilityRole="alert" testID="know-error" style={r.error}>{text}</Text> : null;
}

export function copyText(text: string): void {
  try { void (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard?.writeText(text); } catch { /* a browser without a clipboard: nothing to copy to */ }
}

/** The source of a fact: the chat at its line when it has a link, otherwise the chat, task or record it points at. */
export function openSourceOf(nav: MemoryNav, f: KFact): void {
  if (f.sourceLink) nav.openChat(f.sourceLink); else nav.openSource(f.sourceRef);
}

/** The agent or person a line credits: "you" for the signed-in person, the name otherwise, "Upkeep" for upkeep. */
export function whoOf(data: MemoryData): (id: string) => string {
  return (id) => (data.me && id === data.me.id ? "you" : id === "upkeep" ? "Upkeep" : data.nameOf(id));
}
export const capital = (s: string): string => (s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s);

// ---------------------------------------------------------------- words

/** "today", "yesterday", "8 days ago": how long since a day count. */
export const agoDays = (n: number): string => (n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`);
export const daysSince = (at: number, now: number): number => Math.max(0, Math.floor((now - at) / DAY_MS));

/** Who took a fact to Trash: the newest trail row that removed it (by fact id, or by the fact's words in the row's text). Null when the trail does not say. */
export function removedBy(trail: readonly TrailRow[], f: KFact): { actor: string; actorKind: TrailRow["actorKind"] } | null {
  const gone = (a: TrailRow["action"]): boolean => a === "delete" || a === "undo" || a === "merge" || a === "archive" || a === "reject" || a === "resolve";
  const sorted = [...trail].sort((a, b) => b.at - a.at);
  const hit = sorted.find((t) => gone(t.action) && t.factId === f.factId) ?? sorted.find((t) => t.action === "delete" && typeof t.detail?.text === "string" && (t.detail.text as string).includes(f.text));
  return hit ? { actor: hit.actor, actorKind: hit.actorKind } : null;
}

// ---------------------------------------------------------------- row shell

interface KeyLike { key?: string; target?: unknown; currentTarget?: unknown; preventDefault?: () => void; metaKey?: boolean; ctrlKey?: boolean }
const inField = (e: KeyLike): boolean => { const t = (e.target as { tagName?: string } | undefined)?.tagName; return t === "INPUT" || t === "TEXTAREA"; };

/** The shell of every row: a dot, a body, actions at the right. Actions are hidden until the pointer is over the row or focus is in it, and always shown in a narrow window. Right-click, the menu key and a long press open `menu`. */
export function KRow({ testID, label, main, meta, actions, menu, onOpen, keys, hollow = false, flashing = false, dot = true, always = false }: {
  testID: string; label: string; main: ReactNode; meta?: ReactNode; actions?: ReactNode; menu: () => MenuEntry[]; onOpen?: () => void;
  /** Letter keys the row answers while it has focus (not while a field has it). */
  keys?: Record<string, () => void>; hollow?: boolean; flashing?: boolean; dot?: boolean;
  /** Draw the actions at all times (Restore in Trash), not only on hover or focus. */
  always?: boolean;
}): ReactElement {
  const m = useMenu();
  const [over, setOver] = useState(false);
  const [focused, setFocused] = useState(false);
  const w = useWindowDimensions().width;
  const shown = always || over || focused || (w > 0 && w < 720);
  const { onKeyDown: menuKey, ...menuProps } = menuTrigger((x, y) => m.show(menu(), x, y)) as { onKeyDown?: (e: KeyLike) => void };
  const onKeyDown = (e: KeyLike): void => {
    menuKey?.(e);
    if (inField(e) || e.target !== e.currentTarget || e.metaKey === true || e.ctrlKey === true) return;
    if (e.key === "Enter" && onOpen) { e.preventDefault?.(); onOpen(); return; }
    const k = e.key ? keys?.[e.key.toLowerCase()] : undefined;
    if (k) { e.preventDefault?.(); k(); }
  };
  const props = { ...menuProps, onKeyDown, onPointerEnter: () => setOver(true), onPointerLeave: () => setOver(false), onFocus: () => setFocused(true), onBlur: () => setFocused(false) };
  return (
    <View testID={testID} accessibilityLabel={label} focusable {...(props as object)} style={[r.row, (over || focused) && r.rowOver, flashing && r.rowFlash]}>
      {dot ? <View style={[r.dot, hollow && r.dotHollow]} /> : null}
      <View style={r.body}>{main}{meta}</View>
      {actions ? <View style={[r.acts, !shown && HIDDEN]}>{actions}</View> : null}
      {m.element}
    </View>
  );
}
const HIDDEN = { opacity: 0 };

/** The subject at the start of a line: bold, opens the page. `plain` draws it without a press. */
export function Subject({ name, onPress, testID, plain = false }: { name: string; onPress?: () => void; testID?: string; plain?: boolean }): ReactElement {
  const [over, setOver] = useState(false);
  if (plain || !onPress) return <Text style={r.subj} {...(testID ? { testID } : {})}>{name}{"  "}</Text>;
  return <Text accessibilityRole="link" accessibilityLabel={`Open ${name}`} {...(testID ? { testID } : {})} onPress={onPress} {...({ onPointerEnter: () => setOver(true), onPointerLeave: () => setOver(false) } as object)} style={[r.subj, over && r.subjOver]}>{name}{"  "}</Text>;
}

/** "Chip  you · today · Matched by meaning": the line under a fact. `parts` are plain words with a dot between each; a part may be a node. */
export function MetaLine({ chip, parts }: { chip?: KFact; parts: readonly (string | ReactElement)[] }): ReactElement {
  const out: ReactElement[] = [];
  if (chip) out.push(<SourceChip key="chip" fact={chip} />);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (i > 0) out.push(<Text key={`d${i}`} style={r.sep}>{"\u00b7"}</Text>);
    out.push(typeof p === "string" ? <Text key={`p${i}`} style={r.meta}>{p}</Text> : p);
  }
  return <View style={r.metaLine}>{out}</View>;
}

/** The inline editor of a fact: the text as an input with Cancel and Save. Enter saves, Escape cancels. */
export function EditField({ draft, onDraft, onCancel, onSave, id }: { draft: string; onDraft: (t: string) => void; onCancel: () => void; onSave: () => void; id: string }): ReactElement {
  return (
    <View style={r.edit}>
      <TextInput
        value={draft} onChangeText={onDraft} autoFocus accessibilityLabel="Edit this fact" testID={`editfield-${id}`} onSubmitEditing={onSave}
        onKeyPress={(e: { nativeEvent: { key: string } }) => { if (e.nativeEvent.key === "Escape") onCancel(); }} style={r.input}
      />
      <Pressable accessibilityRole="button" testID={`edit-cancel-${id}`} onPress={onCancel} style={({ hovered }: { hovered?: boolean }) => [r.btn, hovered === true && r.btnOver]}><Text style={r.btnText}>Cancel</Text></Pressable>
      <Pressable accessibilityRole="button" testID={`edit-save-${id}`} onPress={onSave} style={({ hovered }: { hovered?: boolean }) => [r.btn, r.btnPri, hovered === true && r.btnPriOver]}><Text style={r.btnPriText}>Save</Text></Pressable>
    </View>
  );
}

/** A fact as a row: subject, text (or its editor), source chip and the line after it. */
export function FactRow({ fact, testID, meta, actions, menu, onOpen, keys, editing, struck = false, plainSubject = false, flashing = false, always = false }: {
  fact: KFact; testID: string; meta: readonly (string | ReactElement)[]; actions?: ReactNode; menu: () => MenuEntry[]; onOpen?: () => void; keys?: Record<string, () => void>;
  editing?: { draft: string; onDraft: (t: string) => void; onCancel: () => void; onSave: () => void }; struck?: boolean; plainSubject?: boolean; flashing?: boolean; always?: boolean;
}): ReactElement {
  const { nav } = useMemoryData();
  const open = fact.subject ? () => nav.go({ v: "page", pageId: fact.subject!.pageId, hl: fact.factId }) : undefined;
  const name = fact.subject?.title;
  return (
    <KRow
      testID={testID} label={`${name ? `${name}: ` : ""}${fact.text}`} menu={menu} {...(onOpen ? { onOpen } : {})} {...(keys ? { keys } : {})} flashing={flashing} always={always} {...(actions && !editing ? { actions } : {})}
      main={(
        <>
          <Text style={r.kt}>
            {name ? <Subject name={name} testID={`${testID}-subject`} plain={plainSubject} {...(open ? { onPress: open } : {})} /> : null}
            {editing ? null : <Text style={struck ? r.gone : r.text}>{fact.text}</Text>}
          </Text>
          {editing ? <EditField id={fact.factId} {...editing} /> : null}
        </>
      )}
      meta={<MetaLine chip={fact} parts={meta} />}
    />
  );
}

/** A fact in Trash or Archive: the struck text, why it is here, who removed it and when, days left, and Restore (or the lock when this person cannot). */
export function TrashRow({ fact, who, by, now, keep, archive, canRestore, onRestore, menu, onOpen }: {
  fact: KFact; who: (id: string) => string; by: { actor: string } | null; now: number; keep: number; archive: boolean; canRestore: boolean; onRestore: () => void; menu: () => MenuEntry[]; onOpen: () => void;
}): ReactElement {
  const gone = daysSince(fact.trashedAt ?? now, now);
  const left = keep - gone;
  const parts: (string | ReactElement)[] = [`${archive ? "Archived" : "Removed"}${by ? ` by ${by.actor === "upkeep" ? "Upkeep" : who(by.actor)}` : ""} ${agoDays(gone)}`];
  if (fact.trashReason) parts.push(fact.trashReason);
  if (!archive) parts.push(<Text key="left" style={[r.meta, left <= 14 && r.warn]}>{`${Math.max(0, left)} day${left === 1 ? "" : "s"} left of ${keep}`}</Text>);
  const name = fact.subject?.title;
  return (
    <KRow
      testID={`trash-${fact.factId}`} always label={`${name ? `${name}: ` : ""}${fact.text}`} menu={menu} onOpen={canRestore ? onRestore : onOpen}
      main={<Text style={r.kt}>{name ? <Subject name={name} testID={`trash-${fact.factId}-subject`} onPress={onOpen} /> : null}<Text style={r.gone}>{fact.text}</Text></Text>}
      meta={<MetaLine parts={parts} />}
      actions={canRestore ? <RestoreButton id={fact.factId} onPress={onRestore} /> : <View style={r.lock} testID={`locked-${fact.factId}`}><Icon name="lock" size={12} color="var(--ink-3)" /><Text style={r.lockText}>Admins only</Text></View>}
    />
  );
}

export function RestoreButton({ id, onPress }: { id: string; onPress: () => void }): ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Restore" testID={`restore-${id}`} onPress={onPress} style={({ hovered }: { hovered?: boolean }) => [r.restore, hovered === true && r.btnOver]}>
      <Icon name="undo" size={13} color="var(--ink-2)" /><Text style={r.restoreText}>Restore</Text>
    </Pressable>
  );
}

/** A trashed page: its title, what it was, Restore. */
export function TrashPageRow({ page, onRestore, menu }: { page: { pageId: string; title: string; kind: string }; onRestore: () => void; menu: () => MenuEntry[] }): ReactElement {
  return (
    <KRow
      testID={`trash-page-${page.pageId}`} always label={`${page.title}, a page in Trash`} menu={menu} onOpen={onRestore}
      main={<Text style={r.kt}><Subject name={page.title} plain /><Text style={r.gone}>{`${capital(page.kind)} page`}</Text></Text>}
      meta={<MetaLine parts={["Removed with all its facts", "Restoring it brings them back"]} />}
      actions={<RestoreButton id={page.pageId} onPress={onRestore} />}
    />
  );
}

// ---------------------------------------------------------------- headers, banner, faces

/** "Today  4": the header of a day group. */
export function DayHead({ label, count }: { label: string; count: number }): ReactElement {
  return <View style={r.day} testID={`day-${label}`}><Text accessibilityRole="header" aria-level={3} style={r.dayLabel}>{label}</Text><View style={r.grow} /><Text style={r.dayCount}>{count}</Text></View>;
}

/** "Last 7 days · 3 shown  Show all": what is filtered and the way back. */
export function FilterBanner({ text, onClear, testID = "know-banner" }: { text: string; onClear: () => void; testID?: string }): ReactElement {
  return (
    <View style={r.banner} testID={testID}>
      <Text style={r.bannerText}>{text}</Text>
      <View style={r.grow} />
      <Pressable accessibilityRole="button" testID={`${testID}-clear`} onPress={onClear} style={({ hovered }: { hovered?: boolean }) => [r.bannerBtn, hovered === true && r.bannerOver]}><Text style={r.bannerBtnText}>Show all</Text></Pressable>
    </View>
  );
}

/** A line of the Space a screen says in words (the bar of Archive for a member). */
export function Bar({ icon, text, testID }: { icon: "lock" | "info"; text: string; testID: string }): ReactElement {
  return <View style={r.bar} testID={testID} accessibilityRole="alert"><Icon name={icon} size={15} color="var(--ink-3)" /><Text style={r.barText}>{text}</Text></View>;
}

/** The face of an actor on the trail: a person, an agent, the assistant, or the upkeep glyph. */
export function ActorFace({ name, kind, size = 24 }: { name: string; kind: "person" | "agent" | "upkeep" | "system"; size?: number }): ReactElement {
  if (kind === "upkeep" || kind === "system") return <View style={[r.upk, { width: size, height: size }]}><Icon name="bolt" size={Math.round(size * 0.5)} color="var(--ink-3)" /></View>;
  if (kind === "person") return <Avatar name={name} kind="person" size={size} />;
  return <Avatar name={name} kind={name === "Assistant" ? "assistant" : "agent"} size={size} />;
}


const r = StyleSheet.create({
  error: { marginTop: 12, fontSize: 12.5, color: "var(--danger)" as string },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 11, paddingHorizontal: 10, marginHorizontal: -10, borderRadius: 10 },
  rowOver: { backgroundColor: "var(--hover)" as string },
  rowFlash: { backgroundColor: "var(--accent-wash)" as string },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "var(--ink-4)" as string, marginTop: 8, marginLeft: 4, marginRight: 4 },
  dotHollow: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: "var(--ink-4)" as string },
  body: { flex: 1, minWidth: 0 },
  acts: { flexDirection: "row", alignItems: "flex-start", gap: 2, paddingTop: 1 },
  kt: { fontSize: 14, lineHeight: 22, color: "var(--ink)" as string },
  subj: { fontWeight: "600", color: "var(--ink)" as string },
  subjOver: { color: "var(--accent)" as string },
  text: { color: "var(--ink-2)" as string },
  gone: { color: "var(--ink-3)" as string, textDecorationLine: "line-through" },
  metaLine: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 2 },
  meta: { fontSize: 12.5, color: "var(--ink-3)" as string },
  sep: { fontSize: 12.5, color: "var(--ink-4)" as string },
  warn: { color: "var(--warn)" as string, fontWeight: "500" },
  edit: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 4 },
  input: { flexGrow: 1, flexBasis: 260, minWidth: 200, height: 30, borderRadius: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: "var(--field-line)", backgroundColor: "var(--field)" as string, color: "var(--ink)" as string, fontSize: 13.5 },
  btn: { height: 28, paddingHorizontal: 10, borderRadius: 7, justifyContent: "center", alignItems: "center" },
  btnOver: { backgroundColor: "var(--hover)" as string },
  btnText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  btnPri: { backgroundColor: "var(--accent)" as string },
  btnPriOver: { opacity: 0.88 },
  btnPriText: { fontSize: 12.5, fontWeight: "600", color: "var(--win)" as string },
  restore: { height: 26, paddingHorizontal: 9, borderRadius: 7, flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: "var(--line)" as string },
  restoreText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink)" as string },
  lock: { flexDirection: "row", alignItems: "center", gap: 5, height: 26 },
  lockText: { fontSize: 12, color: "var(--ink-3)" as string },
  day: { flexDirection: "row", alignItems: "center", marginTop: 28, marginBottom: 4, minHeight: 26 },
  dayLabel: { margin: 0, fontSize: 12, fontWeight: "600", color: "var(--ink-3)" as string },
  dayCount: { fontSize: 12, color: "var(--ink-4)" as string, fontVariant: ["tabular-nums"] },
  grow: { flex: 1 },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14, height: 30, paddingLeft: 12, paddingRight: 6, borderRadius: 8, backgroundColor: "var(--accent-wash)" as string },
  bannerText: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
  bannerBtn: { height: 24, paddingHorizontal: 8, borderRadius: 6, justifyContent: "center" },
  bannerOver: { backgroundColor: "var(--hover)" as string },
  bannerBtnText: { fontSize: 12.5, fontWeight: "600", color: "var(--accent)" as string },
  bar: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "var(--accent-wash)" as string },
  barText: { flex: 1, fontSize: 12.5, color: "var(--ink-2)" as string },
  upk: { borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string },
});
