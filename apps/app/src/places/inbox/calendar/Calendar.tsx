// Inbox > Calendar (spec 3.3, 2.18): Day, Week (the default) and Month over the calendars the sidebar shows. Drag on the grid to make an event in 15 minute steps; a small card takes the title, length,
// people and calendar; shaded stripes show when the people you add are busy; "Find a time" lists the next free slots. Drag an event to move it and its bottom edge to resize, both on 15 minute
// steps; right-click for Open, Edit, Join, Going?, Prepare, Ask, Copy Link, Open Record, Open Conversation, Move to a calendar, Duplicate and Delete (Undo on the line that follows). A click on an event
// opens it in the event pane beside the calendar (a sheet on a phone), Enter too, and Escape closes it; a double-click edits it; a click on an empty slot starts a new event there.
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Recipients } from "../../../../../../ui/src/Recipients/index.tsx";
import { ResizableColumn } from "../../../../../../ui/src/SidePane/resize.tsx";
import { Sheet } from "../../../mobile/sheets/Sheet.tsx";
import { EventPane } from "./eventpane/EventPane.tsx";
import { eventLink } from "./eventpane/model.ts";
import { BrandMark } from "./eventpane/BrandMark.tsx";
import { PROVIDER_NAME, telUrl, videoDefault, videoOptions } from "./eventpane/join.ts";
import { usePhone } from "../softphone/phone.tsx";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { useInboxData, useOnline, useOptionalInboxData, useScreenQuery } from "../sidebar/data.tsx";
import { useInboxState } from "../sidebar/state.tsx";
import { Face, pointOf } from "../sidebar/parts.tsx";
import { createEvent, deleteEvent, duplicateEvent, findTime, moveToCalendar, restoreEvent, setTimes } from "./actions.ts";
import { each } from "./each.ts";
import { Icon } from "./icons.tsx";
import { calendarMenuEntries, dayMenuEntries, eventMenuEntries, lengthMenuEntries, peopleMenuEntries } from "./menus.ts";
import {
  DAY, HH, HOUR, MONTH_CAP, allDayLane, allDayLocal, openHour, allDayToWire, availabilityLine, atSlot, blockOf, calReduce, clickCreate, clock, conflicts, dateOf, dayText, directoryOf, dragCreate, dragMove, dragResize, eventLine, eventsOn, freeLine, initialCal, isBand, isPast, lanesOf, monthCell, lengthText, menuFacts,
  minutes, monthOf, nameMap, newDraft, offsetToY, range, rangeShort, setLength, slotText, startOfDay, stripesOf, viewDays, viewRange, viewTitle, visibleCalendarIds, weekdayShort, whoLabel,
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
  /** the event pane closed (the shell clears the event from the address) */
  onCloseEvent?(): void;
  onOpenRecord?(recordId: string): void;
  onOpenConversation?(contactId: string): void;
  onJoin?(url: string): void;
  /** Ask About This: the Ask pane about the event */
  onAsk?(e: { id: string; title: string }): void;
  /** Open close-out: the meeting in the Inbox's Meetings tab */
  onOpenMeeting?(meetingId: string): void;
  onOpenFile?(fileId: string): void;
  onOpenUrl?(url: string): void;
  /** Call a number: through Vyre's telephony when a number is connected; absent, the phone's own dialer (tel:) */
  onCall?(number: string, pin?: string): void;
  /** Where the view opens: a deep link, or a test. `openId` opens that event in the pane. */
  initial?: { mode?: Mode; day?: number; people?: readonly string[]; draft?: Draft; openId?: string; edit?: boolean };
}

const GRID = HH * 24;
const QUARTER = HH / 4;
// the hour grid with a faint line every 15 minutes (the hour line on top)
const GRIDBG = `repeating-linear-gradient(to bottom, transparent 0, transparent ${HH - 1}px, var(--line) ${HH - 1}px, var(--line) ${HH}px), repeating-linear-gradient(to bottom, transparent 0, transparent ${QUARTER - 1}px, color-mix(in srgb, var(--line) 42%, transparent) ${QUARTER - 1}px, color-mix(in srgb, var(--line) 42%, transparent) ${QUARTER}px)`;
const SOLID = (c: string): string => `linear-gradient(${c}, ${c})`;
const isWeekend = (day: number, offsetMin: number): boolean => { const w = new Date(day + offsetMin * 60_000).getUTCDay(); return w === 0 || w === 6; };
const AD_ROW = 21;
const FALLBACK = "#5B5BD6";
const colorOf = (cals: readonly CalendarRow[], id: string): string => cals.find((c) => c.id === id)?.color ?? FALLBACK;
// react-native-web drops a color-mix() backgroundColor, so a fill is a one-colour gradient in backgroundImage (as the busy stripes are): the grid shows through in both skins
const tint = (color: string, pct: number): string => { const c = `color-mix(in srgb, ${color} ${pct}%, transparent)`; return `linear-gradient(${c}, ${c})`; };

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
  const [undo, setUndo] = useState<{ label: string; run?: () => Promise<unknown> } | null>(null);
  // the event open in the pane, and whether it opened in edit (a double-click)
  const [open, setOpen] = useState<{ id: string; edit: boolean } | null>(p.initial?.openId ? { id: p.initial.openId, edit: p.initial.edit === true } : null);
  const openEvent = (id: string, edit = false): void => { dispatch({ type: "select", id }); setOpen({ id, edit }); p.onOpenEvent?.(id); };
  const closeEvent = (): void => { setOpen(null); p.onCloseEvent?.(); };
  // Vyre's own phone, when a number is connected: a phone meeting is called through it
  const phoneDock = usePhone();
  // Zoom connected? (the new-event card and Add a video call offer it then)
  const [zoomOn, setZoomOn] = useState(false);
  useEffect(() => {
    let live = true;
    void Promise.resolve(data.call("connections.list", {})).then((o) => { if (live) setZoomOn(((o as { connections?: Array<{ connector: string; state: string }> }).connections ?? []).some((c) => /zoom/.test(c.connector) && c.state === "active")); }, () => undefined);
    return () => { live = false; };
  }, [data]);
  // the person's usual video call, remembered on this device when they pick one
  const VIDEO_KEY = "vyre.calendar.video";
  const store = (globalThis as { localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void } }).localStorage;
  const videosFor = (calendarId: string): Array<"meet" | "teams" | "zoom"> => videoOptions(calendars.find((c) => c.id === calendarId)?.provider, zoomOn);
  const videoOf = (d: Draft): "meet" | "teams" | "zoom" | "none" => d.video ?? videoDefault(videosFor(d.calendarId), (() => { try { return store?.getItem(VIDEO_KEY) ?? null; } catch { return null; } })());
  // a second press on the same event soon after the first edits it: react-native-web's Pressable drops onDoubleClick, and a re-render between the clicks would break a native one.
  // The gap is read from each click's own time, not from when its handler ran: a slow draw of the first click's pane must not split a person's double-click in two.
  const lastPress = useRef<{ id: string; at: number }>({ id: "", at: 0 });
  const pressEvent = (id: string, ev?: unknown): void => {
    const stamp = ev as { timeStamp?: number; nativeEvent?: { timeStamp?: number } } | undefined;
    const now = stamp?.nativeEvent?.timeStamp ?? stamp?.timeStamp ?? performance.now();
    const twice = lastPress.current.id === id && now - lastPress.current.at < 450;
    lastPress.current = twice ? { id: "", at: 0 } : { id, at: now };
    openEvent(id, twice);
  };
  // a link to an event opens it, and the view goes to its day
  const linked = p.initial?.openId;
  useEffect(() => {
    if (!linked) return;
    setOpen((o) => (o?.id === linked ? o : { id: linked, edit: p.initial?.edit === true }));
    dispatch({ type: "select", id: linked });
    let live = true;
    void Promise.resolve(data.call("calendar.get_event", { eventId: linked })).then((o) => { const ev = (o as { event?: { startsAt: number } }).event; if (live && ev) dispatch({ type: "go", day: startOfDay(ev.startsAt, off) }); }, () => undefined);
    return () => { live = false; };
  }, [linked]); // eslint-disable-line react-hooks/exhaustive-deps -- only a new link moves the view
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
  const events = useMemo(() => (evq.status === "ready" ? evq.data.events : []).map((x) => allDayLocal(x, off)), [evq, off]);
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
  // the grid opens one hour above the current time when today is in view (an early event does not pull it up to midnight); another week opens at the working day, but never below its earliest timed event (half an hour of margin)
  useEffect(() => {
    if (cal.mode === "month") { scroll.current?.scrollTo?.({ y: 0, animated: false }); return; }
    const vd = viewDays(cal.mode, cal.day, off);
    const firsts = events.filter((e) => !e.allDay && !isBand(e) && e.status !== "canceled").flatMap((e) => vd.filter((d) => e.startsAt >= d && e.startsAt < d + DAY).map((d) => (e.startsAt - d) / HOUR));
    scroll.current?.scrollTo?.({ y: openHour(vd.includes(today), (clockNow.now - today) / HOUR, firsts) * HH, animated: false });
  }, [cal.mode, evq.status]); // eslint-disable-line react-hooks/exhaustive-deps -- on open, when the mode changes and when the events arrive

  const calId = cal.draft?.calendarId ?? calendars.find((c) => !c.personal)?.id ?? calendars[0]?.id ?? "";
  const withDraft = (span: Span, title = ""): void => dispatch({ type: "draft", draft: newDraft(span, calId, cal.people, title) });
  const selectedEvent = events.find((e) => e.id === cal.selected);

  const fail = (): void => undefined;
  const add = (d: Draft): void => {
    void createEvent(data, { ...d, video: videoOf(d) }).then((e) => { dispatch({ type: "draft", draft: null }); dispatch({ type: "select", id: e.id }); setCardSlots(null); }).catch(fail);
  };
  const deleted = (e: EventRow): void => {
    setUndo({ label: `Deleted “${e.title}”`, run: () => restoreEvent(data, e.id).then(() => dispatch({ type: "select", id: e.id })) });
    dispatch({ type: "select", id: null });
    if (open?.id === e.id) closeEvent();
  };
  const remove = (e: EventRow): void => { void deleteEvent(data, e.id).then(() => deleted(e)).catch(fail); };
  const copyLink = (e: EventRow): void => {
    void (globalThis as { navigator?: { clipboard?: { writeText(s: string): Promise<void> } } }).navigator?.clipboard?.writeText(eventLink(e.id))?.catch(() => undefined);
    setUndo({ label: "Link copied" });
  };
  const eventMenu = (e: EventRow, x: number, y: number): void => {
    dispatch({ type: "select", id: e.id });
    // the same menu as the pane: Going? needs the person's own answer, which the event read says (a local read, so the menu waits for it only a moment)
    const show = (mine?: "accepted" | "declined" | "tentative" | "needs_action"): void => menu.show(eventMenuEntries(menuFacts(e, calendars), {
      open: () => openEvent(e.id),
      edit: () => openEvent(e.id, true),
      ...(isPast(e, clockNow.now) ? {} : { prepare: () => { openEvent(e.id); void data.call("meetings.prep.start", { eventId: e.id }).catch(fail); } }),
      respond: (response) => void data.call("calendar.respond", { eventId: e.id, response }).catch(fail),
      ask: () => p.onAsk?.({ id: e.id, title: e.title }),
      copyLink: () => copyLink(e),
      join: () => { if (e.joinUrl) { if (p.onJoin) p.onJoin(e.joinUrl); else (globalThis as { open?: (u: string) => void }).open?.(e.joinUrl); } },
      openRecord: () => { const r = e.recordIds[0]; if (r) p.onOpenRecord?.(r); },
      openConversation: () => { const c = e.attendees.find((a) => a.contactId)?.contactId; if (c) p.onOpenConversation?.(c); },
      moveTo: (id) => void moveToCalendar(data, e.id, id).catch(fail),
      duplicate: () => void duplicateEvent(data, allDayToWire(e, off)).then((c) => dispatch({ type: "select", id: c.id })).catch(fail),
      remove: () => remove(e),
    }, mine), x, y);
    void Promise.resolve(data.call("calendar.get_event", { eventId: e.id })).then((o) => {
      const f = o as { mine?: { email: string; response: "accepted" | "declined" | "tentative" | "needs_action" } };
      show(f.mine && f.mine.email !== e.organizer && !isPast(e, clockNow.now) ? f.mine.response : undefined);
    }, () => show());
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
        // a drag makes the event it covers; one click on an empty slot starts half an hour there
        if (Math.abs(d.y1 - d.y0) > 4) dispatch({ type: "draft", draft: newDraft(dragCreate(d.day, d.y0, d.y1), calId, cal.people) });
        else { const c0 = clickCreate(d.day, d.y0); dispatch({ type: "draft", draft: newDraft({ startsAt: c0.startsAt, endsAt: c0.startsAt + 30 * 60_000 }, calId, cal.people) }); }
        return;
      }
      if (!d.moved) return;   // a press without a drag is a click: the event opens (onPress)
      const next = d.kind === "move" ? dragMove(d.orig, d.dy, d.dDays, off) : dragResize(d.orig, d.dy, off);
      const ev = events.find((x) => x.id === d.id);
      if (next.startsAt !== d.orig.startsAt || next.endsAt !== d.orig.endsAt) {
        void setTimes(data, d.id, next).then(() => setUndo({ label: d.kind === "move" ? `Moved “${ev?.title ?? "the event"}”` : `Changed the length of “${ev?.title ?? "the event"}”`, run: () => setTimes(data, d.id, d.orig) })).catch(fail);
      }
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
  /** The menu trigger's long press listens to pointer down too; both run, the menu's first. */
  const withPointerDown = (t: Record<string, unknown>, also: (e: PointerLike) => void): Record<string, unknown> => {
    const own = t["onPointerDown"] as ((e: PointerLike) => void) | undefined;
    return { ...t, onPointerDown: (e: PointerLike): void => { own?.(e); also(e); } };
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
    if (k.key === "Escape" && open && !cal.draft) { k.preventDefault?.(); closeEvent(); return; }
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

  // the hover card: title, time, who and a Join button, after a short rest on an event; a press opens the pane as before
  const [hov, setHov] = useState<{ id: string; x: number; y: number; w: number } | null>(null);
  const hovTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovOff = (): void => { if (hovTimer.current) clearTimeout(hovTimer.current); hovTimer.current = null; setHov(null); };
  const [rise, setRise] = useState<string | null>(null);
  const hoverIn = (id: string) => (ev: unknown): void => {
    setRise(id);
    const r = (ev as { currentTarget?: { getBoundingClientRect?: () => { left: number; right: number; top: number; width: number } } } | undefined)?.currentTarget?.getBoundingClientRect?.();
    if (!r || phone || drag) return;
    if (hovTimer.current) clearTimeout(hovTimer.current);
    hovTimer.current = setTimeout(() => setHov({ id, x: r.right + 6, y: r.top, w: r.width }), hov ? 60 : 420);
  };
  const hoverOut = (): void => {
    setRise(null); if (hovTimer.current) clearTimeout(hovTimer.current); hovTimer.current = setTimeout(() => setHov(null), 140); };
  const hovEvent = hov ? events.find((x) => x.id === hov.id) : undefined;
  const hovCard = hov && hovEvent ? (() => {
    const e = hovEvent, who = e.attendees.filter((a) => a.email !== p.me).map((a) => a.name ?? names.get(a.email) ?? a.email);
    const joinable = e.joinUrl !== undefined && e.joinProvider !== "none" && e.endsAt > clockNow.now;
    const left = typeof window !== "undefined" && hov.x + 250 > window.innerWidth - 8 ? Math.max(8, hov.x - hov.w - 262) : hov.x;
    return (
      <View style={[s.hov, { left, top: hov.y }]} testID="cal-hover" {...({ onMouseEnter: () => { if (hovTimer.current) clearTimeout(hovTimer.current); }, onMouseLeave: hoverOut } as object)}>
        <View style={s.hovHead}><View style={[s.cdot, { backgroundColor: colorOf(calendars, e.calendarId) }]} /><Text numberOfLines={2} style={s.hovTitle}>{e.title}</Text></View>
        <Text style={s.hovText}>{`${dayText(e.startsAt, off)} · ${eventLine(e, off)}`}</Text>
        {who.length > 0 ? <Text style={s.hovWho} numberOfLines={2}>{who.slice(0, 3).join(", ")}{who.length > 3 ? ` and ${who.length - 3} more` : ""}</Text> : null}
        {joinable ? <Pressable accessibilityRole="button" accessibilityLabel={`Join ${PROVIDER_NAME[e.joinProvider as "meet"] ?? "call"}`} testID="cal-hover-join" onPress={() => { hovOff(); nav.join(e.joinUrl as string); }} style={({ hovered }: { hovered?: boolean }) => [s.btn, s.btnP, s.hovJoin, hovered === true && s.btnPOver]}><Text style={s.btnPText}>{`Join ${PROVIDER_NAME[e.joinProvider as "meet"] ?? "call"}`}</Text></Pressable> : null}
      </View>
    );
  })() : null;

  const renderEvent = (e: EventRow, day: number, laid: ReturnType<typeof lanesOf>[number], all: ReturnType<typeof lanesOf>): ReactElement => {
    const span = preview(e);
    const l = { ...laid, e: { ...e, ...span } };
    const b = blockOf(l, day);
    const col = colorOf(calendars, e.calendarId);
    if (laid.more) {
      // past three at once: the first two show and this tile lists the rest
      const rest = laid.more;
      return (
        <Pressable key={`more:${e.id}`} accessibilityRole="button" accessibilityLabel={`${rest.length} more at this time`} testID={`grpmore:${e.id}`} onPress={(ev) => { const q = pointOf(ev); menu.show([{ head: "At this time" }, ...rest.map((r) => ({ label: `${r.title}  ${clock(r.startsAt, off)}`, onSelect: () => openEvent(r.id) }))], q.x, q.y); }}
          style={({ hovered }: { hovered?: boolean }) => [s.grpMore, { top: b.top }, hovered === true && s.hicOver]}><Text style={s.grpMoreText}>{`+${rest.length}`}</Text></Pressable>
      );
    }
    if (laid.band) {
      // a long Block or Focus: a quiet tinted band behind the others; only its small label takes a press (the rest lets a drag create through)
      // the label sits only at the band's own top and is left out when a card covers that spot
      const crowded = all.some((o) => !o.band && o.e.startsAt < e.startsAt + 16 * 36e5 / HH && o.e.endsAt > e.startsAt);
      return (
        <View key={e.id} pointerEvents="box-none" testID={`band:${e.id}`} style={[s.band, { top: b.top, height: b.height, backgroundImage: tint(col, cal.selected === e.id ? 11 : 6), boxShadow: `inset 2px 0 0 color-mix(in srgb, ${col} 38%, transparent)` as unknown as undefined }]}>
          {crowded ? null : <Pressable accessibilityRole="button" accessibilityLabel={`${e.title}, ${eventLine(e, off)}`} testID={`band-label:${e.id}`} onPress={(ev) => pressEvent(e.id, ev)} {...menuTrigger((x, y) => eventMenu(e, x, y))} style={[s.bandLabel, s.bandLabelTop]}>
            <Text numberOfLines={1} style={[s.bandText, { color: col }]}>{e.title}</Text>
          </Pressable>}
        </View>
      );
    }
    const when = b.time === "range" ? range(span.startsAt, span.endsAt, off) : clock(span.startsAt, off);
    const inline = b.lines === 1 && b.time === "start";
    return (
      <View key={e.id} {...menuTrigger((x, y) => eventMenu(e, x, y))} style={[s.cev, { top: b.top, height: b.height, left: b.left as unknown as number, width: b.width as unknown as number, zIndex: rise === e.id ? 20 : b.z, backgroundImage: tint(col, isPast(e, clockNow.now) ? 9 : 15), borderLeftColor: col }, cal.selected === e.id && s.cevSel]} testID={`event:${e.id}`}>
        <Pressable
          accessibilityRole="button" accessibilityLabel={`${e.title}, ${eventLine(e, off)}`} accessibilityState={{ selected: cal.selected === e.id }} testID={`event-body:${e.id}`}
          onPress={(ev) => pressEvent(e.id, ev)} onHoverIn={hoverIn(e.id)} onHoverOut={hoverOut} {...({ onPointerDown: startEvent(e, "move") } as object)} style={[s.cevIn, inline && s.cevInline, (laid.lanes > 1 || b.clip !== undefined) && s.cevInNarrow, b.clip !== undefined && { maxHeight: b.clip, overflow: "hidden", flexGrow: 0, flexShrink: 0, flexBasis: "auto" }]}
        >
          <Text numberOfLines={b.lines} style={[s.cevTitle, inline && s.cevTitleInline, isPast(e, clockNow.now) && s.cevPast]}>{e.title}</Text>
          {b.time === "none" ? null : <Text numberOfLines={1} style={s.cevSmall}>{when}</Text>}
        </Pressable>
        <View testID={`resize:${e.id}`} {...({ onPointerDown: startEvent(e, "resize") } as object)} style={s.grip} />
        {e.bookedByAgentId && b.height >= 24 && laid.lanes < 2 ? <View style={s.af}><Face name={e.bookedByAgentId.replace(/^agt_/, "")} seedId={e.bookedByAgentId} size={14} round={false} /></View> : null}
      </View>
    );
  };

  // phone: a swipe across the day view goes to the next or previous day
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const swipeStart = (e: { touches?: ArrayLike<{ clientX: number; clientY: number }> }): void => { const t = e.touches?.[0]; swipe.current = phone && mode === "day" && t && (e.touches?.length ?? 0) === 1 ? { x: t.clientX, y: t.clientY } : null; };
  const swipeEnd = (e: { changedTouches?: ArrayLike<{ clientX: number; clientY: number }> }): void => {
    const a = swipe.current, t = e.changedTouches?.[0];
    swipe.current = null;
    if (!a || !t) return;
    const dx = t.clientX - a.x, dy = t.clientY - a.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.8) dispatch({ type: "step", dir: dx < 0 ? 1 : -1, offsetMin: off });
  };

  const header = (
    <View style={[s.head, phone && s.headPhone]} testID="calendar-head">
      <Text accessibilityRole="header" aria-level={1} style={[s.h1, phone && s.h1Phone]} numberOfLines={1} testID="calendar-title">{viewTitle(mode, cal.day, off)}</Text>
      <View style={s.nv}>
        <HeadIcon icon="chevl" label="Previous" testID="cal-prev" onPress={() => dispatch({ type: "step", dir: -1, offsetMin: off })} />
        <Pressable accessibilityRole="button" accessibilityLabel="Go to today" testID="cal-today" onPress={() => dispatch({ type: "today", today })} style={({ hovered }: { hovered?: boolean }) => [s.todayBtn, hovered === true && s.hicOver]}><Text style={s.todayText}>Today</Text></Pressable>
        <HeadIcon icon="chevr" label="Next" testID="cal-next" onPress={() => dispatch({ type: "step", dir: 1, offsetMin: off })} />
      </View>
      <View style={s.grow} />
      <View style={s.seg} accessibilityRole="tablist">
        {each((phone ? ["day", "month"] : ["day", "week", "month"]) as readonly Mode[], (m) => (
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
      <View style={s.faces}>{each(shaded, (e, i) => <View key={e} style={i > 0 ? s.faceOver : undefined}><Face name={names.get(e) ?? e} seedId={e} size={18} /></View>)}</View>
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
      {videosFor(draft.calendarId).length ? (
        <View style={s.pr}>{videoOf(draft) === "none" ? <Icon name="video" size={14} /> : <BrandMark provider={videoOf(draft) as "meet"} size={14} />}
          <Pressable accessibilityRole="button" accessibilityLabel="Video call" testID="cal-card-video" onPress={(e) => {
            const q = pointOf(e);
            const pick = (v: "meet" | "teams" | "zoom" | "none"): void => { try { store?.setItem(VIDEO_KEY, v); } catch { /* remembered for this visit only */ } dispatch({ type: "draft", draft: { ...draft, video: v } }); };
            menu.show([{ head: "Video call" }, ...videosFor(draft.calendarId).map((v) => ({ label: PROVIDER_NAME[v], checked: videoOf(draft) === v, onSelect: () => pick(v) })), { separator: true }, { label: "None", checked: videoOf(draft) === "none", onSelect: () => pick("none") }], q.x, q.y);
          }} style={({ hovered }: { hovered?: boolean }) => [s.pk, hovered === true && s.hicOver]}>
            <Text style={s.pkText}>{videoOf(draft) === "none" ? "No video call" : PROVIDER_NAME[videoOf(draft) as "meet"]}</Text><Icon name="chevd" size={9} />
          </Pressable>
        </View>
      ) : null}
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
      <View style={[s.mgrid, phone && s.mgridPhone]}>
        {each(days, (d) => {
          const es = monthCell(events, d);
          const cap = MONTH_CAP;
          const show = es.slice(0, cap);
          const out = monthOf(d, off) !== monthOf(cal.day, off);
          return (
            <Pressable
              key={d} accessibilityRole="none" accessibilityLabel={`${weekdayShort(d, off)} ${dateOf(d, off)}`} testID={`cell:${d}`}
              {...menuTrigger((x, y) => menu.show(dayMenuEntries({ newHere: () => withDraft(clickCreate(d, 9 * HH)), goDay: () => { dispatch({ type: "mode", mode: "day" }); dispatch({ type: "go", day: d }); } }), x, y))}
              {...({ onDoubleClick: () => withDraft(clickCreate(d, 9 * HH)) } as object)}
              onPress={() => dispatch({ type: "go", day: d })} style={({ hovered }: { hovered?: boolean }) => [s.mc, phone && s.mcPhone, hovered === true && s.hicOver]}
            >
              <View style={[s.mn, phone && s.mnPhone, d === today && s.mnToday, phone && d === cal.day && d !== today && s.mnSel]}><Text style={[s.mnText, out && s.mnOut, d === today && s.mnTodayText]}>{dateOf(d, off)}</Text></View>
              {phone ? (
                // iOS style: up to three dots coloured by calendar; a tap shows that day's agenda under the grid
                <View style={s.dots} testID={`dots:${d}`}>{each(es.slice(0, 3), (e) => <View key={e.id} style={[s.cdotS, { backgroundColor: colorOf(calendars, e.calendarId) }]} />)}</View>
              ) : null}
              {phone ? null : each(show, (e) => (
                <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={e.title} testID={`mev:${e.id}`} onPress={(ev) => pressEvent(e.id, ev)} onHoverIn={hoverIn(e.id)} onHoverOut={hoverOut} {...menuTrigger((x, y) => eventMenu(e, x, y))} style={({ hovered }: { hovered?: boolean }) => [s.mev, (hovered === true || cal.selected === e.id) && s.mevOver]}>
                  <View style={[s.cdotS, { backgroundColor: colorOf(calendars, e.calendarId) }]} />
                  {e.allDay ? null : <Text style={s.mevTime}>{clock(e.startsAt, off).replace(":00", "").replace(" ", "").toLowerCase()}</Text>}
                  <Text numberOfLines={1} style={[s.mevText, isPast(e, clockNow.now) && s.cevPast]}>{e.title}</Text>
                </Pressable>
              ))}
              {phone ? null : es.length > cap ? <Pressable accessibilityRole="button" accessibilityLabel={`${es.length - cap} more events`} testID={`more:${d}`} onPress={() => { dispatch({ type: "mode", mode: "day" }); dispatch({ type: "go", day: d }); }} style={({ hovered }: { hovered?: boolean }) => [s.mmoreBtn, hovered === true && s.hicOver]}><Text style={s.mmore}>{`+${es.length - cap} more`}</Text></Pressable> : null}
            </Pressable>
          );
        })}
      </View>
      {phone ? (
        <View style={s.agenda} testID="cal-agenda">
          <Text style={s.agendaHead}>{dayText(cal.day, off)}</Text>
          {monthCell(events, cal.day).length === 0 ? <Text style={s.agendaNone}>Nothing planned</Text> : each(monthCell(events, cal.day), (e) => (
            <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={e.title} testID={`agenda:${e.id}`} onPress={(ev) => pressEvent(e.id, ev)} style={({ hovered }: { hovered?: boolean }) => [s.agendaRow, hovered === true && s.hicOver]}>
              <View style={[s.cdotS, { backgroundColor: colorOf(calendars, e.calendarId) }]} />
              <Text style={s.agendaTime}>{e.allDay ? "All day" : rangeShort(e.startsAt, e.endsAt, off)}</Text>
              <Text numberOfLines={1} style={s.agendaTitle}>{e.title}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );

  // ---- Day and Week
  const nDays = days.length;
  const lane = allDayLane(events, days, phone && nDays === 1 ? 99 : 2);
  const pct = (i: number): string => `${(i * 100) / nDays}%`;
  const chip = (e: EventRow, multi: boolean, label: string): ReactElement => (
    <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={e.title} testID={`allday:${e.id}`} onPress={(ev) => pressEvent(e.id, ev)} onHoverIn={hoverIn(e.id)} onHoverOut={hoverOut} {...menuTrigger((x, y) => eventMenu(e, x, y))}
      style={[s.cevAll, label !== "" && s.cevAllRow, multi && s.cevMulti, { backgroundImage: tint(colorOf(calendars, e.calendarId), multi ? 22 : 15), borderLeftColor: colorOf(calendars, e.calendarId) }, cal.selected === e.id && s.cevSel]}>
      <Text numberOfLines={1} style={s.cevTitle}>{e.title}</Text>{label ? <Text numberOfLines={1} style={s.cevSmall}>{label}</Text> : null}
    </Pressable>
  );
  const adLane = lane.segs.length === 0 ? null : phone && nDays === 1 ? (
    // on a phone the all-day items are a list at the top of the day
    <View style={s.adList} testID="cal-allday-list">{each(lane.segs, (sg) => chip(sg.e, false, "All day"))}</View>
  ) : (
    <View style={s.adRow} testID="cal-allday">
      <View style={s.gutter} />
      <View style={[s.adl, { height: lane.rows * AD_ROW + 4 }]}>
        <View pointerEvents="none" style={s.adCols}>{each(days, (d) => <View key={d} style={s.adCol} />)}</View>
        {each(lane.segs, (sg) => (
          <View key={sg.e.id + sg.a} style={{ position: "absolute", top: sg.row * AD_ROW, left: `calc(${pct(sg.a)} + 3px)` as unknown as number, width: `calc(${((sg.b - sg.a + 1) * 100) / nDays}% - 6px)` as unknown as number, zIndex: 2 }}>{chip(sg.e, sg.b > sg.a, "")}</View>
        ))}
        {each(Object.keys(lane.hidden), (k) => (
          <Pressable key={k} accessibilityRole="button" accessibilityLabel={`${lane.hidden[+k]} more all-day events`} testID={`admore:${days[+k]}`} onPress={() => { dispatch({ type: "mode", mode: "day" }); dispatch({ type: "go", day: days[+k] as number }); }}
            style={({ hovered }: { hovered?: boolean }) => [s.adMore, { top: 2 * AD_ROW, left: `calc(${pct(+k)} + 3px)` as unknown as number }, hovered === true && s.hicOver]}><Text style={s.adMoreText}>{`+${lane.hidden[+k]}`}</Text></Pressable>
        ))}
      </View>
    </View>
  );
  const nowIn = days.includes(today);
  const nowY = offsetToY(clockNow.now - today);
  const timeBody = (
    <View style={s.timeWrap} {...({ onTouchStart: swipeStart, onTouchEnd: swipeEnd } as object)}>
      <View style={s.chdWrap}>
      <View style={s.chd}>
        <View style={s.gutter} />
        {each(days, (d) => (
          <View key={d} style={s.dh} testID={`dayhead:${d}`}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${weekdayShort(d, off)} ${dateOf(d, off)}`} onPress={() => { dispatch({ type: "mode", mode: "day" }); dispatch({ type: "go", day: d }); }} style={s.dhIn}>
              <Text style={[s.dhWk, isWeekend(d, off) && s.dhQuiet, d === today && s.dhToday]}>{weekdayShort(d, off)}</Text>
              <View style={[s.dhNum, d === today && s.dhNumToday]}><Text style={[s.dhNumText, isWeekend(d, off) && s.dhNumQuiet, d === today && s.dhNumTodayText]}>{dateOf(d, off)}</Text></View>
            </Pressable>
          </View>
        ))}
      </View>
      {adLane}
      </View>
      <ScrollView ref={scroll} style={s.scroll} testID="cal-scroll">
      <View style={s.cbody} ref={body as never}>
        <View style={s.hours}>
          {Array.from({ length: 23 }, (_, i) => <Text key={i} style={[s.hour, { top: (i + 1) * HH }, nowIn && Math.abs((i + 1) * HH - nowY) < 9 && s.hourHid]}>{`${(i + 1) % 12 || 12} ${i + 1 < 12 ? "AM" : "PM"}`}</Text>)}
          {nowIn ? <View style={[s.nowPill, { top: nowY - 7 }]} testID="cal-now-label"><Text style={s.nowPillText}>{clock(clockNow.now, off).replace(/ [AP]M$/, "")}</Text></View> : null}
        </View>
        {each(days, (d) => {
          const laid = lanesOf(eventsOn(events, d, false));
          const ghost = drag?.kind === "create" && drag.day === d ? dragCreate(d, drag.y0, drag.y1) : draft && startOfDay(draft.startsAt, off) === d ? draft : null;
          return (
            <View key={d} style={[s.ccol, isWeekend(d, off) && s.ccolWeekend, d === today && s.ccolToday]} testID={`col:${d}`} {...({ onPointerDown: startCreate(d), onDoubleClick: (e: PointerLike) => { const r = e.currentTarget?.getBoundingClientRect?.(); if (r) withDraft(clickCreate(d, e.clientY - r.top)); } } as object)}
              {...withPointerDown(menuTrigger((x, y) => menu.show(dayMenuEntries({ newHere: () => withDraft(clickCreate(d, 9 * HH)), goDay: () => { dispatch({ type: "mode", mode: "day" }); dispatch({ type: "go", day: d }); } }), x, y)), startCreate(d))}>
              {each(dayStripes(d), (st) => (
                <View key={st.top} testID={`stripe:${d}:${st.top}`} accessibilityLabel={`${whoLabel(st.who, names)} busy`} pointerEvents="none" style={[s.busy, { top: st.top, height: st.height, backgroundColor: `color-mix(in srgb, var(--ink) ${st.alpha}%, transparent)` }]} />
              ))}
              {each(laid, (l) => renderEvent(l.e, d, l, laid))}
              {d === today ? <View pointerEvents="none" style={[s.now, { top: offsetToY(clockNow.now - d) }]} testID="cal-now" /> : null}
              {ghost ? <View pointerEvents="none" testID="cal-ghost" style={[s.ghost, { top: offsetToY(ghost.startsAt - d), height: Math.max(20, offsetToY(ghost.endsAt - ghost.startsAt) - 1) }]}><Text numberOfLines={1} style={s.ghostText}>{drag?.kind === "create" ? range(ghost.startsAt, ghost.endsAt, off) : draft && "title" in ghost && ghost.title ? ghost.title : "New event"}</Text></View> : null}
            </View>
          );
        })}
      </View>
      </ScrollView>
    </View>
  );

  const nav = {
    join: (url: string) => { if (p.onJoin) p.onJoin(url); else (globalThis as { open?: (u: string) => void }).open?.(url); },
    call: (number: string, pin?: string) => { if (p.onCall) p.onCall(number, pin); else if (phoneDock) phoneDock.dial(number); else if (p.onOpenUrl) p.onOpenUrl(telUrl(number, pin)); else (globalThis as { open?: (u: string) => void }).open?.(telUrl(number, pin)); },
    openUrl: (url: string) => { if (p.onOpenUrl) p.onOpenUrl(url); else (globalThis as { open?: (u: string) => void }).open?.(url); },
    openRecord: (id: string) => p.onOpenRecord?.(id), openMeeting: (id: string) => p.onOpenMeeting?.(id), openFile: (id: string) => p.onOpenFile?.(id),
    ask: (e: { id: string; title: string }) => p.onAsk?.({ id: e.id, title: e.title }),
  };
  const openRow = open ? events.find((x) => x.id === open.id) : undefined;
  const pane = open ? (
    <EventPane
      key={`${open.id}:${open.edit ? "edit" : "view"}`} eventId={open.id} editing={open.edit} inSheet={phone} calendars={calendars} names={names} directory={directoryOf(p.team)} me={p.me} nav={nav}
      stamp={openRow ? `${openRow.title}|${openRow.startsAt}|${openRow.endsAt}|${openRow.calendarId}|${JSON.stringify(openRow.attendees)}` : ""}
      onClose={closeEvent} onUndo={(label, run) => setUndo(run ? { label, run } : { label })} onDeleted={deleted} zoom={zoomOn}
    />
  ) : null;
  return (
    <View style={s.row}>
    <View style={s.cal} testID="calendar" accessibilityLabel={`Calendar, ${mode}`} {...({ onKeyDown } as object)}>
      {header}
      {online ? null : <Text style={s.offline} accessibilityRole="alert" testID="cal-offline">Offline, showing your saved copy</Text>}
      {availBar}
      {panel ? <View style={s.panel}><Text style={s.panelHead}>Everyone is free</Text><FindTimeList slots={panel} offsetMin={off} onPick={pickSlot} testID="cal-slots" /></View> : null}
      {undo ? (
        <View style={s.undo} testID="cal-undo"><Text style={s.undoText}>{undo.label}</Text>
          {undo.run ? <Pressable accessibilityRole="button" accessibilityLabel="Undo" testID="cal-undo-btn" onPress={() => { void undo.run?.().then(() => setUndo(null)).catch(fail); }} style={({ hovered }: { hovered?: boolean }) => [s.lnk, hovered === true && s.lnkOver]}><Text style={s.lnkText}>Undo</Text></Pressable> : null}
        </View>
      ) : null}
      {mode === "month" ? monthBody : timeBody}
      {card}
      {hovCard}
      {menu.element}
    </View>
    {/* the event opens where it was pressed: beside the calendar, or in a sheet on a phone */}
    {pane && !phone ? <ResizableColumn paneKey="calendar-event" defaultWidth={360} grow="left" min={300} maxFraction={0.5} maxWidth={520} inline style={s.paneCol} testID="calendar-event-col" label="Event">{pane}</ResizableColumn> : null}
    {phone ? <Sheet open={pane !== null} title={openRow?.title ?? "Event"} onClose={closeEvent}>{pane}</Sheet> : null}
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
  row: { flex: 1, minHeight: 0, minWidth: 0, flexDirection: "row" },
  paneCol: { minHeight: 0, borderLeftWidth: 1, borderLeftColor: ink("--line") },
  cal: { flex: 1, minHeight: 0, minWidth: 0, backgroundColor: ink("--win") },
  head: { height: 48, flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 18, paddingRight: 10, borderBottomWidth: 1, borderBottomColor: ink("--line") },
  h1: { fontSize: 14, fontWeight: "600", letterSpacing: -0.07, color: ink("--ink"), flexShrink: 1, fontVariant: ["tabular-nums"] },
  headPhone: { height: undefined, minHeight: 48, flexWrap: "wrap", paddingVertical: 6, rowGap: 4, paddingLeft: 14 },
  h1Phone: { width: "100%", flexShrink: 0 },
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
  chd: { flexDirection: "row" },
  gutter: { width: 52 },
  chdWrap: { borderBottomWidth: 1, borderBottomColor: ink("--line"), backgroundColor: ink("--win") },
  dh: { flex: 1, minWidth: 0, borderLeftWidth: 1, borderLeftColor: ink("--line"), paddingBottom: 4 },
  dhIn: { flexDirection: "row", alignItems: "center", gap: 7, paddingTop: 9, paddingHorizontal: 10, paddingBottom: 7 },
  dhWk: { fontSize: 12, color: ink("--ink-3") },
  dhToday: { color: ink("--accent") },
  dhNum: { minWidth: 26, height: 26, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  dhNumToday: { backgroundColor: ink("--accent") },
  dhNumText: { fontSize: 15, fontWeight: "500", color: ink("--ink"), fontVariant: ["tabular-nums"] },
  dhNumTodayText: { color: ink("--accent-ink"), fontWeight: "600" },
  cevAll: { height: 19, borderRadius: 5, borderLeftWidth: 3, paddingHorizontal: 6, justifyContent: "flex-start", flexDirection: "row", alignItems: "center", gap: 8, overflow: "hidden" },
  cevMulti: { boxShadow: "inset -3px 0 0 color-mix(in srgb, var(--ink) 14%, transparent)" as unknown as undefined },
  adRow: { flexDirection: "row" },
  adl: { flex: 1, minWidth: 0, paddingTop: 0 },
  adCols: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, flexDirection: "row" },
  adCol: { flex: 1, borderLeftWidth: 1, borderLeftColor: ink("--line") },
  adMore: { position: "absolute", height: AD_ROW - 2, paddingHorizontal: 6, borderRadius: 4, justifyContent: "center", zIndex: 2 },
  adMoreText: { fontSize: 11.5, fontWeight: "600", color: ink("--ink-3") },
  adList: { paddingHorizontal: 10, paddingBottom: 6, gap: 2 },
  cevAllRow: { height: 24, justifyContent: "space-between", paddingHorizontal: 8 },
  dhQuiet: { color: ink("--ink-4") },
  dhNumQuiet: { color: ink("--ink-3") },
  hourHid: { opacity: 0 },
  nowPill: { position: "absolute", right: 3, height: 14, paddingHorizontal: 4, borderRadius: 4, backgroundColor: ink("--danger"), justifyContent: "center", zIndex: 9 },
  nowPillText: { fontSize: 10, lineHeight: 14, fontWeight: "600", color: "#fff", fontVariant: ["tabular-nums"] },
  band: { position: "absolute", left: 0, right: 0, zIndex: 1 },
  grpMore: { position: "absolute", right: 3, height: 20, minWidth: 26, paddingHorizontal: 6, borderRadius: 5, justifyContent: "center", alignItems: "center", zIndex: 6, backgroundColor: ink("--raised"), boxShadow: "0 0 0 1px var(--line-2)" as unknown as undefined },
  grpMoreText: { fontSize: 11, fontWeight: "600", color: ink("--ink-2") },
  bandLabel: { position: "absolute", left: 6, maxWidth: "90%" as unknown as number, paddingHorizontal: 3, borderRadius: 3, opacity: 0.8 },
  bandLabelTop: { top: 2 },
  bandLabelBot: { bottom: 2 },
  bandText: { fontSize: 10.5, lineHeight: 14, fontWeight: "500" },
  hov: { position: "fixed" as unknown as "absolute", width: 244, zIndex: 60, borderRadius: 10, backgroundColor: ink("--raised"), paddingTop: 10, paddingHorizontal: 12, paddingBottom: 11, gap: 3, boxShadow: "var(--sh-pop)" as unknown as undefined },
  hovHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  hovTitle: { flex: 1, fontSize: 13, lineHeight: 17, fontWeight: "600", color: ink("--ink") },
  hovText: { fontSize: 12, color: ink("--ink-2") },
  hovWho: { fontSize: 12, color: ink("--ink-3") },
  hovJoin: { marginTop: 6, alignSelf: "flex-start" },
  mmoreBtn: { alignSelf: "flex-start", height: 17, paddingHorizontal: 4, borderRadius: 4, justifyContent: "center" },
  cbody: { flexDirection: "row", height: GRID },
  hours: { width: 52, height: GRID },
  hour: { position: "absolute", right: 8, fontSize: 10.5, color: ink("--ink-3"), fontVariant: ["tabular-nums"], transform: [{ translateY: -7 }] },
  ccol: { flex: 1, minWidth: 0, height: GRID, borderLeftWidth: 1, borderLeftColor: ink("--line"), backgroundImage: GRIDBG as unknown as undefined },
  ccolWeekend: { backgroundImage: `${SOLID("color-mix(in srgb, var(--ink) 2.4%, transparent)")}, ${GRIDBG}` as unknown as undefined },
  ccolToday: { backgroundImage: `${SOLID("color-mix(in srgb, var(--accent) 5.5%, transparent)")}, ${GRIDBG}` as unknown as undefined },
  cev: { position: "absolute", borderRadius: 5, overflow: "hidden", borderLeftWidth: 3, zIndex: 2, boxShadow: "0 0 0 1px var(--win)" as unknown as undefined },
  cevSel: { zIndex: 4, boxShadow: "0 0 0 2px var(--accent)" as unknown as undefined },
  cevIn: { flex: 1, paddingTop: 3, paddingBottom: 2, paddingLeft: 5, paddingRight: 4 },
  cevInNarrow: { paddingTop: 1 },
  cevInline: { flexDirection: "row", alignItems: "baseline", gap: 6, paddingTop: 2 },
  cevTitleInline: { flexShrink: 1 },
  cevTitle: { fontSize: 11.5, lineHeight: 14, fontWeight: "600", color: ink("--ink"), ...({ overflowWrap: "normal", wordBreak: "normal" } as object) },
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
  mgridPhone: { flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
  mgrid: { flex: 1, minHeight: 0, flexDirection: "row", flexWrap: "wrap" },
  mc: { width: "14.2857%" as unknown as number, minHeight: 104, flexGrow: 1, borderRightWidth: 1, borderBottomWidth: 1, borderRightColor: ink("--line"), borderBottomColor: ink("--line"), paddingVertical: 4, paddingHorizontal: 5, overflow: "hidden", gap: 1 },
  mcPhone: { minHeight: 44, alignItems: "center", paddingHorizontal: 1 },
  dots: { flexDirection: "row", gap: 3, justifyContent: "center", height: 8, marginTop: 2 },
  mnPhone: { alignSelf: "center", width: 26, height: 26, minWidth: 26, paddingHorizontal: 0, borderRadius: 13, marginBottom: 2 },
  mnSel: { boxShadow: "inset 0 0 0 1.5px var(--accent)" as unknown as undefined },
  agenda: { flex: 1, minHeight: 0, borderTopWidth: 1, borderTopColor: ink("--line"), paddingVertical: 8, paddingHorizontal: 14, gap: 2 },
  agendaHead: { fontSize: 12, fontWeight: "600", color: ink("--ink-3"), marginBottom: 2 },
  agendaNone: { fontSize: 12.5, color: ink("--ink-3"), paddingVertical: 4 },
  agendaRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 30, borderRadius: 6 },
  agendaTime: { fontSize: 12, color: ink("--ink-3"), width: 128, flexShrink: 0, fontVariant: ["tabular-nums"] },
  agendaTitle: { flex: 1, fontSize: 13, color: ink("--ink") },
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
  skLine: { height: HH, borderBottomWidth: 1, borderBottomColor: ink("--line") },
});
