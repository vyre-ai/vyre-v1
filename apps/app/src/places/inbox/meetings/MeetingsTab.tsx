// Inbox > Meetings (lane l-meetings, owner 3 Nov: "Meetings close themselves"). The list: one ui/Row per meeting with its time, who was there and its close-out state. Opening one shows the
// package the person's Assistant prepared: the summary, decisions and open questions, then the proposed tasks, record updates, follow-up email and next-meeting hold. Each item is edited in
// place and approved or skipped on its own; Approve all takes every proposed item in one press. A handled item links to what it made. Redo (in the More menu) prepares it again.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { VirtualList } from "../../../../../../ui/src/VirtualList/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { LiveQuery, QueryState } from "../../../../../../client/src/index.ts";
import { useInboxData } from "../sidebar/data.tsx";
import { Glyph, IconButton, pointOf } from "../sidebar/parts.tsx";
import { SCREEN, SECTIONS, STATE_LABEL, dayLabel, handledLine, itemsOf, meetingTime, names, openLabel, openTarget, readyMeta, rowNote, saidBy, taskMeta, waiting } from "./model.ts";
import type { Item, ListOut, MeetingRow, Package } from "./model.ts";

/** Where a link in a package goes. The shell supplies these; the tab never decides how a thing opens. */
export interface MeetingsNav {
  openSubject(s: { type: string; id: string }): void;
  /** The conversation with a contact (an email the follow-up went to). */
  openContact(contactId: string): void;
  openCalendar(): void;
}

const LOADING: QueryState<never> = { status: "loading" };
const NEVER: LiveQuery<never> = { subscribe: () => () => undefined, getSnapshot: () => LOADING };

/** A live query of the Meetings screen. A runtime without the screen (an older server) gives one that stays loading, so the Inbox around it keeps working. */
export function useMeetingsQuery<T>(name: "list" | "meeting", state: Record<string, unknown> = {}): QueryState<T> {
  const { screens } = useInboxData();
  const key = JSON.stringify(state);
  const q = useMemo((): LiveQuery<T> => {
    try { return screens.query(SCREEN, name, JSON.parse(key) as Record<string, unknown>) as LiveQuery<T>; } catch { return NEVER as LiveQuery<T>; }
  }, [screens, name, key]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}

// ---------------------------------------------------------------- the list

function Head({ title, meta, children }: { title: string; meta?: string; children?: ReactNode }): ReactElement {
  return (
    <View style={st.head} testID="meetings-head">
      <View style={st.tt}>
        <Text accessibilityRole="header" aria-level={1} style={st.h1} numberOfLines={1}>{title}</Text>
        {meta ? <Text style={st.metaText} testID="meetings-meta">{meta}</Text> : null}
      </View>
      <View style={st.grow} />
      {children}
    </View>
  );
}

function StateMark({ state }: { state: MeetingRow["state"] }): ReactElement {
  return <Text testID={`meeting-state-${state}`} style={[st.state, state === "ready" ? st.stateReady : state === "nothing" ? st.stateQuiet : null]}>{STATE_LABEL[state]}</Text>;
}

function MeetingList({ onOpen }: { onOpen: (id: string) => void }): ReactElement {
  const data = useInboxData();
  const width = useWindowDimensions().width;
  const slim = width > 0 && width < 560;
  const q = useMeetingsQuery<ListOut>("list");
  const [sel, setSel] = useState<string | null>(null);
  // opening the tab starts the close-out of any recent meeting of yours that has a transcript and none yet (it also tells the server who your Assistant is)
  useEffect(() => { void Promise.resolve(data.call("meetings.closeout.sync", {})).catch(() => undefined); }, [data]);
  const c = data.clock();
  const rows = q.status === "ready" ? q.data.meetings : [];
  const onKeyDown = (ev: { key?: string; preventDefault?: () => void }): void => {
    const at = rows.findIndex((m) => m.meetingId === sel);
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault?.();
      const next = rows[Math.max(0, Math.min(rows.length - 1, at + (ev.key === "ArrowDown" ? 1 : -1)))];
      if (next) setSel(next.meetingId);
    } else if (ev.key === "Enter" && at >= 0) { ev.preventDefault?.(); onOpen(rows[at]!.meetingId); }
  };
  // a phone has no room for the state at the right: it leads the note instead (in the accent for Ready to close)
  const renderLine = (m: MeetingRow): ReactElement => (
    <Row
      id={`meeting:${m.meetingId}`} title={m.title} tall emphasis={m.state === "ready"} selected={sel === m.meetingId}
      note={slim && m.state !== "ready" ? `${STATE_LABEL[m.state]} · ${rowNote(m, c.now, c.offsetMin)}` : rowNote(m, c.now, c.offsetMin)} {...(slim && m.state === "ready" ? { noteLead: STATE_LABEL.ready } : {})}
      leading={<View style={st.tile}><Glyph name="cal" size={15} color={m.state === "ready" ? "var(--accent)" : "var(--ink-3)"} /></View>}
      {...(slim ? {} : { trailing: <StateMark state={m.state} /> })}
      onPress={() => { setSel(m.meetingId); onOpen(m.meetingId); }}
    />
  );
  return (
    <View style={st.main} testID="meetings-list" accessibilityLabel="Meetings">
      <Head title="Meetings" meta={q.status === "ready" ? readyMeta(q.data.ready) : ""} />
      {q.status !== "ready" ? <ListSkeleton /> : rows.length === 0 ? (
        <States kind="empty" title="No meetings to close yet." icon="inbox" />
      ) : (
        <View style={st.listBox} {...({ onKeyDown } as object)}>
          <VirtualList data={rows} rowHeight={62} keyOf={(m) => m.meetingId} renderItem={renderLine} />
        </View>
      )}
    </View>
  );
}

function ListSkeleton(): ReactElement {
  const bars: ReactElement[] = [];
  for (let i = 0; i < 7; i++) bars.push(<View key={i} style={st.skRow}><View style={st.skTile} /><View style={st.skLines}><View style={[st.skBar, { width: `${35 + ((i * 11) % 30)}%` }]} /><View style={[st.skBar, st.skSmall, { width: `${50 + ((i * 7) % 30)}%` }]} /></View></View>);
  return <View testID="meetings-loading" accessibilityLabel="Loading">{bars}</View>;
}

// ---------------------------------------------------------------- the package

/** A button. While a press is on its way it takes no second press, and it does not dim for it (nothing blinks). */
function Btn({ label, onPress, primary = false, disabled = false, testID }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean; testID?: string }): ReactElement {
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} testID={testID} onPress={onPress}
      style={({ hovered }: { hovered?: boolean }) => [st.btn, primary ? PRIMARY : hovered === true && !disabled && st.btnOver]}
    >
      <Text style={[st.btnText, primary && st.btnTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

function LinkText({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }): ReactElement {
  return <Pressable accessibilityRole="link" accessibilityLabel={label} testID={testID} onPress={onPress}><Text style={st.link}>{label}</Text></Pressable>;
}

function Field({ value, onChange, label, multiline = false, testID, onEnter }: { value: string; onChange: (v: string) => void; label: string; multiline?: boolean; testID?: string; onEnter?: () => void }): ReactElement {
  return (
    <TextInput
      value={value} onChangeText={onChange} accessibilityLabel={label} placeholder={label} placeholderTextColor="var(--ink-4)" multiline={multiline} testID={testID} autoComplete="off"
      onKeyPress={(e) => { if (!multiline && e.nativeEvent.key === "Enter") onEnter?.(); }}
      style={[st.input, multiline && st.inputMulti]}
    />
  );
}

/** "2026-11-07" from a time, and back; empty means no date. */
const isoDay = (ms: number | undefined, offsetMin: number): string => (ms === undefined ? "" : new Date(ms + offsetMin * 60_000).toISOString().slice(0, 10));
const dayMs = (s: string, offsetMin: number): number | null | undefined => {
  const t = s.trim();
  if (!t) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return undefined;
  return Date.parse(`${t}T17:00:00Z`) - offsetMin * 60_000;
};
const isoMinute = (ms: number | undefined, offsetMin: number): string => (ms === undefined ? "" : new Date(ms + offsetMin * 60_000).toISOString().slice(0, 16).replace("T", " "));
const minuteMs = (s: string, offsetMin: number): number | undefined => {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/.exec(s.trim());
  return m ? Date.parse(`${m[1]}T${m[2]}:00Z`) - offsetMin * 60_000 : undefined;
};

interface ItemApi {
  busy: boolean;
  approve(i: Item): void;
  skip(i: Item, undo?: boolean): void;
  save(i: Item, patch: Record<string, unknown>): Promise<boolean>;
  setSend(i: Item, send: "send" | "draft"): void;
  open(i: Item, m: NonNullable<Item["made"]>[number]): void;
  nameOf(id: string): string;
  team: ReadonlyArray<{ id: string; name: string }>;
  offsetMin: number;
}

/** One proposed item: what it would do, its fields in place when editing, and Approve, Edit and Skip. Handled, it says what it made and links there. */
function ItemCard({ item, api }: { item: Item; api: ItemApi }): ReactElement {
  const menu = useMenu();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const open = item.status === "proposed" || item.status === "failed";
  const val = (k: string, d: string): string => draft[k] ?? d;
  const set = (k: string) => (v: string): void => setDraft((x) => ({ ...x, [k]: v }));
  const startEdit = (): void => { setDraft({}); setErr(""); setEditing(true); };
  const save = (): void => {
    const p: Record<string, unknown> = {};
    if (draft["title"] !== undefined) p[item.kind === "email" ? "subject" : "title"] = draft["title"];
    if (draft["text"] !== undefined) p["text"] = draft["text"];
    if (draft["note"] !== undefined) p["note"] = draft["note"];
    if (draft["due"] !== undefined) { const d = dayMs(draft["due"], api.offsetMin); if (d === undefined) { setErr("Write the date as 2026-11-07."); return; } p["due"] = d; }
    if (draft["startsAt"] !== undefined) { const s = minuteMs(draft["startsAt"], api.offsetMin); if (s === undefined) { setErr("Write the time as 2026-11-07 15:00."); return; } p["startsAt"] = s; }
    const changes: Array<{ field: string; to: string }> = [];
    for (const ch of item.changes ?? []) if (draft[`ch:${ch.field}`] !== undefined) changes.push({ field: ch.field, to: draft[`ch:${ch.field}`]! });
    if (changes.length) p["changes"] = changes;
    if (Object.keys(p).length === 0) { setEditing(false); return; }
    void api.save(item, p).then((ok) => { if (ok) setEditing(false); else setErr("That did not save. Check the fields and try again."); });
  };
  const assign = (x: number, y: number): void => {
    const entries: MenuEntry[] = [{ head: "Assign to" }];
    for (const p of api.team) entries.push({ label: p.name, checked: p.id === item.assignee, onSelect: () => { void api.save(item, { assignee: p.id }); } });
    menu.show(entries, x, y);
  };
  const sendMenu = (x: number, y: number): void => {
    menu.show([
      { label: "Send it", checked: item.send !== "draft", onSelect: () => api.setSend(item, "send") },
      { label: "Save as a draft", checked: item.send === "draft", onSelect: () => api.setSend(item, "draft") },
    ], x, y);
  };

  let body: ReactElement;
  if (item.kind === "task") {
    const said = saidBy(item, api.nameOf);
    body = (
      <View style={st.itemBody}>
        {editing ? <Field value={val("title", item.title)} onChange={set("title")} label="Task" testID={`edit-title-${item.itemId}`} onEnter={save} /> : <Text style={st.itemTitle} testID={`item-title-${item.itemId}`}>{item.title}</Text>}
        <View style={st.metaRow}>
          {open && !editing ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Assign to" testID={`assign-${item.itemId}`} onPress={(e) => { const p = pointOf(e); assign(p.x, p.y); }} style={({ hovered }: { hovered?: boolean }) => [st.pick, hovered === true && st.btnOver]}>
              <Text style={st.itemMeta}>{taskMeta(item, api.nameOf, api.offsetMin) || "Assign"}</Text><Glyph name="chevd" size={9} />
            </Pressable>
          ) : !editing ? <Text style={st.itemMeta}>{taskMeta(item, api.nameOf, api.offsetMin)}</Text> : null}
          {editing ? <Field value={val("due", isoDay(item.due, api.offsetMin))} onChange={set("due")} label="Due date, 2026-11-07" testID={`edit-due-${item.itemId}`} onEnter={save} /> : null}
        </View>
        {said && !editing ? <Text style={st.itemQuiet}>{said}</Text> : null}
        {item.why && !editing ? <Text style={st.itemQuiet} numberOfLines={2}>{item.why}</Text> : null}
      </View>
    );
  } else if (item.kind === "record") {
    const lines: ReactElement[] = [];
    for (const ch of item.changes ?? []) {
      lines.push(
        <View key={ch.field} style={st.change} testID={`change-${item.itemId}-${ch.field}`}>
          <Text style={st.changeField}>{ch.title}</Text>
          {ch.from ? <><Text style={st.changeFrom} numberOfLines={1}>{ch.from}</Text><Text style={st.arrow}>{"→"}</Text></> : null}
          {editing ? <Field value={val(`ch:${ch.field}`, ch.to)} onChange={set(`ch:${ch.field}`)} label={ch.title} /> : <Text style={st.changeTo} numberOfLines={2}>{ch.to}</Text>}
        </View>,
      );
    }
    body = (
      <View style={st.itemBody}>
        <Text style={st.itemTitle}>{item.title}</Text>
        {lines}
        {editing ? <Field value={val("note", item.note ?? "")} onChange={set("note")} label="Meeting note" multiline testID={`edit-note-${item.itemId}`} /> : item.note ? <Text style={st.note} numberOfLines={4}>{item.note}</Text> : null}
      </View>
    );
  } else if (item.kind === "email") {
    body = (
      <View style={st.itemBody}>
        <Text style={st.itemMeta}>To {names((item.to ?? []).map((t) => t.name ?? t.address), 4)}</Text>
        {editing ? <Field value={val("title", item.subject ?? item.title)} onChange={set("title")} label="Subject" testID={`edit-subject-${item.itemId}`} /> : <Text style={st.itemTitle}>{item.subject ?? item.title}</Text>}
        {editing ? <Field value={val("text", item.text ?? "")} onChange={set("text")} label="Email" multiline testID={`edit-text-${item.itemId}`} /> : <Text style={st.mail} testID={`email-text-${item.itemId}`}>{item.text}</Text>}
      </View>
    );
  } else {
    body = (
      <View style={st.itemBody}>
        {editing ? <Field value={val("title", item.title)} onChange={set("title")} label="Title" onEnter={save} /> : <Text style={st.itemTitle}>{item.title}</Text>}
        {editing ? <Field value={val("startsAt", isoMinute(item.startsAt, api.offsetMin))} onChange={set("startsAt")} label="Starts, 2026-11-07 15:00" onEnter={save} testID={`edit-start-${item.itemId}`} /> : (
          <Text style={st.itemMeta}>{item.startsAt !== undefined ? `${dayLabel(item.startsAt, api.offsetMin, true)}${item.endsAt !== undefined ? ` for ${Math.round((item.endsAt - item.startsAt) / 60_000)} minutes` : ""}` : ""}</Text>
        )}
        <Text style={st.itemQuiet}>A hold on your own calendar. Nobody is invited.</Text>
      </View>
    );
  }

  const links: ReactElement[] = [];
  for (const m of item.made ?? []) links.push(<LinkText key={`${m.type}:${m.id}`} label={openLabel(m)} testID={`made-${item.itemId}-${m.type}`} onPress={() => api.open(item, m)} />);

  return (
    <View style={[st.card, !open && st.cardDone]} testID={`item-${item.itemId}`} accessibilityLabel={`${item.kind}: ${item.title}`}>
      <View style={st.cardMain}>
        <View style={[st.mark, item.status === "approved" && st.markDone, item.status === "failed" && st.markFail]}>{item.status === "approved" ? <Glyph name="check" size={11} color="var(--win)" /> : null}</View>
        {body}
      </View>
      {err ? <Text style={st.err} accessibilityRole="alert">{err}</Text> : null}
      {open ? (
        <View style={st.actions}>
          {item.status === "failed" ? <Text style={st.err} numberOfLines={2}>{handledLine(item)}</Text> : null}
          <View style={st.grow} />
          {editing ? (
            <>
              <Btn label="Cancel" onPress={() => { setEditing(false); setErr(""); }} testID={`cancel-${item.itemId}`} />
              <Btn label="Save" primary onPress={save} testID={`save-${item.itemId}`} />
            </>
          ) : (
            <>
              {item.kind === "email" ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Send or save as a draft" testID={`send-mode-${item.itemId}`} onPress={(e) => { const p = pointOf(e); sendMenu(p.x, p.y); }} style={({ hovered }: { hovered?: boolean }) => [st.pick, hovered === true && st.btnOver]}>
                  <Text style={st.itemMeta}>{item.send === "draft" ? "Save as a draft" : "Send it"}</Text><Glyph name="chevd" size={9} />
                </Pressable>
              ) : null}
              <Btn label="Skip" onPress={() => api.skip(item)} disabled={api.busy} testID={`skip-${item.itemId}`} />
              <Btn label="Edit" onPress={startEdit} disabled={api.busy} testID={`edit-${item.itemId}`} />
              <Btn label="Approve" primary onPress={() => api.approve(item)} disabled={api.busy} testID={`approve-${item.itemId}`} />
            </>
          )}
        </View>
      ) : (
        <View style={st.actions}>
          <Text style={st.done} testID={`done-${item.itemId}`}>{handledLine(item)}</Text>
          {links}
          {item.status === "skipped" ? <LinkText label="Undo" onPress={() => api.skip(item, true)} testID={`unskip-${item.itemId}`} /> : null}
        </View>
      )}
      {menu.element}
    </View>
  );
}

function Bullets({ title, lines, testID }: { title: string; lines: readonly string[]; testID: string }): ReactElement | null {
  if (lines.length === 0) return null;
  const out: ReactElement[] = [];
  for (const [i, l] of lines.entries()) out.push(<View key={i} style={st.bullet}><Text style={st.bulletDot}>{"•"}</Text><Text style={st.bulletText}>{l}</Text></View>);
  return <View testID={testID} style={st.block}><Text style={st.sub}>{title}</Text>{out}</View>;
}

function PackageView({ meetingId, onBack, nav, nameOf, team }: { meetingId: string; onBack: () => void; nav: MeetingsNav; nameOf: (id: string) => string; team: ReadonlyArray<{ id: string; name: string }> }): ReactElement {
  const data = useInboxData();
  const menu = useMenu();
  const width = useWindowDimensions().width;
  const slim = width > 0 && width < 560;
  const q = useMeetingsQuery<Package>("meeting", { meetingId });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const c = data.clock();
  const run = async (cap: string, input: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    setNotice("");
    try { await data.call(cap, input); return true; } catch (e) { setNotice((e as { message?: string }).message || "That did not go through. Try again."); return false; } finally { setBusy(false); }
  };
  if (q.status !== "ready") {
    return <View style={st.main} testID="meeting-loading" accessibilityLabel="Loading"><Head title="Meeting"><View /></Head><ListSkeleton /></View>;
  }
  const p = q.data;
  const left = waiting(p);
  const api: ItemApi = {
    busy, nameOf, team, offsetMin: c.offsetMin,
    approve: (i) => { void run("meetings.closeout.approve", { meetingId, itemIds: [i.itemId] }); },
    skip: (i, undo) => { void run("meetings.closeout.skip", { meetingId, itemId: i.itemId, ...(undo ? { undo: true } : {}) }); },
    save: (i, patch) => run("meetings.closeout.edit", { meetingId, itemId: i.itemId, ...patch }),
    setSend: (i, send) => { void run("meetings.closeout.edit", { meetingId, itemId: i.itemId, send }); },
    open: (i, m) => {
      const t = openTarget(m, i, p.attendees);
      if (!t) return;
      if ("subject" in t) nav.openSubject(t.subject);
      else if ("contactId" in t) nav.openContact(t.contactId);
      else nav.openCalendar();
    },
  };
  const more = (x: number, y: number): void => {
    const entries: MenuEntry[] = [{ label: "Redo the close-out", onSelect: () => { void run("meetings.closeout.prepare", { meetingId, redo: true }); } }];
    if (p.taskId) entries.push({ label: "Open the Assistant's task", onSelect: () => nav.openSubject({ type: "task", id: p.taskId! }) });
    entries.push({ label: "Open the meeting record", onSelect: () => nav.openSubject({ type: "record", id: meetingId }) });
    menu.show(entries, x, y);
  };
  const sections: ReactElement[] = [];
  for (const s of SECTIONS) {
    const its = itemsOf(p, s.kind);
    if (its.length === 0) continue;
    const cards: ReactElement[] = [];
    for (const it of its) cards.push(<ItemCard key={it.itemId} item={it} api={api} />);
    sections.push(<View key={s.kind} style={st.block} testID={`section-${s.kind}`}><Text style={st.sub}>{s.title}</Text>{cards}</View>);
  }
  const who = names(p.attendees.map((a) => a.name), 4);
  return (
    <View style={st.main} testID="meeting-package" accessibilityLabel={p.title}>
      <View style={st.head} testID="meetings-head">
        <Pressable accessibilityRole="link" accessibilityLabel="Back to Meetings" testID="meetings-back" onPress={onBack} style={({ hovered }: { hovered?: boolean }) => [st.back, hovered === true && st.btnOver]}>
          <Text style={st.backText}>{"‹"}</Text>
        </Pressable>
        <Text accessibilityRole="header" aria-level={1} style={[st.h1, st.shrink]} numberOfLines={1}>{p.title}</Text>
        {slim ? null : <StateMark state={p.state} />}
        <View style={st.grow} />
        <IconButton icon="more" label="More" testID="meeting-more" onPress={more} />
        {left > 0 ? <Btn label={left === 1 ? "Approve" : `Approve all ${left}`} primary disabled={busy} onPress={() => { void run("meetings.closeout.approve", { meetingId }); }} testID="approve-all" /> : null}
      </View>
      <ScrollView style={st.scroll} contentContainerStyle={st.scrollIn}>
        <Text style={st.when} testID="meeting-when">{`${slim ? `${STATE_LABEL[p.state]} · ` : ""}${meetingTime(p.startsAt, c.now, c.offsetMin)}${who ? ` · ${who}` : ""}`}</Text>
        {notice ? <Text style={st.err} accessibilityRole="alert" testID="meeting-notice">{notice}</Text> : null}
        {p.state === "preparing" && !p.summary ? (
          <View style={st.block} testID="meeting-preparing">
            <Text style={st.para}>Your Assistant is preparing this from the transcript. It shows here when it is ready.</Text>
            {p.taskId ? <LinkText label="Open the Assistant's task" onPress={() => nav.openSubject({ type: "task", id: p.taskId! })} /> : null}
          </View>
        ) : null}
        {p.summary ? <View style={st.block} testID="meeting-summary"><Text style={st.sub}>Summary</Text><Text style={st.para}>{p.summary}</Text></View> : null}
        <Bullets title="Decisions" lines={p.decisions} testID="meeting-decisions" />
        <Bullets title="Open questions" lines={p.questions} testID="meeting-questions" />
        {sections}
        {p.state === "nothing" ? <Text style={st.para} testID="meeting-nothing">Nothing to do from this meeting.</Text> : null}
      </ScrollView>
      {menu.element}
    </View>
  );
}

// ---------------------------------------------------------------- the tab

export function MeetingsTab({ openId, onOpen, onBack, nav, nameOf, team }: {
  openId: string | null; onOpen: (meetingId: string) => void; onBack: () => void; nav: MeetingsNav; nameOf: (id: string) => string; team: ReadonlyArray<{ id: string; name: string }>;
}): ReactElement {
  if (openId) return <PackageView key={openId} meetingId={openId} onBack={onBack} nav={nav} nameOf={nameOf} team={team} />;
  return <MeetingList onOpen={onOpen} />;
}

// a plain object, not a StyleSheet id, so the painted token is visible in the element's inline style (as ui/Row does)
const PRIMARY = { backgroundColor: "var(--ink)" };

const st = StyleSheet.create({
  main: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: "var(--win)" as string },
  head: { height: 48, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 18, paddingRight: 10, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  tt: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, flexShrink: 1 },
  h1: { margin: 0, fontSize: 14, fontWeight: "600", letterSpacing: -0.07, color: "var(--ink)" as string },
  shrink: { flexShrink: 1, minWidth: 0 },
  metaText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  grow: { flex: 1 },
  listBox: { flex: 1, paddingHorizontal: 6, paddingTop: 4 },
  tile: { width: 36, height: 36, borderRadius: 9, marginRight: 12, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  state: { fontSize: 12, color: "var(--ink-3)" as string },
  stateReady: { color: "var(--accent)" as string, fontWeight: "500" },
  stateQuiet: { color: "var(--ink-4)" as string },
  back: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center", marginLeft: -8 },
  backText: { fontSize: 20, lineHeight: 22, color: "var(--ink-2)" as string },
  scroll: { flex: 1 },
  scrollIn: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 40, maxWidth: 760 },
  when: { fontSize: 12.5, color: "var(--ink-3)" as string, marginBottom: 6 },
  block: { marginTop: 14, gap: 6 },
  sub: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string, textTransform: "uppercase", letterSpacing: 0.3 },
  para: { fontSize: 13.5, lineHeight: 20, color: "var(--ink)" as string },
  bullet: { flexDirection: "row", gap: 8 },
  bulletDot: { fontSize: 13.5, lineHeight: 20, color: "var(--ink-3)" as string },
  bulletText: { flex: 1, fontSize: 13.5, lineHeight: 20, color: "var(--ink)" as string },
  card: { borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, gap: 8, backgroundColor: "var(--win)" as string },
  cardDone: { backgroundColor: "var(--side)" as string },
  cardMain: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  mark: { width: 16, height: 16, borderRadius: 16, marginTop: 2, borderWidth: 1.5, borderColor: "var(--ink-4)" as string, alignItems: "center", justifyContent: "center" },
  markDone: { backgroundColor: "var(--accent)" as string, borderColor: "var(--accent)" as string },
  markFail: { borderColor: "var(--danger)" as string },
  itemBody: { flex: 1, minWidth: 0, gap: 4 },
  itemTitle: { fontSize: 13.5, lineHeight: 19, fontWeight: "500", color: "var(--ink)" as string },
  itemMeta: { fontSize: 12.5, color: "var(--ink-2)" as string },
  itemQuiet: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  pick: { flexDirection: "row", alignItems: "center", gap: 5, height: 26, paddingHorizontal: 6, marginLeft: -6, borderRadius: 6 },
  change: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 22 },
  changeField: { fontSize: 12.5, color: "var(--ink-3)" as string, minWidth: 76 },
  changeFrom: { fontSize: 12.5, color: "var(--ink-3)" as string, textDecorationLine: "line-through", flexShrink: 1 },
  arrow: { fontSize: 12.5, color: "var(--ink-4)" as string },
  changeTo: { fontSize: 12.5, fontWeight: "500", color: "var(--ink)" as string, flexShrink: 1 },
  note: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-2)" as string },
  mail: { fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string },
  actions: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", paddingLeft: 26 },
  done: { fontSize: 12.5, color: "var(--ink-3)" as string, marginRight: 6 },
  link: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string, paddingHorizontal: 4 },
  err: { fontSize: 12.5, color: "var(--danger)" as string, flexShrink: 1 },
  btn: { height: 28, paddingHorizontal: 11, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  btnOver: { backgroundColor: "var(--hover)" as string },
  btnText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink)" as string },
  btnTextPrimary: { color: "var(--win)" as string },
  input: { minHeight: 30, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7, borderWidth: 1, borderColor: "var(--field-line)" as string, backgroundColor: "var(--field)" as string, fontSize: 13, color: "var(--ink)" as string, outlineStyle: "none" as "none", flexGrow: 1, minWidth: 140 },
  inputMulti: { minHeight: 200, textAlignVertical: "top" as "top" },
  skRow: { flexDirection: "row", alignItems: "center", gap: 12, height: 62, paddingHorizontal: 18 },
  skTile: { width: 32, height: 32, borderRadius: 8, backgroundColor: "var(--hover)" as string },
  skLines: { flex: 1, gap: 6 },
  skBar: { height: 9, borderRadius: 5, backgroundColor: "var(--hover)" as string },
  skSmall: { height: 8, opacity: 0.7 },
});
