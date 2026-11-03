// The pieces of a task row, shared by the list, the board, the timeline and the task page: the face of whoever holds it, the baton marks, the words of a live agent, and small text menus. Rows are memoised and read only
// the row they were handed, so one change repaints one row.
import { createElement as h, memo, useMemo, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { menuTrigger } from "../../../../../../ui/src/Menu/index.tsx";
import { injectCss } from "../../../../../../ui/src/theme/css.ts";
import { StatusDot } from "../../../../../../ui/src/TaskPage/StatusDot.tsx";
import type { ActivityStore, LiveTurn, TurnStreams } from "../../../shell/session/turn-streams.ts";
import { activityLine } from "../conversation/activity.ts";
import { Glyph } from "../conversation/parts.tsx";
import { batonMarks, dueLabel, holderOf, isOpenState, KIND_TITLE, ago } from "./model.ts";
import { canTake } from "./moves.ts";
import type { NeedItem, TaskRow, Who } from "./model.ts";

export interface RowEnv {
  now: number; offsetMin: number; me: string; turns?: TurnStreams | undefined;
  nameOf(id: string): string; project(recordId: string): string | undefined; keyOf(taskId: string): string | undefined;
  open(id: string): void; openProfile(who: Who): void;
  status(row: TaskRow, at: { x: number; y: number }): void;
  menu(row: TaskRow, at: { x: number; y: number }): void;
  pick(id: string, range: boolean): void;
  act(item: NeedItem, key: string): void;
  /** the right-click menu of a Needs you row */
  needMenu?(item: NeedItem, at: { x: number; y: number }): void;
}

export const faceKind = (w: Who): "person" | "agent" | "group" | "automation" => (w.kind === "role" ? "group" : w.kind);
export const webProps = (p: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? p : {});

const NO_TURNS: readonly LiveTurn[] = [];
const noSub = (): (() => void) => () => undefined;

/** The turn an agent is running on this thread now, from the live link. Rows on screen read it; rows off screen cost nothing. */
export function useLiveTurn(turns: TurnStreams | undefined, thread: string | undefined): LiveTurn | undefined {
  const read = (): readonly LiveTurn[] => (turns && thread ? turns.turnsOf(thread) : NO_TURNS);
  const list = useSyncExternalStore(turns && thread ? turns.subscribe : noSub, read, read);
  return list.find((t) => t.state === "writing");
}

function useActivity(store: ActivityStore | undefined): string {
  const get = (): string => { if (!store) return ""; const l = activityLine(store.get()); return l.label; };
  return useSyncExternalStore(store ? store.subscribe : noSub, get, get);
}

/** The agent's words while it works: what it is doing right now. */
export function LiveWords({ turn, turns, name }: { turn: LiveTurn; turns: TurnStreams | undefined; name: string }): ReactElement {
  const store = useMemo(() => turns?.activityOf(`turn:${turn.turnId}`), [turns, turn.turnId]);
  const label = useActivity(store);
  return <Text numberOfLines={1} testID="task-live" style={s.live}>{`${name}: ${label || "Working"}`}</Text>;
}

export const BatonMarks = memo(function BatonMarks({ row, title }: { row: Pick<TaskRow, "state" | "reviewer" | "approver">; title?: string }): ReactElement | null {
  const marks = batonMarks(row);
  if (!marks) return null;
  const bits: ReactElement[] = [];
  for (const [i, m] of marks.entries()) bits.push(<View key={i} style={[s.bat, m === "p" && s.batPast, m === "c" && s.batNow]} />);
  return <View {...webProps({ title })} accessibilityLabel={title} style={s.bats}>{bits}</View>;
});

export function FaceButton({ who, name, size, onPress }: { who: Who; name: string; size: number; onPress(): void }): ReactElement {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${name}`} onPress={(e) => { (e as unknown as { stopPropagation?: () => void }).stopPropagation?.(); onPress(); }} style={s.face}><Avatar name={name} seedId={who.id} kind={faceKind(who)} size={size} /></Pressable>;
}

const LINE_CSS = [
  ".vt-row{position:relative;display:flex;align-items:center;gap:12px;box-sizing:border-box;min-height:46px;padding:4px 10px 4px 26px;border-radius:13px;cursor:pointer;outline-offset:-2px}",
  ".vt-row:hover{background:var(--hover)}.vt-row.sel{background:var(--accent-wash)}.vt-row.cur{box-shadow:inset 0 0 0 1.5px var(--accent-line)}",
  ".vt-pick{position:absolute;left:5px;width:16px;height:16px;padding:0;border:0;border-radius:5px;background:none;box-shadow:inset 0 0 0 1.5px var(--line-2);display:grid;place-items:center;color:var(--accent-ink);opacity:0;cursor:pointer}",
  ".vt-row:hover .vt-pick,.vt-pick.on{opacity:1}.vt-pick.on{background:var(--accent);box-shadow:none}",
  ".vt-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}.vt-line{display:flex;align-items:baseline;min-width:0}",
  ".vt-key{margin-right:8px;font-size:12px;color:var(--ink-3);font-variant-numeric:tabular-nums;flex:none}",
  ".vt-title{flex:0 1 auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:14.5px;line-height:19px;color:var(--ink)}.vt-title.dn{color:var(--ink-3)}",
  ".vt-pri{margin-left:8px;font-size:11.5px;color:var(--warn);flex:none}.vt-pri.u{color:var(--danger)}",
  ".vt-sub{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12.5px;line-height:17px;color:var(--ink-3)}",
  ".vt-lab{max-width:90px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12px;color:var(--ink-3)}",
  ".vt-due{min-width:60px;text-align:right;font-size:13px;color:var(--ink-3);flex:none}.vt-due.late{color:var(--danger)}",
  // the title is what a row is for: on a phone everything else gives way first
  "@media (max-width:560px){.vt-key,.vt-lab,.vt-bat{display:none}.vt-row{padding-left:10px;gap:10px}.vt-pick{display:none}.vt-due{min-width:0}}",
].join("\n");

type Press = { stopPropagation(): void; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; key?: string };

/** A row of a long list, in plain elements on the web: what one row costs is what a scroll costs. */
function WebLine({ row, env, selected, current }: { row: TaskRow; env: RowEnv; selected: boolean; current: boolean }): ReactElement {
  const doc = (globalThis as { document?: Parameters<typeof injectCss>[0] }).document;
  if (doc) injectCss(doc, "vyre-task-line", LINE_CSS);
  const turn = useLiveTurn(env.turns, row.workerThread ?? row.threadId);
  const holder = holderOf(row);
  const other = holder && holder.id !== env.me ? holder : undefined;
  const due = dueLabel(row.due, env.now, env.offsetMin);
  const closed = !isOpenState(row.state);
  const project = row.recordId ? env.project(row.recordId) : undefined;
  const waits = row.blocked ? row.dependsOn.map(env.keyOf).filter((k): k is string => k !== undefined) : [];
  const sub = subOf(row, env, waits, project);
  const press = (e: Press): void => { if (e.metaKey || e.ctrlKey) env.pick(row.id, false); else if (e.shiftKey) env.pick(row.id, true); else env.open(row.id); };
  const trigger = menuTrigger((x, y) => env.menu(row, { x, y }));
  return h("div", {
    className: `vt-row${selected ? " sel" : ""}${current ? " cur" : ""}`, role: "button", tabIndex: 0, "aria-label": row.title, "data-tk": row.id, "data-testid": `task-row-${row.id}`, onClick: press,
    ...trigger,
    onKeyDown: (e: Press) => { if (e.key === "Enter") env.open(row.id); else (trigger["onKeyDown"] as ((ev: Press) => void) | undefined)?.(e); },
  },
    h("button", { type: "button", className: `vt-pick${selected ? " on" : ""}`, title: "Select (X)", "aria-label": `Select ${row.title}`, "aria-pressed": selected, onClick: (e: Press) => { e.stopPropagation(); env.pick(row.id, false); } }, selected ? <Glyph name="check" size={10} color="var(--accent-ink)" /> : null),
    <StatusDot state={row.state} live={turn !== undefined} onPress={(at) => env.status(row, at)} testID={`task-status-${row.id}`} />,
    h("div", { className: "vt-text" },
      h("div", { className: "vt-line" },
        row.key ? h("span", { className: "vt-key" }, row.key) : null,
        h("span", { className: `vt-title${closed ? " dn" : ""}` }, row.title),
        row.priority === "urgent" || row.priority === "high" ? h("span", { className: `vt-pri${row.priority === "urgent" ? " u" : ""}` }, row.priority === "urgent" ? "Urgent" : "High") : null,
      ),
      turn ? <LiveWords turn={turn} turns={env.turns} name={env.nameOf(turn.agentId)} /> : sub ? h("div", { className: "vt-sub" }, sub) : null,
    ),
    row.labels.length > 0 ? h("span", { className: "vt-lab" }, `#${row.labels[0]}`) : null,
    h("span", { className: "vt-bat", style: { flex: "none" } }, <BatonMarks row={row} {...(other ? { title: `With ${env.nameOf(other.id)}` } : {})} />),
    other ? h("span", { style: { flex: "none", display: "inline-flex" }, role: "button", "aria-label": `Open ${env.nameOf(other.id)}`, onClick: (e: Press) => { e.stopPropagation(); env.openProfile(other); } }, <Avatar name={env.nameOf(other.id)} seedId={other.id} kind={faceKind(other)} size={22} />) : null,
    due.text ? h("span", { className: `vt-due${due.late && !closed ? " late" : ""}` }, due.text) : null,
  );
}

/** The second line of a row: what it waits on, else who took a team task (or that it waits for someone to take it), its project and its breakdown. */
function subOf(row: TaskRow, env: RowEnv, waits: readonly string[], project: string | undefined): string {
  if (waits.length > 0) return `Waits on ${waits.slice(0, 3).join(", ")}`;
  const team = row.assigned.kind === "group" || row.assigned.kind === "role";
  const taken = team && isOpenState(row.state) ? (row.takenBy ? `Taken by ${row.takenBy === env.me ? "you" : env.nameOf(row.takenBy)}` : `${env.nameOf(row.assigned.id)}: nobody took it yet`) : "";
  return [taken, project, row.children ? `${row.children.done} of ${row.children.total}` : ""].filter(Boolean).join(" · ");
}

/** One task on a list. */
export const TaskLine = memo(function TaskLine({ row, env, selected, current }: { row: TaskRow; env: RowEnv; selected: boolean; current: boolean }): ReactElement {
  if (Platform.OS === "web") return <View style={s.rowWrap}><WebLine row={row} env={env} selected={selected} current={current} /></View>;
  return <NativeLine row={row} env={env} selected={selected} current={current} />;
});

function NativeLine({ row, env, selected, current }: { row: TaskRow; env: RowEnv; selected: boolean; current: boolean }): ReactElement {
  const roomy = useWindowDimensions().width >= 560;
  const turn = useLiveTurn(env.turns, row.workerThread ?? row.threadId);
  const holder = holderOf(row);
  const other = holder && holder.id !== env.me ? holder : undefined;
  const due = dueLabel(row.due, env.now, env.offsetMin);
  const closed = !isOpenState(row.state);
  const project = row.recordId ? env.project(row.recordId) : undefined;
  const waits = row.blocked ? row.dependsOn.map(env.keyOf).filter((k): k is string => k !== undefined) : [];
  const sub = subOf(row, env, waits, project);
  return <View testID={`task-row-${row.id}`} {...webProps({ "data-tk": row.id })} {...menuTrigger((x, y) => env.menu(row, { x, y }))} style={s.rowWrap}>
    {/* a row of this list: selection, status, title, baton, face and date each have their own press, so it is not one ui/Row press */}
    <Pressable accessibilityRole="button" accessibilityLabel={row.title} onPress={(e) => { const m = e as unknown as { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; nativeEvent?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean } }; const n = m.nativeEvent ?? m; if (n.metaKey || n.ctrlKey) env.pick(row.id, false); else if (n.shiftKey) env.pick(row.id, true); else env.open(row.id); }} style={({ hovered }: { hovered?: boolean }) => [s.row, hovered === true && s.rowHover, selected && s.rowSel, current && s.rowCur]}>
      {({ hovered }: { hovered?: boolean }) => <>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={`Select ${row.title}`} onPress={(e) => { (e as unknown as { stopPropagation?: () => void }).stopPropagation?.(); env.pick(row.id, false); }} {...webProps({ title: "Select (X)" })} style={[s.pick, selected && s.pickOn, !selected && hovered !== true && { opacity: 0 }]}>{selected ? <Glyph name="check" size={10} color="var(--accent-ink)" /> : null}</Pressable>
        <StatusDot state={row.state} live={turn !== undefined} onPress={(at) => env.status(row, at)} testID={`task-status-${row.id}`} />
        <View style={s.text}>
          <View style={s.line}>
            {row.key && roomy ? <Text style={s.key}>{row.key}</Text> : null}
            <Text numberOfLines={1} style={[s.title, closed && s.titleDone]}>{row.title}</Text>
            {row.priority === "urgent" || row.priority === "high" ? <Text style={[s.pri, row.priority === "urgent" && s.priUrgent]}>{row.priority === "urgent" ? "Urgent" : "High"}</Text> : null}
          </View>
          {turn ? <LiveWords turn={turn} turns={env.turns} name={env.nameOf(turn.agentId)} /> : sub ? <Text numberOfLines={1} style={s.sub}>{sub}</Text> : null}
        </View>
        {row.labels.length > 0 && roomy ? <Text numberOfLines={1} style={s.labels}>{`#${row.labels[0]}`}</Text> : null}
        {roomy ? <BatonMarks row={row} {...(other ? { title: `With ${env.nameOf(other.id)}` } : {})} /> : null}
        {other ? <FaceButton who={other} name={env.nameOf(other.id)} size={22} onPress={() => env.openProfile(other)} /> : null}
        {due.text ? <Text style={[s.due, due.late && !closed && s.late]}>{due.text}</Text> : <View style={s.dueGap} />}
      </>}
    </Pressable>
  </View>;
}

/** One request waiting on you: who asks, what, and the one action. */
export const NeedLine = memo(function NeedLine({ item, env }: { item: NeedItem; env: RowEnv }): ReactElement {
  const t = item.task;
  // who the turn came from: the doer who handed it in, the reviewer or approver who sent it back, else whoever asked
  const sentBack = t.kind === "work" && (t.state === "todo" || t.state === "doing") && t.workingNotes["fixes"] !== undefined;
  const by = t.kind === "work" && (t.state === "in_review" || t.state === "awaiting_approval") ? t.assigned.id : sentBack ? (t.reviewer ?? t.approver)?.id ?? t.createdBy : t.createdBy;
  const who: Who = { kind: by.startsWith("agt_") ? "agent" : "person", id: by };
  // a team task is taken first; a held act is approved here; anything else opens, where its move is
  const primary = canTake(t) ? { key: "take", label: "Take" } : t.kind === "approve" ? { key: "approve", label: "Approve" } : { key: "open", label: "Open" };
  const step = t.kind !== "work" ? KIND_TITLE[t.kind] : t.state === "in_review" ? "Your review" : t.state === "awaiting_approval" ? "Your approval" : t.workingNotes["fixes"] !== undefined ? "Sent back to you" : canTake(t) ? `For ${env.nameOf(t.assigned.id)}` : "Given to you";
  const sub = [step, env.nameOf(by), t.recordId ? env.project(t.recordId) : undefined, ago(env.now - t.updatedAt)].filter(Boolean).join(" · ");
  const trigger = env.needMenu ? menuTrigger((x, y) => env.needMenu?.(item, { x, y })) : {};
  return <View style={s.rowWrap} {...trigger}>
    <Pressable accessibilityRole="button" accessibilityLabel={t.title} testID={`need-row-${t.id}`} onPress={() => env.open(t.id)} style={({ hovered }: { hovered?: boolean }) => [s.row, s.need, hovered === true && s.rowHover]}>
      <FaceButton who={who} name={env.nameOf(by)} size={28} onPress={() => env.openProfile(who)} />
      <View style={s.text}><Text numberOfLines={1} style={s.title}>{t.title}</Text><Text numberOfLines={1} style={s.sub}>{sub}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={primary.label} testID={`need-act-${t.id}`} onPress={(e) => { (e as unknown as { stopPropagation?: () => void }).stopPropagation?.(); if (primary.key === "open") env.open(t.id); else env.act(item, primary.key); }} style={({ hovered }: { hovered?: boolean }) => [s.btn, hovered === true && s.btnOver]}><Text style={s.btnText}>{primary.label}</Text></Pressable>
    </Pressable>
  </View>;
});

export function TextMenu({ label, onPress, testID }: { label: string; onPress(at: { x: number; y: number }): void; testID?: string }): ReactElement {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} testID={testID} onPress={(e) => { const t = (e as unknown as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } }).currentTarget?.getBoundingClientRect?.(); onPress({ x: t?.left ?? 8, y: (t?.bottom ?? 48) + 4 }); }} style={({ hovered }: { hovered?: boolean }) => [s.menuBtn, hovered === true && s.menuOver]}>
    <Text numberOfLines={1} style={s.menuText}>{label}</Text><Glyph name="chevd" size={11} color="var(--ink-3)" />
  </Pressable>;
}

export const rowStyles = StyleSheet.create({
  add: { flex: 1, minWidth: 0, height: 28, fontSize: 14.5, color: "var(--ink)" as string, outlineStyle: "none", outlineWidth: 0 } as object,
  headText: { fontSize: 13, fontWeight: "600", color: "var(--ink-2)" as string },
  headCount: { marginLeft: 7, fontSize: 13, color: "var(--ink-4)" as string },
});

const s = StyleSheet.create({
  rowWrap: { width: "100%", maxWidth: 700, alignSelf: "center", paddingHorizontal: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 46, paddingVertical: 4, paddingLeft: 26, paddingRight: 10, borderRadius: 13 },
  need: { minHeight: 52, paddingLeft: 10 },
  rowHover: { backgroundColor: "var(--hover)" as string },
  rowSel: { backgroundColor: "var(--accent-wash)" as string },
  rowCur: { boxShadow: "inset 0 0 0 1.5px var(--accent-line)" } as object,
  pick: { position: "absolute", left: 5, width: 16, height: 16, borderRadius: 5, boxShadow: "inset 0 0 0 1.5px var(--line-2)", alignItems: "center", justifyContent: "center" } as object,
  pickOn: { backgroundColor: "var(--accent)" as string, boxShadow: "none" } as object,
  text: { flex: 1, minWidth: 0, gap: 1 },
  line: { flexDirection: "row", alignItems: "baseline", minWidth: 0 },
  key: { marginRight: 8, fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  title: { flexShrink: 1, fontSize: 14.5, lineHeight: 19, color: "var(--ink)" as string },
  titleDone: { color: "var(--ink-3)" as string },
  pri: { marginLeft: 8, fontSize: 11.5, color: "var(--warn)" as string },
  priUrgent: { color: "var(--danger)" as string },
  sub: { fontSize: 12.5, lineHeight: 17, color: "var(--ink-3)" as string },
  live: { fontSize: 12.5, lineHeight: 17, color: "var(--ink-2)" as string },
  labels: { maxWidth: 90, fontSize: 12, color: "var(--ink-3)" as string },
  bats: { flexDirection: "row", gap: 3, flexShrink: 0 },
  bat: { width: 14, height: 3, borderRadius: 2, backgroundColor: "var(--line-2)" as string },
  batPast: { backgroundColor: "var(--accent)" as string, opacity: 0.5 },
  batNow: { backgroundColor: "var(--accent)" as string },
  face: { flexShrink: 0 },
  due: { minWidth: 60, textAlign: "right", fontSize: 13, color: "var(--ink-3)" as string },
  dueGap: { width: 0 },
  late: { color: "var(--danger)" as string },
  btn: { height: 30, justifyContent: "center", paddingHorizontal: 13, borderRadius: 9, backgroundColor: "var(--accent)" as string },
  btnOver: { opacity: 0.9 },
  btnText: { fontSize: 13, fontWeight: "600", color: "var(--accent-ink)" as string },
  menuBtn: { flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingHorizontal: 9, borderRadius: 9, maxWidth: 200 },
  menuOver: { backgroundColor: "var(--hover)" as string },
  menuText: { flexShrink: 1, fontSize: 13, color: "var(--ink-3)" as string },
});
