// Needs you (spec 3.2 flow 7, 2.8): a calm two-column inbox. The list on the left is one list in the queue's order as the prototype lists it (ruling 45; urgency shows in each row's own words) with a quiet kind filter; the request on
// the right says what it is, why, where it came from, and offers one primary action and Send back. Acting here acts at the source: approving continues the chat or run at once and
// Send back carries the note in. A request addressed to a role is taken by its first holder; others see who has it. On a phone the two columns become two screens.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { VirtualList } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { act, snooze, take } from "./actions.ts";
import type { NeedsDeps } from "./actions.ts";
import { NeedsYouDataProvider, useNeedsData, useOnline, useOptionalNeedsData, useScreenQuery } from "./data.tsx";
import type { NeedsYouData } from "./data.tsx";
import {
  FILTERS, SNOOZES, arrivedLabel, blockView, holder, kindWord, matchesFilter, needsLine, needsNote, needsTake, nextSelection, notePrompt, roleWord, rowNote, sortItems,
  isWithdrawn, peopleCount, participants, sourceWord, splitActions, splitWithdrawn, stateWord, stepSelection,
} from "./model.ts";
import type { Action, BlockView, Item, KindFilter, Task } from "./model.ts";
import { Button, Face, Icon, LeadIcon, Tool } from "./parts.tsx";

type ItemsOut = CapMap["tasks.needs_you"]["out"];
type CountOut = CapMap["tasks.count_needs_you"]["out"];

export const NEEDS_SCREEN = "tasks.needs-you";
export const LIST_W = 340;
export const NARROW = 640;
export const LIST_LIMIT = 100;

export function NeedsYou({ data, window, initialSelected }: { data?: NeedsYouData; window?: VirtualWindow; initialSelected?: string }): ReactElement {
  const ctx = useOptionalNeedsData();
  const value = data ?? ctx;
  if (!value) return <NeedsYouLoading />;
  return <NeedsYouDataProvider value={value}><NeedsView {...(window ? { window } : {})} {...(initialSelected ? { initialSelected } : {})} /></NeedsYouDataProvider>;
}

/** The frame before data: rows the size of the real ones, so nothing moves when the data arrives. */
export function NeedsYouLoading(): ReactElement {
  const rows: ReactElement[] = [];
  for (let i = 0; i < 8; i++) rows.push(<View key={i} style={st.skRow}><View style={st.skFace} /><View style={{ flex: 1, gap: 6 }}><View style={[st.skBar, { width: `${50 + ((i * 11) % 35)}%` }]} /><View style={[st.skBar, { width: "70%", height: 8 }]} /></View></View>);
  return <View testID="needs-loading" accessibilityLabel="Loading" style={st.root}><View style={st.list}><View style={st.head} />{rows}</View></View>;
}

function NeedsView({ window, initialSelected }: { window?: VirtualWindow; initialSelected?: string }): ReactElement {
  const data = useNeedsData();
  const online = useOnline();
  const menu = useMenu();
  const win = useWindowDimensions();
  const narrow = win.width > 0 && win.width < NARROW;
  const [filter, setFilter] = useState<KindFilter>("all");
  const [selected, setSelected] = useState<string | null>(initialSelected ?? null);
  const [screen, setScreen] = useState<"list" | "detail">("list");
  const [compose, setCompose] = useState<{ taskId: string; action: Action } | null>(null);
  const [draft, setDraft] = useState("");
  const [line, setLine] = useState("");
  const clock = data.clock();
  const itemsQ = useScreenQuery<ItemsOut>(NEEDS_SCREEN, "items", { limit: LIST_LIMIT });
  const countQ = useScreenQuery<CountOut>(NEEDS_SCREEN, "count", {});
  const deps: NeedsDeps = useMemo(() => ({ call: data.call, note: (text: string) => setLine(text) }), [data.call]);

  if (itemsQ.status === "loading") return <NeedsYouLoading />;
  const all = itemsQ.data.items;
  const list = sortItems(splitWithdrawn(all).live).filter((i) => matchesFilter(i.task, filter));
  // Withdrawn requests sit in their own section below the list, only while every kind is showing.
  const withdrawn = filter === "all" ? splitWithdrawn(all).withdrawn : [];
  const pool = [...list, ...withdrawn];
  const current: Item | undefined = pool.find((i) => i.task.id === selected) ?? list[0] ?? withdrawn[0];
  const count = countQ.status === "ready" ? countQ.data.count : itemsQ.data.total;
  const who = (t: Task): string => data.nameOf(t.createdBy);

  const choose = (id: string): void => { setSelected(id); setCompose(null); setDraft(""); setScreen("detail"); };
  const doAct = async (i: Item, a: Action, note?: string): Promise<void> => {
    if (needsNote(a) && (note ?? "").trim() === "") { setCompose({ taskId: i.task.id, action: a }); setSelected(i.task.id); setScreen("detail"); return; }
    const after = nextSelection(pool, i.task.id);
    const ok = await act(deps, i.task, a, who(i.task), note);
    if (ok) { setSelected(after); setCompose(null); setDraft(""); if (narrow) setScreen("list"); }
  };
  const entriesFor = (i: Item): MenuEntry[] => {
    const a = splitActions(i.task);
    const out: MenuEntry[] = [];
    if (a.primary) { const p = a.primary; out.push({ label: p.label, onSelect: () => void doAct(i, p) }); }
    if (a.sendBack) { const b = a.sendBack; out.push({ label: "Send Back…", onSelect: () => void doAct(i, b) }); }
    for (const m of a.more) out.push({ label: m.label, onSelect: () => void doAct(i, m) });
    if (out.length > 0) out.push({ separator: true });
    for (const c of SNOOZES) out.push({ label: `Snooze: ${c.label}`, onSelect: () => void snooze(deps, i.task, c.key, clock) });
    out.push({ separator: true }, { label: "Open Source", onSelect: () => { const s = i.task.source; if (s) data.nav.openSource(s.kind, s.id); } });
    if (needsTake(i.task, data.me)) out.push({ label: "Take", onSelect: () => void take(deps, i.task) });
    return out;
  };
  const filterMenu = (x: number, y: number): void => {
    const items: MenuEntry[] = [];
    for (const f of FILTERS) items.push({ label: f.label, checked: filter === f.key, onSelect: () => setFilter(f.key) });
    menu.show(items, x, y, "other");
  };

  const onKeyDown = (ev: { key?: string; target?: { tagName?: string }; preventDefault?: () => void }): void => {
    const tag = (ev.target?.tagName ?? "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault?.(); setSelected(stepSelection(pool, current?.task.id ?? null, ev.key === "ArrowDown" ? 1 : -1)); return; }
    if (!current) return;
    const a = splitActions(current.task);
    if ((ev.key === "a" || ev.key === "A") && a.primary) { ev.preventDefault?.(); void doAct(current, a.primary); }
    if ((ev.key === "b" || ev.key === "B") && a.sendBack) { ev.preventDefault?.(); void doAct(current, a.sendBack); }
  };

  const renderRow = (i: Item): ReactElement => {
    const sel = current?.task.id === i.task.id;
    const a = splitActions(i.task);
    const quick = a.primary && !needsNote(a.primary) && !isWithdrawn(i) ? a.primary : null;
    const verb = i.task.kind === "unblock" ? "Unblock" : kindWord(i.task);
    const full = rowNote(i, who(i.task), clock);
    const note = full.startsWith(`${verb} \u00b7 `) ? full.slice(verb.length + 3) : full;
    return (
      <View style={isWithdrawn(i) ? st.dimRow : undefined} {...menuTrigger((x, y) => menu.show(entriesFor(i), x, y, "context", { label: i.task.title }))}>
        <Row
          id={`need-${i.task.id}`} title={i.task.title} note={note} noteLead={verb} noteLeadTone={i.task.kind === "unblock" ? "warning" : "accent"} selected={sel} onPress={() => choose(i.task.id)}
          leading={<Face name={who(i.task)} seedId={i.task.createdBy} size={26} />}
          trailing={
            <RowEnd
              time={arrivedLabel(i.task.updatedAt, clock)} lit={sel}
              quick={quick && holder(i, data.me).kind === "free" ? <Tool icon="check" label={`${quick.label} ${i.task.title}`} onPress={() => void doAct(i, quick)} testID={`quick-${i.task.id}`} /> : null}
            />
          }
        />
      </View>
    );
  };

  const listPane = (
    <View testID="needs-list" style={[st.list, narrow ? { flex: 1 } : { width: LIST_W }]}>
      <View style={st.head}>
        <Text accessibilityRole="header" style={st.headText}>Needs you</Text>
        {count > 0 ? <View testID="needs-count" style={st.badge}><Text style={st.badgeText}>{count > 99 ? "99+" : count}</Text></View> : null}
        <View style={{ flex: 1 }} />
        {online ? null : <Text testID="needs-offline" style={st.quiet}>Offline</Text>}
        <Tool icon="filter" label="Filter" onPress={filterMenu} active={filter !== "all"} testID="needs-filter" />
      </View>
      {list.length === 0 && withdrawn.length === 0 ? (
        <View testID="needs-empty" style={{ flex: 1 }}>
          <States kind="empty" icon="done" title={filter === "all" ? `All caught up. Nothing in ${data.space.name} is waiting on you.` : "Nothing here. Try another filter."} />
        </View>
      ) : (
        <NeedList items={list} withdrawn={withdrawn} render={renderRow} {...(window ? { window } : {})} />
      )}
      {line ? <View testID="needs-line" style={st.note}><Text numberOfLines={2} style={st.noteText}>{line}</Text></View> : null}
      <View style={st.foot}><Text style={st.footText}>↑ ↓ to move · A approve · B send back</Text></View>
    </View>
  );
  const detail = current ? (
    <Detail
      item={current} narrow={narrow} compose={compose && compose.taskId === current.task.id ? compose.action : null} draft={draft} onDraft={setDraft}
      onBack={() => setScreen("list")} onAct={(a, note) => void doAct(current, a, note)} onCancel={() => { setCompose(null); setDraft(""); }}
      menuItems={entriesFor(current)} showMenu={(items, x, y) => menu.show(items, x, y, "other")} deps={deps}
    />
  ) : (
    <View testID="needs-nothing" style={st.nothing}><Icon name="inbox" size={22} color="var(--ink-4)" /><Text style={st.nothingHead}>Nothing selected</Text><Text style={st.nothingSub}>Approvals, reviews and blocked work from every agent land here.</Text></View>
  );

  return (
    <View testID="needs-you" accessibilityLabel="Needs you" style={st.root} {...({ tabIndex: 0, onKeyDown } as object)}>
      {narrow ? (screen === "detail" && current ? detail : listPane) : <>{listPane}<View style={st.detail}>{detail}</View></>}
      {menu.element}
    </View>
  );
}

interface DetailProps {
  item: Item;
  narrow: boolean;
  compose: Action | null;
  draft: string;
  onDraft: (t: string) => void;
  onBack: () => void;
  onAct: (a: Action, note?: string) => void;
  onCancel: () => void;
  menuItems: MenuEntry[];
  showMenu: (items: MenuEntry[], x: number, y: number) => void;
  deps: NeedsDeps;
}

function Detail({ item, narrow, compose, draft, onDraft, onBack, onAct, onCancel, menuItems, showMenu, deps }: DetailProps): ReactElement {
  const data = useNeedsData();
  const t = item.task;
  const clock = data.clock();
  const who = data.nameOf(t.createdBy);
  const actions = splitActions(t);
  const held = holder(item, data.me);
  const mustTake = needsTake(t, data.me) && held.kind === "free";
  const warn = t.blocked || t.kind === "unblock";
  const src = t.source;
  const srcTitle = src ? data.sourceTitle(src.kind, src.id) ?? sourceWord(src) : "";
  const assigned = data.nameOf(t.assigned.id);
  const gone = isWithdrawn(item);
  const people = participants(t, (id) => (id.startsWith("usr_") ? "person" : "agent"));
  const peopleMenu = (x: number, y: number): void => {
    const who: MenuEntry[] = [];
    for (const p of people) who.push({ label: `${data.nameOf(p.id)}, ${p.role}`, onSelect: () => undefined });
    showMenu(who, x, y);
  };
  const blockNodes: ReactElement[] = [];
  for (const [i, b] of t.blocks.entries()) blockNodes.push(<Block key={`${b.type}-${i}`} view={blockView(b)} />);
  const moreButtons: ReactElement[] = [];
  for (const m of actions.more) moreButtons.push(<Button key={m.key} label={m.label} onPress={() => onAct(m)} testID={`needs-action-${m.key}`} />);
  const primary = actions.primary;
  const sendBack = actions.sendBack;
  const meta = [stateWord(t.state), `Assigned to ${assigned}`, t.kind === "approve" || t.kind === "review" || t.kind === "unblock" || t.kind === "answer" ? `${roleWord(t)}: You` : ""].filter((x) => x !== "").join(" · ");
  return (
    <ScrollView testID="needs-detail" style={{ flex: 1 }} contentContainerStyle={st.dIn}>
      {narrow ? <Pressable accessibilityRole="button" accessibilityLabel="Back to Needs you" onPress={onBack} testID="needs-back" style={st.back}><Icon name="back" size={14} /><Text style={st.backText}>Needs you</Text></Pressable> : null}
      <View style={st.dTop}>
        <Face name={who} seedId={t.createdBy} size={36} />
        <View style={st.dTopText}>
          <Text testID="needs-kind" style={[st.dKind, warn && { color: "var(--warn)" as string }]}>{gone ? "Withdrawn" : needsLine(t)}</Text>
          <Text accessibilityRole="header" style={st.dTitle}>{t.title}</Text>
          {t.summary ? <Text style={st.dSummary}>{t.summary}</Text> : null}
          <Text testID="needs-meta" style={st.dMeta}>{meta}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Participants, ${peopleCount(people)}`} testID="needs-participants" onPress={(e) => {
          const box = (e as unknown as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } }).currentTarget?.getBoundingClientRect?.();
          peopleMenu(box ? box.left : 0, box ? box.bottom + 4 : 0);
        }} style={st.people}>
          <Icon name="people" size={14} color="var(--accent)" />
          <Text style={st.peopleN}>{peopleCount(people)}</Text>
        </Pressable>
        <Tool icon="more" label="More" onPress={(x, y) => showMenu(menuItems, x, y)} testID="needs-more" />
      </View>
      {gone ? <Text testID="needs-withdrawn" style={st.why}>{`Withdrawn by ${data.nameOf(t.createdBy)}, nothing to do.`}</Text> : null}
      {t.why ? <Text testID="needs-why" style={st.why}>{t.why}</Text> : null}
      {blockNodes}
      <View style={st.src}>
        <Text style={st.srcText}>From </Text>
        {src ? <Pressable accessibilityRole="link" onPress={() => data.nav.openSource(src.kind, src.id)} testID="needs-source"><Text style={st.link}>{srcTitle}</Text></Pressable> : <Text style={st.srcText}>{who}</Text>}
        <Text style={st.srcText}>{` · ${who} · ${arrivedLabel(t.updatedAt, clock)}`}</Text>
      </View>
      {held.kind === "handled" ? <Text testID="needs-handled" style={st.holder}>{`Handled by ${data.nameOf(held.by ?? "")}`}</Text> : null}
      {held.kind === "taken" ? <Text testID="needs-taken" style={st.holder}>{`Taken by ${data.nameOf(held.by ?? "")}`}</Text> : null}
      {compose ? (
        <View testID="needs-compose" style={st.compose}>
          <TextInput
            accessibilityLabel={noteLabel(compose)} placeholder={notePrompt(compose, who)} value={draft} onChangeText={onDraft} autoFocus multiline style={st.input}
            {...{ onKeyPress: (e: { nativeEvent?: { key?: string } }) => { if (e.nativeEvent?.key === "Escape") onCancel(); } }}
          />
          <View style={st.row}>
            <Button label={compose.label} primary disabled={draft.trim() === "" && needsNote(compose)} onPress={() => onAct(compose, draft)} testID="needs-send" />
            <Button label="Cancel" onPress={onCancel} testID="needs-cancel" />
          </View>
        </View>
      ) : null}
      {held.kind === "free" && !compose ? (
        <View testID="needs-actions" style={st.acts}>
          {mustTake ? <Button label="Take" primary onPress={() => void take(deps, t)} testID="needs-take" /> : null}
          {!mustTake && primary ? <Button label={primary.label} primary hint="A" onPress={() => onAct(primary)} testID="needs-primary" /> : null}
          {!mustTake && sendBack ? <Button label="Send back" hint="B" onPress={() => onAct(sendBack)} testID="needs-sendback" /> : null}
          {!mustTake ? moreButtons : null}
          {t.kind === "unblock" && t.source ? <Button label="Open its computer" onPress={() => data.nav.openComputer(t.createdBy)} testID="needs-computer" /> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

function noteLabel(a: Action): string {
  return a.key === "send_back" ? "What to change" : "Note";
}

export function TaskBlock({ view }: { view: BlockView }): ReactElement {
  if (view.type === "table") {
    const head: ReactElement[] = [];
    for (const [i, c] of view.columns.entries()) head.push(<Text key={c} style={[st.th, i > 0 && st.tdR]}>{c}</Text>);
    const body: ReactElement[] = [];
    for (const [ri, r] of view.rows.entries()) {
      const cells: ReactElement[] = [];
      const tag = view.tags?.[ri] ?? "";
      for (const [i, c] of r.entries()) {
        cells.push(
          <Text key={i} style={[st.td, i > 0 && st.tdR]}>
            {c}
            {i === 0 && tag !== "" ? <Text testID="row-tag" style={st.tag}>{`  ${tag}`}</Text> : null}
          </Text>,
        );
      }
      body.push(<View key={ri} style={st.tr}>{cells}</View>);
    }
    return (
      <View testID="block-table" style={st.table}>
        <View style={st.tr}>{head}</View>
        {body}
        {view.more ? <Text style={st.more}>{`${view.more} more in the chat`}</Text> : null}
      </View>
    );
  }
  if (view.type === "pairs") {
    const pairs: ReactElement[] = [];
    for (const [i, [k, v]] of view.pairs.entries()) pairs.push(<View key={i} style={st.pair}><Text style={st.pk}>{k}</Text><Text style={st.pv}>{v}</Text></View>);
    return <View testID="block-pairs" style={st.pairs}>{pairs}</View>;
  }
  if (view.type === "quote") {
    const lines: ReactElement[] = [];
    for (const [i, l] of view.lines.entries()) lines.push(<Text key={i} style={st.qline}>{l}</Text>);
    return (
      <View testID="block-quote" style={st.quote}>
        {lines}
        {view.source ? <View style={st.qsrc}><LeadIcon name="file" size={12} /><Text style={st.qsrcText}>{`${view.source} · open beside`}</Text></View> : null}
      </View>
    );
  }
  return <Text testID="block-line" style={st.blockLine}>{view.text}</Text>;
}
const Block = TaskBlock;

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0, flexDirection: "row", backgroundColor: "var(--win)" as string },
  list: { minHeight: 0, borderRightWidth: 1, borderRightColor: "var(--line)" as string, backgroundColor: "var(--side)" as string, paddingHorizontal: 6 },
  head: { height: 40, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8 },
  headText: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  badge: { minWidth: 18, height: 18, paddingHorizontal: 6, borderRadius: 9, backgroundColor: "var(--accent-wash)" as string, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 11, fontWeight: "600", color: "var(--accent)" as string },
  quiet: { fontSize: 11.5, color: "var(--ink-3)" as string },
  rowEnd: { flexDirection: "row", alignItems: "center", gap: 4 },
  time: { fontSize: 11, color: "var(--ink-3)" as string },
  note: { paddingHorizontal: 10, paddingVertical: 6, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  noteText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  foot: { height: 30, justifyContent: "center", paddingHorizontal: 10 },
  footText: { fontSize: 11.5, color: "var(--ink-4)" as string },
  detail: { flex: 1, minWidth: 0, minHeight: 0 },
  dIn: { paddingHorizontal: 28, paddingVertical: 24, gap: 14, maxWidth: 720 },
  back: { height: 28, flexDirection: "row", alignItems: "center", gap: 6, marginLeft: -4 },
  backText: { fontSize: 13, color: "var(--ink-2)" as string },
  dTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  dTopText: { flex: 1, minWidth: 0, gap: 3 },
  dKind: { fontSize: 11.5, fontWeight: "600", color: "var(--accent)" as string },
  dTitle: { fontSize: 20, lineHeight: 26, fontWeight: "600", color: "var(--ink)" as string },
  dSummary: { fontSize: 13.5, lineHeight: 19, color: "var(--ink-2)" as string },
  dMeta: { fontSize: 12, color: "var(--ink-3)" as string },
  why: { fontSize: 13.5, lineHeight: 20, color: "var(--ink-2)" as string },
  src: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  srcText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  link: { fontSize: 12.5, color: "var(--accent)" as string },
  holder: { fontSize: 13, color: "var(--ink-2)" as string, paddingVertical: 4 },
  compose: { gap: 8 },
  input: { minHeight: 60, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--raised)" as string, color: "var(--ink)" as string, fontSize: 13.5 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  acts: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingTop: 4 },
  nothing: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 24 },
  nothingHead: { fontSize: 14, fontWeight: "500", color: "var(--ink-2)" as string },
  nothingSub: { fontSize: 12.5, color: "var(--ink-3)" as string, textAlign: "center" },
  table: { borderRadius: 8, borderWidth: 1, borderColor: "var(--line)" as string, overflow: "hidden" },
  tr: { flexDirection: "row", minHeight: 30, alignItems: "center", paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  th: { flex: 1, fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  td: { flex: 1, fontSize: 13, color: "var(--ink)" as string },
  tdR: { textAlign: "right" },
  more: { padding: 8, fontSize: 12.5, color: "var(--accent)" as string },
  pairs: { gap: 6 },
  pair: { flexDirection: "row", gap: 12 },
  pk: { width: 120, fontSize: 12.5, color: "var(--ink-3)" as string },
  pv: { flex: 1, fontSize: 13, color: "var(--ink)" as string },
  quote: { gap: 6, padding: 12, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  qline: { fontSize: 13, lineHeight: 19, color: "var(--ink)" as string },
  tag: { fontSize: 11, fontWeight: "500", color: "var(--warn)" as string },
  people: { height: 24, paddingHorizontal: 6, borderRadius: 6, flexDirection: "row", alignItems: "center", gap: 4 },
  peopleN: { fontSize: 12, fontWeight: "600", color: "var(--accent)" as string },
  dimRow: { opacity: 0.6 },
  nsec: { height: 44, justifyContent: "flex-end", paddingHorizontal: 10, paddingBottom: 6 },
  nsecText: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  qsrc: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 4 },
  qsrcText: { fontSize: 12, color: "var(--ink-3)" as string },
  blockLine: { fontSize: 12.5, color: "var(--ink-3)" as string },
  skRow: { height: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8 },
  skFace: { width: 26, height: 26, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  skBar: { height: 10, borderRadius: 5, backgroundColor: "var(--sunk)" as string },
});

function keyOfItem(i: Item): string {
  return i.task.id;
}

/** The list of requests: ui/VirtualList over ui/Row, 44 high because every row has its second line. Withdrawn requests follow under their own label (same 44 px). */
type Entry = { key: string; item: Item } | { key: string; label: string };
function NeedList({ items, withdrawn, render, window }: { items: readonly Item[]; withdrawn: readonly Item[]; render: (i: Item) => ReactElement; window?: VirtualWindow }): ReactElement {
  const entries: Entry[] = [];
  for (const item of items) entries.push({ key: keyOfItem(item), item });
  if (withdrawn.length > 0) {
    entries.push({ key: "label:withdrawn", label: "Withdrawn" });
    for (const item of withdrawn) entries.push({ key: keyOfItem(item), item });
  }
  const renderEntry = (e: Entry): ReactElement => ("item" in e ? render(e.item) : <WithdrawnLabel label={e.label} />);
  return <VirtualList data={entries} rowHeight={44} keyOf={(e) => e.key} renderItem={renderEntry} {...(window ? { window } : {})} />;
}

/** The quiet label above the withdrawn requests: a section heading, not a list item. */
function WithdrawnLabel({ label }: { label: string }): ReactElement {
  return <View testID="needs-withdrawn-label" style={st.nsec}><Text accessibilityRole="header" style={st.nsecText}>{label}</Text></View>;
}

/** The end of a row: when it arrived and the quick action, which shows on hover and on the selected row. */
function RowEnd({ time, lit, quick }: { time: string; lit: boolean; quick: ReactElement | null }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <View {...{ onMouseEnter: () => setOver(true), onMouseLeave: () => setOver(false) }} style={st.rowEnd}>
      <Text style={st.time}>{time}</Text>
      {quick ? <View style={{ opacity: over || lit ? 1 : 0 }}>{quick}</View> : null}
    </View>
  );
}
