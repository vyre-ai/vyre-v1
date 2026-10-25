// Inbox > Calendar (spec 3.3, 2.18): Day, Week (the default) and Month over the calendars the sidebar shows. Drag on the grid to make an event in 15 minute steps; a small card takes the title, length,
// people and calendar; shaded stripes show when the people you add are busy; "Find a time" lists the next free slots. Drag an event to move it and its bottom edge to resize, both on 15 minute
// steps; right-click for Open, Join, Open Record, Open Conversation, Move to a calendar, Duplicate and Delete (Undo on the line that follows). Everything reads from the local copy.
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Recipients } from "../../../../../../ui/src/Recipients/index.tsx";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { useInboxData, useOnline, useOptionalInboxData, useScreenQuery } from "../sidebar/data.tsx";
import { useInboxState } from "../sidebar/state.tsx";
import { Face, pointOf } from "../sidebar/parts.tsx";
import { createEvent, deleteEvent, duplicateEvent, findTime, moveToCalendar, restoreEvent, setTimes } from "./actions.ts";
import { each } from "./each.ts";
import { Icon } from "./icons.tsx";
import { calendarMenuEntries, dayMenuEntries, eventMenuEntries, lengthMenuEntries, peopleMenuEntries } from "./menus.ts";
import {
  DAY, HH, allDayRows, availabilityLine, atSlot, blockOf, calReduce, clickCreate, clock, conflicts, dateOf, directoryOf, dragCreate, dragMove, dragResize, eventLine, eventsOn, freeLine, initialCal, isPast, lanesOf, lengthText, menuFacts,
  minutes, monthOf, nameMap, newDraft, offsetToY, range, setLength, slotText, startOfDay, stripesOf, viewDays, viewRange, viewTitle, visibleCalendarIds, weekdayShort, whoLabel,
} from "./model.ts";
import type { Busy, CalendarRow, Draft, EventRow, Mode, Slot, Span } from "./model.ts";

export const SCREEN = "calendar.view";
type EventsOut = { events: EventRow[] };
type CalendarsOut = { calendars: CalendarRow[] };
type BusyOut = { busy: Busy[]; unknown: string[] };

export interface Person { email: string; name: string }

export interface CalendarProps {
  /** The signed-in person's address (their own busy time counts against a new event). */
  me: string;
  /** People who can be added to an event and shaded as busy. */
  team: readonly Person[];
  onOpenEvent?(eventId: string): void;
  onOpenRecord?(recordId: string): void;
  onOpenConversation?(contactId: string): void;
  onJoin?(url: string): void;
  /** Where the view opens: a deep link, or a test. */
  initial?: { mode?: Mode; day?: number; people?: readonly string[]; draft?: Draft };
}

const GRID = HH * 24;
const FALLBACK = "#5B5BD6";
const colorOf = (cals: readonly CalendarRow[], id: string): string => cals.find((c) => c.id === id)?.color ?? FALLBACK;
const tint = (color: string, pct: number): string => `color-mix(in srgb, ${color} ${pct}%, var(--win))`;

/** Pointer position helpers for the web; a DOM event is not an RN event, so read what is there. */
interface PointerLike { clientX: number; clientY: number; button?: number; preventDefault?(): void; stopPropagation?(): void; currentTarget?: { getBoundingClientRect?: () => { left: number; top: number; width: number; height: number } } }

type Drag =
  | { kind: "create"; day: number; top: number; y0: number; y1: number }
  | { kind: "move" | "resize"; id: string; orig: Span; x0: number; y0: number; dy: number; dDays: number; moved: boolean };

function HeadIcon({ icon, label, testID, on = false, onPress }: { icon: Parameters<typeof Icon>[0]["name"]; label: string; testID: string; on?: boolean; onPress(x: number, y: number): void }): ReactElement {
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }} testID={testID} onPress={(e) => { const p = pointOf(e); onPress(p.x, p.y); }}
      style={({ hovered }: { hovered?: boolean }) => [s.hic, (hovered === true || on) && s.hicOver]}
    >
      <Icon name={icon} size={15} color={on ? "var(--accent)" : "var(--ink-2)"} />
    </Pressable>
  );
}

function FindTimeList({ slots, offsetMin, onPick, testID }: { slots: readonly Slot[]; offsetMin: number; onPick(s: Slot): void; testID: string }): ReactElement {
  return (
    <View style={s.slots} testID={testID} accessibilityLabel="Free times">
      {slots.length === 0 ? <Text style={s.slotNone}>No shared time in the next two weeks.</Text> : each(slots, (sl) => (
        <Pressable key={sl.startsAt} accessibilityRole="button" accessibilityLabel={slotText(sl, offsetMin)} testID={`slot:${sl.startsAt}`} onPress={() => onPick(sl)} style={({ hovered }: { hovered?: boolean }) => [s.slot, hovered === true && s.hicOver]}>
          <Icon name="cal" size={13} /><Text style={s.slotText}>{slotText(sl, offsetMin)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** The frame before data arrives: the header and an empty grid of the right height, so nothing moves when events land. */
export function CalendarLoading(): ReactElement {
  return (
    <View style={s.cal} testID="calendar-loading" accessibilityLabel="Loading">
      <View style={s.head}><View style={[s.skBar, { width: 160 }]} /></View>
      <View style={s.skGrid}>{each([0, 1, 2, 3, 4, 5], (i) => <View key={i} style={s.skLine} />)}</View>
    </View>
  );
}

function Grid({ p }: { p: CalendarProps }): ReactElement {
  const data = useInboxData();
  const { state: inbox } = useInboxState();
  const online = useOnline();
  const menu = useMenu();
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < 560;
  const clockNow = data.clock();
  const off = clockNow.offsetMin;
  const today = startOfDay(clockNow.now, off);
  const [cal, dispatch] = useReducer(calReduce, undefined, () => ({ ...initialCal(p.initial?.day ?? today, p.initial?.mode ?? (phone ? "day" : "week")), people: p.initial?.people ?? [], draft: p.initial?.draft ?? null }));
  const [drag, setDrag] = useState<Drag | null>(null);
  const [first, setFirst] = useState<Slot | undefined>(undefined);
  const [panel, setPanel] = useState<readonly Slot[] | null>(null);
  const [cardSlots, setCardSlots] = useState<readonly Slot[] | null>(null);
  const [undo, setUndo] = useState<{ id: string; title: string } | null>(null);
  const body = useRef<{ getBoundingClientRect?: () => { left: number; width: number } } | null>(null);
  const scroll = useRef<ScrollView | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  const mode: Mode = cal.mode;
  const days = viewDays(mode, cal.day, off);
  const range0 = viewRange(mode, cal.day, off);
  const cals = useScreenQuery<CalendarsOut>(SCREEN, "calendars");
  const calendars = cals.status === "ready" ? cals.data.calendars : [];
  const shown = visibleCalendarIds(calendars, inbox.hiddenCalendars);
  const evq = useScreenQuery<EventsOut>(SCREEN, "events", { from: range0.from, to: range0.to, ...(cals.status === "ready" ? { calendarIds: shown } : {}) });
  const events = evq.status === "ready" ? evq.data.events : [];
  const names = useMemo(() => nameMap(p.team), [p.team]);

  const shaded = cal.draft ? cal.draft.people.filter((x) => x !== p.me) : cal.people;
  const askPeople = [...new Set([...shaded, ...(cal.draft ? [p.me] : [])])];
  const bq = useScreenQuery<BusyOut>(SCREEN, "busy", { people: askPeople, from: range0.from, to: range0.to });
  const busy = bq.status === "ready" && askPeople.length > 0 ? bq.data.busy : [];
  const unknown = bq.status === "ready" ? bq.data.unknown : [];

  const length = cal.draft ? minutes(cal.draft) : 30;
  const draftEnd = cal.draft?.endsAt ?? 0;
  // the first free time while people are chosen (the line under the header)
  useEffect(() => {
    let live = true;
    if (shaded.length === 0) { setFirst(undefined); return; }
    void findTime(data, shaded, length, Math.max(clockNow.now, today), today + 14 * DAY, 1).then((r) => { if (live) setFirst(r[0]); }).catch(() => undefined);
    return () => { live = false; };
  }, [shaded.join(), length, draftEnd, today]);
  useEffect(() => { scroll.current?.scrollTo?.({ y: cal.mode === "month" ? 0 : 7.5 * HH, animated: false }); }, [cal.mode]);

  const calId = cal.draft?.calendarId ?? calendars.find((c) => !c.personal)?.id ?? calendars[0]?.id ?? "";
  const withDraft = (span: Span, title = ""): void => dispatch({ type: "draft", draft: newDraft(span, calId, cal.people, title) });
  const selectedEvent = events.find((e) => e.id === cal.selected);

  const fail = (): void => undefined;
  const add = (d: Draft): void => {
    void createEvent(data, d).then((e) => { dispatch({ type: "draft", draft: null }); dispatch({ type: "select", id: e.id }); setCardSlots(null); }).catch(fail);
  };
  const remove = (e: EventRow): void => { void deleteEvent(data, e.id).then(() => { setUndo({ id: e.id, title: e.title }); dispatch({ type: "select", id: null }); }).catch(fail); };
  const eventMenu = (e: EventRow, x: number, y: number): void => {
    dispatch({ type: "select", id: e.id });
    menu.show(eventMenuEntries(menuFacts(e, calendars), {
      open: () => p.onOpenEvent?.(e.id),
      join: () => { if (e.joinUrl) { if (p.onJoin) p.onJoin(e.joinUrl); else (globalThis as { open?: (u: string) => void }).open?.(e.joinUrl); } },
      openRecord: () => { const r = e.recordIds[0]; if (r) p.onOpenRecord?.(r); },
      openConversation: () => { const c = e.attendees.find((a) => a.contactId)?.contactId; if (c) p.onOpenConversation?.(c); },
      moveTo: (id) => void moveToCalendar(data, e.id, id).catch(fail),
      duplicate: () => void duplicateEvent(data, e).then((c) => dispatch({ type: "select", id: c.id })).catch(fail),
      remove: () => remove(e),
    }), x, y);
  };
  const openFind = (): void => {
    const pp = shaded.length ? shaded : [];
    void findTime(data, pp, length, Math.max(clockNow.now, today), today + 14 * DAY, 5).then((r) => setPanel(r)).catch(() => setPanel([]));
  };
  const openCardFind = (d: Draft): void => {
    void findTime(data, d.people.filter((x) => x !== p.me), minutes(d), Math.max(clockNow.now, today), today + 14 * DAY, 4).then(setCardSlots).catch(() => setCardSlots([]));
  };
  const pickSlot = (sl: Slot): void => {
    if (cal.draft) dispatch({ type: "draft", draft: atSlot(cal.draft, sl) });
    dispatch({ type: "go", day: startOfDay(sl.startsAt, off) });
    setPanel(null);
    setCardSlots(null);
  };

  // ---- pointer drags on the web: create on a column, move and resize an event
  const attach = (): void => {
    const g = globalThis as { addEventListener?: (t: string, f: (e: PointerLike) => void) => void; removeEventListener?: (t: string, f: (e: PointerLike) => void) => void };
    const move = (e: PointerLike): void => {
      const d = dragRef.current;
      if (!d) return;
      if (d.kind === "create") { setDrag({ ...d, y1: e.clientY - d.top }); return; }
      const rect = body.current?.getBoundingClientRect?.();
      const col = rect && days.length > 0 ? rect.width / days.length : 0;
      const dy = e.clientY - d.y0;
      setDrag({ ...d, dy, dDays: d.kind === "move" && col > 0 ? Math.round((e.clientX - d.x0) / col) : 0, moved: d.moved || Math.abs(dy) > 3 || Math.abs(e.clientX - d.x0) > 3 });
    };
    const up = (): void => {
      g.removeEventListener?.("pointermove", move);
      g.removeEventListener?.("pointerup", up as never);
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      if (d.kind === "create") {
        if (Math.abs(d.y1 - d.y0) > 4) dispatch({ type: "draft", draft: newDraft(dragCreate(d.day, d.y0, d.y1), calId, cal.people) });
        return;
      }
      if (!d.moved) { dispatch({ type: "select", id: d.id }); return; }
      const next = d.kind === "move" ? dragMove(d.orig, d.dy, d.dDays, off) : dragResize(d.orig, d.dy, off);
      if (next.startsAt !== d.orig.startsAt || next.endsAt !== d.orig.endsAt) void setTimes(data, d.id, next).catch(fail);
    };
    g.addEventListener?.("pointermove", move);
    g.addEventListener?.("pointerup", up as never);
  };
  const startCreate = (day: number) => (e: PointerLike): void => {
    if (e.button !== undefined && e.button !== 0) return;
    const rect = e.currentTarget?.getBoundingClientRect?.();
    if (!rect) return;
    setDrag({ kind: "create", day, top: rect.top, y0: e.clientY - rect.top, y1: e.clientY - rect.top });
    attach();
  };
  const startEvent = (ev: EventRow, kind: "move" | "resize") => (e: PointerLike): void => {
    if (e.button !== undefined && e.button !== 0) return;
    e.stopPropagation?.();
    setDrag({ kind, id: ev.id, orig: { startsAt: ev.startsAt, endsAt: ev.endsAt }, x0: e.clientX, y0: e.clientY, dy: 0, dDays: 0, moved: false });
    attach();
  };

  // ---- keys
  const onKeyDown = (k: { key?: string; target?: { tagName?: string }; preventDefault?(): void }): void => {
    const tag = k.target?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea") { if (k.key === "Escape") dispatch({ type: "draft", draft: null }); return; }
    if (k.key === "ArrowLeft") { k.preventDefault?.(); dispatch({ type: "step", dir: -1, offsetMin: off }); }
    else if (k.key === "ArrowRight") { k.preventDefault?.(); dispatch({ type: "step", dir: 1, offsetMin: off }); }
    else if (k.key === "t") dispatch({ type: "today", today });
    else if (k.key === "n") withDraft(clickCreate(cal.day === today ? Math.max(today, startOfDay(clockNow.now, off)) : cal.day, 9 * HH));
    else if (k.key === "Escape") dispatch({ type: "draft", draft: null });
    else if ((k.key === "Delete" || k.key === "Backspace") && selectedEvent) { k.preventDefault?.(); remove(selectedEvent); }
  };

  const draft = cal.draft;
  const preview = (e: EventRow): Span => {
    if (drag && drag.kind !== "create" && drag.id === e.id && drag.moved) return drag.kind === "move" ? dragMove(drag.orig, drag.dy, drag.dDays, off) : dragResize(drag.orig, drag.dy, off);
    return e;
  };
  const dayStripes = (day: number) => (shaded.length > 0 ? stripesOf(busy, shaded, day) : []);
  const line = shaded.length > 0 ? availabilityLine(shaded, names, first, length, off) : null;

  const renderEvent = (e: EventRow, day: number, laid: ReturnType<typeof lanesOf>[number]): ReactElement => {
    const span = preview(e);
    const l = { ...laid, e: { ...e, ...span } };
    const b = blockOf(l, day);
    const col = colorOf(calendars, e.calendarId);
    return (
      <View key={e.id} {...menuTrigger((x, y) => eventMenu(e, x, y))} style={[s.cev, { top: b.top, height: b.height, left: b.left as unknown as number, width: b.width as unknown as number, backgroundColor: tint(col, isPast(e, clockNow.now) ? 9 : 15), borderLeftColor: col }, cal.selected === e.id && s.cevSel]} testID={`event:${e.id}`}>
        <Pressable
          accessibilityRole="button" accessibilityLabel={`${e.title}, ${eventLine(e, off)}`} accessibilityState={{ selected: cal.selected === e.id }} testID={`event-body:${e.id}`}
          onPress={() => dispatch({ type: "select", id: e.id })} {...({ onPointerDown: startEvent(e, "move"), onDoubleClick: () => p.onOpenEvent?.(e.id) } as object)} style={s.cevIn}
        >
          <Text numberOfLines={1} style={[s.cevTitle, isPast(e, clockNow.now) && s.cevPast]}>{e.title}</Text>
          {b.one ? null : <Text numberOfLines={1} style={s.cevSmall}>{range(span.startsAt, span.endsAt, off)}</Text>}
        </Pressable>
        <View testID={`resize:${e.id}`} {...({ onPointerDown: startEvent(e, "resize") } as object)} style={s.grip} />
        {e.bookedByAgentId && b.height >= 24 ? <View style={s.af}><Face name={e.bookedByAgentId.replace(/^agt_/, "")} size={14} round={false} /></View> : null}
      </View>
    );
  };

  const header = (
    <View style={s.head} testID="calendar-head">
      <Text accessibilityRole="header" aria-level={1} style={s.h1} numberOfLines={1} testID="calendar-title">{viewTitle(mode, cal.day, off)}</Text>
      <View style={s.nv}>
        <HeadIcon icon="chevl" label="Previous" testID="cal-prev" onPress={() => dispatch({ type: "step", dir: -1, offsetMin: off })} />
        <Pressable accessibilityRole="button" accessibilityLabel="Go to today" testID="cal-today" onPress={() => dispatch({ type: "today", today })} style={({ hovered }: { hovered?: boolean }) => [s.todayBtn, hovered === true && s.hicOver]}><Text style={s.todayText}>Today</Text></Pressable>
        <HeadIcon icon="chevr" label="Next" testID="cal-next" onPress={() => dispatch({ type: "step", dir: 1, offsetMin: off })} />
      </View>
      <View style={s.grow} />
      <View style={s.seg} accessibilityRole="tablist">
        {each(["day", "week", "month"] as const, (m) => (
          <Pressable key={m} accessibilityRole="tab" accessibilityLabel={m === "day" ? "Day" : m === "week" ? "Week" : "Month"} accessibilityState={{ selected: mode === m }} aria-selected={mode === m} testID={`cal-mode-${m}`} onPress={() => dispatch({ type: "mode", mode: m })} style={({ hovered }: { hovered?: boolean }) => [s.segBtn, mode === m && s.segOn, hovered === true && mode !== m && s.hicOver]}>
            <Text style={[s.segText, mode === m && s.segTextOn]}>{m === "day" ? "Day" : m === "week" ? "Week" : "Month"}</Text>
          </Pressable>
        ))}
      </View>
      <HeadIcon icon="users" label="Show when people are free" testID="cal-avail" on={shaded.length > 0} onPress={(x, y) => menu.show(peopleMenuEntries(p.team, cal.people, p.me, { toggle: (email) => dispatch({ type: "people", email }), clear: () => dispatch({ type: "clearPeople" }) }), x, y)} />
      <HeadIcon icon="plus" label="New event" testID="cal-new" onPress={() => withDraft(clickCreate(cal.day, 9 * HH))} />
    </View>
  );

  const availBar = line ? (
    <View style={s.avail} testID="cal-avail-bar">
      <View style={s.faces}>{each(shaded, (e, i) => <View key={e} style={i > 0 ? s.faceOver : undefined}><Face name={names.get(e) ?? e} size={18} /></View>)}</View>
      <Text style={s.availText} numberOfLines={1}><Text style={s.availBold}>{line.who.replace(" busy times shaded", "")}</Text> busy times shaded</Text>
      <Text style={s.sep}>{"·"}</Text>
      <Text style={s.free} numberOfLines={1} testID="cal-free">{line.free}</Text>
      <View style={s.grow} />
      <Pressable accessibilityRole="button" accessibilityLabel="Find a time" testID="cal-find" onPress={openFind} style={({ hovered }: { hovered?: boolean }) => [s.lnk, hovered === true && s.lnkOver]}><Text style={s.lnkText}>Find a time</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Clear" testID="cal-clear" onPress={() => { dispatch({ type: "clearPeople" }); setPanel(null); }} style={({ hovered }: { hovered?: boolean }) => [s.lnk, hovered === true && s.lnkOver]}><Text style={s.lnkText}>Clear</Text></Pressable>
    </View>
  ) : null;

  const tl = draft && draft.people.length >= 0 ? conflicts(draft, busy, p.me) : { busy: [], mine: false };

  const card = draft ? (
    <View style={[s.pop, phone && s.popPhone]} accessibilityRole="none" accessibilityLabel="New event" testID="cal-card">
      <TextInput
        accessibilityLabel="Title" placeholder="New event" placeholderTextColor="var(--ink-4)" value={draft.title} onChangeText={(t) => dispatch({ type: "draft", draft: { ...draft, title: t } })} testID="cal-card-title" autoFocus
        onSubmitEditing={() => add(draft)} style={s.popTitle}
      />
      <View style={s.pr}><Icon name="cal" size={14} /><Text style={s.prText} testID="cal-card-when">{`${slotText({ startsAt: draft.startsAt, endsAt: draft.endsAt }, off)}`}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Length" testID="cal-card-length" onPress={(e) => { const q = pointOf(e); menu.show(lengthMenuEntries(minutes(draft), (m) => dispatch({ type: "draft", draft: setLength(draft, m) })), q.x, q.y); }} style={({ hovered }: { hovered?: boolean }) => [s.pk, hovered === true && s.hicOver]}>
          <Text style={s.pkText}>{lengthText(minutes(draft))}</Text><Icon name="chevd" size={9} />
        </Pressable>
      </View>
      <View style={s.prp}><Icon name="users" size={14} /><View style={s.prpBox} testID="cal-card-people">
        <Recipients to={draft.people} me={p.me} directory={directoryOf(p.team)} onChange={(r) => dispatch({ type: "draft", draft: { ...draft, people: r.to } })} testID="cal-card-people" />
      </View></View>
      <Text style={s.pav} testID="cal-card-free">{freeLine(draft, tl, names, unknown, p.me)}</Text>
      <View style={s.pr}><View style={[s.cdot, { backgroundColor: colorOf(calendars, draft.calendarId) }]} />
        <Pressable accessibilityRole="button" accessibilityLabel="Calendar" testID="cal-card-calendar" onPress={(e) => { const q = pointOf(e); menu.show(calendarMenuEntries(calendars, draft.calendarId, (id) => dispatch({ type: "draft", draft: { ...draft, calendarId: id } })), q.x, q.y); }} style={({ hovered }: { hovered?: boolean }) => [s.pk, hovered === true && s.hicOver]}>
          <Text style={s.pkText}>{calendars.find((c) => c.id === draft.calendarId)?.title ?? "Calendar"}</Text><Icon name="chevd" size={9} />
        </Pressable>
      </View>
      {cardSlots ? <FindTimeList slots={cardSlots} offsetMin={off} onPick={pickSlot} testID="cal-card-slots" /> : null}
      <View style={s.pf}>
        <Pressable accessibilityRole="button" accessibilityLabel="Find a time" testID="cal-card-find" onPress={() => openCardFind(draft)} style={({ hovered }: { hovered?: boolean }) => [s.btn, hovered === true && s.btnOver]}><Icon name="spark" size={14} color="var(--ink)" /><Text style={s.btnText}>Find a time</Text></Pressable>
        <View style={s.grow} />
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel" testID="cal-card-cancel" onPress={() => { dispatch({ type: "draft", draft: null }); setCardSlots(null); }} style={({ hovered }: { hovered?: boolean }) => [s.btn, hovered === true && s.btnOver]}><Text style={s.btnText}>Cancel</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Add" testID="cal-card-add" onPress={() => add(draft)} style={({ hovered }: { hovered?: boolean }) => [s.btn, s.btnP, hovered === true && s.btnPOver]}><Text style={s.btnPText}>Add</Text></Pressable>
      </View>
    </View>
  ) : null;

  // ---- Month
  const monthBody = (
    <View style={s.cmon} testID="cal-month">
      <View style={s.mwk}>{each(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], (w) => <Text key={w} style={s.mwkText}>{w}</Text>)}</View>
      <View style={s.mgrid}>
        {each(days, (d) => {
          const es = [...eventsOn(events, d, true), ...eventsOn(events, d, false)];
          const cap = days.length > 35 ? 3 : 4;
          const show = es.slice(0, es.length > cap ? cap - 1 : cap);
          const out = monthOf(d, off) !== monthOf(cal.day, off);
          return (
            <Pressable
              key={d} accessibilityRole="button" accessibilityLabel={`${weekdayShort(d, off)} ${dateOf(d, off)}`} testID={`cell:${d}`}
              {...menuTrigger((x, y) => menu.show(dayMenuEntries({ newHere: () => withDraft(clickCreate(d, 9 * HH)), goDay: () => { dispatch({ type: "mode", mode: "day" }); dispatch({ type: "go", day: d }); } }), x, y))}
              {...({ onDoubleClick: () => withDraft(clickCreate(d, 9 * HH)) } as object)}
              onPress={() => dispatch({ type: "go", day: d })} style={({ hovered }: { hovered?: boolean }) => [s.mc, hovered === true && s.hicOver]}
            >
              <View style={[s.mn, d === today && s.mnToday]}><Text style={[s.mnText, out && s.mnOut, d === today && s.mnTodayText]}>{dateOf(d, off)}</Text></View>
              {each(show, (e) => (
                <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={e.title} testID={`mev:${e.id}`} onPress={() => dispatch({ type: "select", id: e.id })} {...menuTrigger((x, y) => eventMenu(e, x, y))} style={({ hovered }: { hovered?: boolean }) => [s.mev, (hovered === true || cal.selected === e.id) && s.mevOver]}>
                  <View style={[s.cdotS, { backgroundColor: colorOf(calendars, e.calendarId) }]} />
                  {e.allDay ? null : <Text style={s.mevTime}>{clock(e.startsAt, off).replace(":00", "").replace(" ", "").toLowerCase()}</Text>}
                  <Text numberOfLines={1} style={[s.mevText, isPast(e, clockNow.now) && s.cevPast]}>{e.title}</Text>
                </Pressable>
              ))}
              {es.length > cap ? <Text style={s.mmore} testID={`more:${d}`}>{es.length - cap + 1} more</Text> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  // ---- Day and Week
  const allDays = allDayRows(events, days);
  const timeBody = (
    <View style={s.timeWrap}>
      <View style={s.chd}>
        <View style={s.gutter} />
        {each(days, (d, i) => (
          <View key={d} style={s.dh} testID={`dayhead:${d}`}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${weekdayShort(d, off)} ${dateOf(d, off)}`} onPress={() => { dispatch({ type: "mode", mode: "day" }); dispatch({ type: "go", day: d }); }} style={s.dhIn}>
              <Text style={[s.dhWk, d === today && s.dhToday]}>{weekdayShort(d, off)}</Text>
              <View style={[s.dhNum, d === today && s.dhNumToday]}><Text style={[s.dhNumText, d === today && s.dhNumTodayText]}>{dateOf(d, off)}</Text></View>
            </Pressable>
            {each(allDays[i] ?? [], (e) => <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={e.title} testID={`allday:${e.id}`} onPress={() => dispatch({ type: "select", id: e.id })} {...menuTrigger((x, y) => eventMenu(e, x, y))} style={[s.cevAll, { backgroundColor: tint(colorOf(calendars, e.calendarId), 15), borderLeftColor: colorOf(calendars, e.calendarId) }]}><Text numberOfLines={1} style={s.cevTitle}>{e.title}</Text></Pressable>)}
          </View>
        ))}
      </View>
      <ScrollView ref={scroll} style={s.scroll} testID="cal-scroll">
      <View style={s.cbody} ref={body as never}>
        <View style={s.hours}>{Array.from({ length: 23 }, (_, i) => <Text key={i} style={[s.hour, { top: (i + 1) * HH }]}>{`${(i + 1) % 12 || 12} ${i + 1 < 12 ? "AM" : "PM"}`}</Text>)}</View>
        {each(days, (d) => {
          const laid = lanesOf(eventsOn(events, d, false));
          const ghost = drag?.kind === "create" && drag.day === d ? dragCreate(d, drag.y0, drag.y1) : draft && startOfDay(draft.startsAt, off) === d ? draft : null;
          return (
            <View key={d} style={[s.ccol, d === today && s.ccolToday]} testID={`col:${d}`} {...({ onPointerDown: startCreate(d), onDoubleClick: (e: PointerLike) => { const r = e.currentTarget?.getBoundingClientRect?.(); if (r) withDraft(clickCreate(d, e.clientY - r.top)); } } as object)}
              {...menuTrigger((x, y) => menu.show(dayMenuEntries({ newHere: () => withDraft(clickCreate(d, 9 * HH)), goDay: () => { dispatch({ type: "mode", mode: "day" }); dispatch({ type: "go", day: d }); } }), x, y))}>
              {each(dayStripes(d), (st) => (
                <View key={st.top} testID={`stripe:${d}:${st.top}`} accessibilityLabel={`${whoLabel(st.who, names)} busy`} pointerEvents="none" style={[s.busy, { top: st.top, height: st.height, backgroundColor: `color-mix(in srgb, var(--ink) ${st.alpha}%, transparent)` }]} />
              ))}
              {each(laid, (l) => renderEvent(l.e, d, l))}
              {d === today ? <View pointerEvents="none" style={[s.now, { top: offsetToY(clockNow.now - d) }]} testID="cal-now" /> : null}
              {ghost ? <View pointerEvents="none" testID="cal-ghost" style={[s.ghost, { top: offsetToY(ghost.startsAt - d), height: Math.max(20, offsetToY(ghost.endsAt - ghost.startsAt) - 1) }]}><Text numberOfLines={1} style={s.ghostText}>{draft && "title" in ghost && ghost.title ? ghost.title : "New event"}</Text></View> : null}
            </View>
          );
        })}
      </View>
      </ScrollView>
    </View>
  );

  return (
    <View style={s.cal} testID="calendar" accessibilityLabel={`Calendar, ${mode}`} {...({ onKeyDown } as object)}>
      {header}
      {online ? null : <Text style={s.offline} accessibilityRole="alert" testID="cal-offline">Offline, showing your saved copy</Text>}
      {availBar}
      {panel ? <View style={s.panel}><Text style={s.panelHead}>Everyone is free</Text><FindTimeList slots={panel} offsetMin={off} onPick={pickSlot} testID="cal-slots" /></View> : null}
      {undo ? (
        <View style={s.undo} testID="cal-undo"><Text style={s.undoText}>{`Deleted “${undo.title}”`}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Undo" testID="cal-undo-btn" onPress={() => { void restoreEvent(data, undo.id).then(() => { dispatch({ type: "select", id: undo.id }); setUndo(null); }).catch(fail); }} style={({ hovered }: { hovered?: boolean }) => [s.lnk, hovered === true && s.lnkOver]}><Text style={s.lnkText}>Undo</Text></Pressable>
        </View>
      ) : null}
      {mode === "month" ? monthBody : timeBody}
      {card}
      {menu.element}
    </View>
  );
}

export function Calendar(props: CalendarProps): ReactElement {
  const data = useOptionalInboxData();
  if (!data) return <CalendarLoading />;
  return <Grid p={props} />;
}

const ink = (v: string): string => `var(${v})`;
const s = StyleSheet.create({
  cal: { flex: 1, minHeight: 0, minWidth: 0, backgroundColor: ink("--win") },
  head: { height: 48, flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 18, paddingRight: 10, borderBottomWidth: 1, borderBottomColor: ink("--line") },
  h1: { fontSize: 14, fontWeight: "600", letterSpacing: -0.07, color: ink("--ink"), flexShrink: 1, fontVariant: ["tabular-nums"] },
  nv: { flexDirection: "row", alignItems: "center", gap: 2, marginLeft: 4 },
  grow: { flex: 1 },
  hic: { height: 28, minWidth: 28, paddingHorizontal: 6, borderRadius: 7, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  hicOver: { backgroundColor: ink("--hover") },
  todayBtn: { height: 28, paddingHorizontal: 8, borderRadius: 6, justifyContent: "center" },
  todayText: { fontSize: 12.5, fontWeight: "500", color: ink("--ink-2") },
  seg: { flexDirection: "row", padding: 2, borderRadius: 8, backgroundColor: ink("--hover"), marginHorizontal: 4 },
  segBtn: { height: 24, paddingHorizontal: 10, borderRadius: 6, justifyContent: "center" },
  segOn: { backgroundColor: ink("--win") },
  segText: { fontSize: 12.5, fontWeight: "500", color: ink("--ink-3") },
  segTextOn: { color: ink("--ink") },
  offline: { fontSize: 12.5, color: ink("--ink-3"), paddingHorizontal: 18, paddingVertical: 6 },
  avail: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32, paddingVertical: 4, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: ink("--line"), backgroundColor: ink("--side") },
  faces: { flexDirection: "row" },
  faceOver: { marginLeft: -5 },
  availText: { fontSize: 12.5, color: ink("--ink-3"), flexShrink: 1 },
  availBold: { fontWeight: "600", color: ink("--ink") },
  sep: { fontSize: 12.5, color: ink("--ink-4") },
  free: { fontSize: 12.5, color: ink("--ink-2"), flexShrink: 1 },
  lnk: { paddingVertical: 2, paddingHorizontal: 4, borderRadius: 5 },
  lnkOver: { backgroundColor: ink("--accent-wash") },
  lnkText: { fontSize: 12.5, fontWeight: "500", color: ink("--accent") },
  panel: { paddingVertical: 8, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: ink("--line"), backgroundColor: ink("--side") },
  panelHead: { fontSize: 11.5, fontWeight: "600", color: ink("--ink-3"), marginBottom: 4 },
  slots: { gap: 2 },
  slot: { flexDirection: "row", alignItems: "center", gap: 8, height: 28, paddingHorizontal: 6, borderRadius: 6 },
  slotText: { fontSize: 12.5, color: ink("--ink") },
  slotNone: { fontSize: 12.5, color: ink("--ink-3"), paddingVertical: 4 },
  undo: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: ink("--line") },
  undoText: { fontSize: 12.5, color: ink("--ink-2") },
  timeWrap: { flex: 1, minHeight: 0 },
  scroll: { flex: 1, minHeight: 0 },
  chd: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: ink("--line"), backgroundColor: ink("--win") },
  gutter: { width: 52 },
  dh: { flex: 1, minWidth: 0, borderLeftWidth: 1, borderLeftColor: ink("--line"), paddingBottom: 4 },
  dhIn: { flexDirection: "row", alignItems: "center", gap: 7, paddingTop: 9, paddingHorizontal: 10, paddingBottom: 7 },
  dhWk: { fontSize: 12, color: ink("--ink-3") },
  dhToday: { color: ink("--accent") },
  dhNum: { minWidth: 26, height: 26, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  dhNumToday: { backgroundColor: ink("--accent") },
  dhNumText: { fontSize: 15, fontWeight: "500", color: ink("--ink"), fontVariant: ["tabular-nums"] },
  dhNumTodayText: { color: ink("--accent-ink"), fontWeight: "600" },
  cevAll: { height: 20, marginHorizontal: 3, marginBottom: 2, borderRadius: 5, borderLeftWidth: 3, paddingHorizontal: 6, justifyContent: "center" },
  cbody: { flexDirection: "row", height: GRID },
  hours: { width: 52, height: GRID },
  hour: { position: "absolute", right: 8, fontSize: 10.5, color: ink("--ink-3"), fontVariant: ["tabular-nums"], transform: [{ translateY: -7 }] },
  ccol: { flex: 1, minWidth: 0, height: GRID, borderLeftWidth: 1, borderLeftColor: ink("--line"), backgroundImage: "repeating-linear-gradient(to bottom, transparent 0, transparent 51px, var(--line) 51px, var(--line) 52px)" as unknown as undefined },
  ccolToday: { backgroundColor: "color-mix(in srgb, var(--accent) 3.5%, transparent)" as unknown as string },
  cev: { position: "absolute", borderRadius: 5, overflow: "hidden", borderLeftWidth: 3, zIndex: 2 },
  cevSel: { zIndex: 4, boxShadow: "0 0 0 2px var(--accent)" as unknown as undefined },
  cevIn: { flex: 1, paddingTop: 3, paddingBottom: 2, paddingLeft: 5, paddingRight: 6 },
  cevTitle: { fontSize: 11.5, lineHeight: 14, fontWeight: "600", color: ink("--ink") },
  cevPast: { color: ink("--ink-2") },
  cevSmall: { fontSize: 11, lineHeight: 14, color: ink("--ink-2") },
  grip: { position: "absolute", left: 0, right: 0, bottom: 0, height: 6, cursor: "ns-resize" as unknown as undefined },
  af: { position: "absolute", top: 3, right: 4 },
  busy: { position: "absolute", left: 0, right: 0, zIndex: 1, backgroundImage: "repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--ink) 5%, transparent) 5px 6px)" as unknown as undefined },
  now: { position: "absolute", left: 0, right: 0, borderTopWidth: 1.5, borderTopColor: ink("--danger"), zIndex: 3 },
  ghost: { position: "absolute", left: 2, right: 2, borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: ink("--accent-wash"), borderLeftWidth: 3, borderLeftColor: ink("--accent"), zIndex: 5, overflow: "hidden" },
  ghostText: { fontSize: 11.5, fontWeight: "600", color: ink("--accent") },
  cmon: { flex: 1, minHeight: 0 },
  mwk: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: ink("--line") },
  mwkText: { flex: 1, paddingTop: 8, paddingBottom: 6, paddingHorizontal: 10, fontSize: 11.5, fontWeight: "500", color: ink("--ink-3") },
  mgrid: { flex: 1, minHeight: 0, flexDirection: "row", flexWrap: "wrap" },
  mc: { width: "14.2857%" as unknown as number, minHeight: 92, flexGrow: 1, borderRightWidth: 1, borderBottomWidth: 1, borderRightColor: ink("--line"), borderBottomColor: ink("--line"), paddingVertical: 4, paddingHorizontal: 5, overflow: "hidden", gap: 1 },
  mn: { alignSelf: "flex-start", height: 20, minWidth: 20, paddingHorizontal: 5, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 1 },
  mnToday: { backgroundColor: ink("--accent") },
  mnText: { fontSize: 12, color: ink("--ink-2"), fontVariant: ["tabular-nums"] },
  mnOut: { color: ink("--ink-4") },
  mnTodayText: { color: ink("--accent-ink"), fontWeight: "600" },
  mev: { flexDirection: "row", alignItems: "center", gap: 6, height: 19, paddingHorizontal: 4, borderRadius: 4 },
  mevOver: { backgroundColor: ink("--press") },
  mevTime: { fontSize: 11, color: ink("--ink-3") },
  mevText: { fontSize: 11.5, color: ink("--ink"), flexShrink: 1 },
  mmore: { fontSize: 11.5, color: ink("--ink-3"), paddingHorizontal: 4 },
  cdot: { width: 9, height: 9, borderRadius: 9, marginHorizontal: 3 },
  cdotS: { width: 6, height: 6, borderRadius: 6 },
  pop: { position: "absolute", top: 70, right: 24, width: 330, zIndex: 30, borderRadius: 12, backgroundColor: ink("--raised"), paddingTop: 14, paddingHorizontal: 14, paddingBottom: 12, gap: 6, boxShadow: "var(--sh-pop)" as unknown as undefined },
  popPhone: { left: 12, right: 12, width: "auto" as unknown as number, bottom: 12, top: "auto" as unknown as number },
  popTitle: { height: 34, fontSize: 16, fontWeight: "600", color: ink("--ink"), borderBottomWidth: 1, borderBottomColor: ink("--line"), marginBottom: 4, paddingHorizontal: 2, backgroundColor: "transparent", borderWidth: 0 },
  pr: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 30 },
  prText: { fontSize: 12.5, color: ink("--ink-2"), flexShrink: 1 },
  pk: { flexDirection: "row", alignItems: "center", gap: 6, height: 24, paddingHorizontal: 6, borderRadius: 6 },
  pkText: { fontSize: 12.5, color: ink("--ink") },
  prp: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingTop: 6 },
  prpBox: { flex: 1, minWidth: 0 },
  pav: { fontSize: 12, lineHeight: 17, color: ink("--ink-3"), paddingLeft: 24 },
  pf: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  btn: { height: 30, paddingHorizontal: 12, borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: ink("--hover") },
  btnOver: { backgroundColor: ink("--press") },
  btnP: { backgroundColor: ink("--accent") },
  btnPOver: { opacity: 0.92 },
  btnText: { fontSize: 12.5, fontWeight: "600", color: ink("--ink") },
  btnPText: { fontSize: 12.5, fontWeight: "600", color: ink("--accent-ink") },
  skBar: { height: 9, borderRadius: 5, backgroundColor: ink("--hover") },
  skGrid: { flex: 1, paddingTop: 12 },
  skLine: { height: 52, borderBottomWidth: 1, borderBottomColor: ink("--line") },
});
