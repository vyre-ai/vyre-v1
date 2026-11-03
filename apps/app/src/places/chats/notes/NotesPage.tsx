// Notes, at the top of Chats beside Tasks, Threads and Artifacts: a person's notes as a grid of cards, like Keep. The head has the search and the label filter; Take a note sits above
// the grid; Pinned notes come first, then Others, in columns about 236 wide. A card opens the note over the page to edit in place; its menu (a right-click, Shift F10, or More) pins,
// colours, labels, shares, asks Vyre about it, turns it into a task or a record, copies its link, copies it or deletes it (with Undo). The grid is one stop for Tab: the arrows move
// between cards by where they sit, and single keys act on the selected card. On a phone the grid is two columns, Take a note waits above the tab bar, a note opens as its own page and a
// long press opens its actions. Every menu is ui/Menu; every list of people is ui/Row. The data is the notes capabilities through the Space's runtime (data.ts).
import { createElement, useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import type { ComponentRef, ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry, MenuItem } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import { AskPane } from "../../records/askpane/AskPane.tsx";
import { RecordsAssistant } from "../../../shell/providers/records-ask.tsx";
import type { AskScope } from "../../../shell/providers/records-ask.tsx";
import { notesStoreFor } from "./data.ts";
import type { NotesStore } from "./data.ts";
import { Ico, icoSvg } from "./icons.tsx";
import { cardKey, layerKey, nearest, pageKey, topLayer } from "./keys.ts";
import type { Box, Dir } from "./keys.ts";
import { ensureNotesCss, noteFill } from "./look.ts";
import { COLORS, SPECIAL, askWords, dueChoices, editedWords, fillFromNote, filterLabel, firstLine, hostOf, labelCounts, noteName, splitPinned, toggle, visibleNotes } from "./model.ts";
import type { DueChoice, Note, NoteColor, RecordType, Who } from "./model.ts";
import { NoteCard } from "./NoteCard.tsx";
import type { CardActions } from "./NoteCard.tsx";
import { NoteDialog } from "./NoteDialog.tsx";
import { TakeNote } from "./TakeNote.tsx";
import { ActionSheet, PhoneNote } from "./NotePhone.tsx";
import { RecordSheet, ShareSheet, TaskSheet } from "./NoteSheets.tsx";
import type { Person, RecordDone, RecordDraft, TaskDone, TaskDraft } from "./NoteSheets.tsx";
import { Btn, IconBtn, Keycap, Swatch, TickBox, dom, pressPoint, web } from "./parts.tsx";
import { CLOSED, barStep, createInput, fromDataUri, pasteKind, takeStep } from "./take.ts";
import type { Bar, LinkPreview, Take, TakeAct } from "./take.ts";

/** Under this width the page is the phone's: two columns, Take a note at the foot, a note opens as a page. */
export const NOTES_PHONE = 560;
const SAVE_MS = 500;
const SAY_MS = 4000;
const UNDO_MS = 10_000;

type Sheet =
  | { kind: "task"; noteId: string; draft: TaskDraft; done: TaskDone | null }
  | { kind: "record"; noteId: string; draft: RecordDraft; done: RecordDone | null };

/** Where the page starts (tests and screenshots); a person always starts on the plain grid. */
export interface NotesInitial {
  filter?: string[];
  q?: string;
  take?: Partial<Take>;
  open?: string;
  share?: string;
  ask?: string;
  task?: { noteId: string; title?: string; due?: string };
  record?: { noteId: string; type?: string };
  /** Opens the label filter menu once the page has drawn. */
  filterMenu?: boolean;
  /** On a phone: the note open as its page, and its action sheet. */
  phoneOpen?: string;
  phoneSheet?: boolean;
}

export interface NotesPageProps {
  rt: ShellRuntime;
  nameOf(id: string): string;
  /** A note to open first: a search hit or a link to it. */
  noteId?: string | null;
  initial?: NotesInitial;
  store?: NotesStore;
  /** The phone layout whatever the width (screenshots of a phone frame). */
  phone?: boolean;
  /** Each new number opens Take a note (the sidebar row's "Take a note"). */
  takeNonce?: number;
}

const key = (): string => `nte_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
type Doc = { querySelector(q: string): unknown; querySelectorAll(q: string): ArrayLike<unknown>; activeElement: unknown; addEventListener(t: string, f: (e: never) => void, c?: boolean): void; removeEventListener(t: string, f: (e: never) => void, c?: boolean): void; createElement(t: string): unknown };
const doc = (): Doc | null => (web ? ((globalThis as { document?: Doc }).document ?? null) : null);
type El = { closest?(q: string): El | null; getBoundingClientRect?(): { left: number; top: number; width: number; height: number; bottom: number }; focus?(o?: unknown): void; getAttribute?(k: string): string | null; tagName?: string; isContentEditable?: boolean; scrollIntoView?(o?: unknown): void; getClientRects?(): ArrayLike<unknown> };
type KeyEv = { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean; target: unknown; preventDefault(): void };
type FileLike = { type: string };
type PasteEv = { target: unknown; clipboardData: { files: ArrayLike<FileLike>; getData(t: string): string } | null; preventDefault(): void };
type DragEv = { target: unknown; relatedTarget: unknown; dataTransfer: { types: ArrayLike<string>; files: ArrayLike<FileLike> } | null; preventDefault(): void };
type DownEv = { target: unknown };
const typingIn = (t: El | null): boolean => !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable === true);

function focusCard(id: string | null): void {
  if (!id) return;
  setTimeout(() => { const el = doc()?.querySelector(`[data-noteid="${id}"]`) as El | null; el?.focus?.({ preventScroll: false }); }, 30);
}

/** Reads a picked or pasted file as a data address a note keeps; null for anything that is not one of the image kinds. */
function readImage(file: unknown): Promise<string | null> {
  const FR = (globalThis as { FileReader?: new () => { onload: (() => void) | null; onerror: (() => void) | null; result: unknown; readAsDataURL(f: unknown): void } }).FileReader;
  if (!FR) return Promise.resolve(null);
  return new Promise((done) => {
    const r = new FR();
    r.onload = () => done(typeof r.result === "string" ? r.result : null);
    r.onerror = () => done(null);
    r.readAsDataURL(file);
  });
}

function pickFile(then: (uri: string) => void): void {
  const d = doc();
  if (!d) return;
  const input = d.createElement("input") as { type: string; accept: string; onchange: (() => void) | null; files?: ArrayLike<unknown>; click(): void };
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/gif,image/webp";
  input.onchange = () => { const f = input.files?.[0]; if (f) void readImage(f).then((u) => { if (u) then(u); }); };
  input.click();
}

export function NotesPage({ rt, nameOf, noteId = null, initial, store: given, phone: forcePhone, takeNonce = 0 }: NotesPageProps): ReactElement {
  ensureNotesCss();
  const store = useMemo(() => given ?? notesStoreFor(rt), [given, rt]);
  const data = useSyncExternalStore(store.subscribe, store.get, store.get);
  const width = useWindowDimensions().width;
  const phone = forcePhone ?? (width > 0 && width < NOTES_PHONE);
  const menu = useMenu();
  const who: Who = useMemo(() => ({ meId: rt.me.id, nameOf, spaceName: rt.space.name }), [rt.me.id, nameOf, rt.space.name]);
  const princ = useSyncExternalStore(rt.principals.subscribe, rt.principals.getSnapshot, rt.principals.getSnapshot);
  const people: Person[] = useMemo(() => (princ.status === "ready" ? princ.data.filter((p) => p.kind === "person" || p.kind === "agent").map((p) => ({ id: p.id, name: p.name, kind: p.kind === "agent" ? "agent" as const : "person" as const, ...(p.username ? { username: p.username } : {}) })) : []), [princ]);

  const [filter, setFilter] = useState<string[]>(initial?.filter ?? []);
  const [q, setQ] = useState(initial?.q ?? "");
  const [take, dispatch] = useReducer(takeStep, { ...CLOSED, ...initial?.take });
  const [openId, setOpenId] = useState<string | null>(initial?.open ?? null);
  const [shareId, setShareId] = useState<string | null>(initial?.share ?? null);
  const [askId, setAskId] = useState<string | null>(initial?.ask ?? null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [sel, setSel] = useState<string | null>(initial?.ask ?? null);
  const [bar, setBar] = useState<Bar | null>(null);
  const [focusBody, setFocusBody] = useState(0);
  const [dropping, setDropping] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [phoneOpen, setPhoneOpen] = useState<string | null>(initial?.phoneOpen ?? null);
  const [phoneSheet, setPhoneSheet] = useState<string | null>(initial?.phoneSheet ? initial.phoneOpen ?? null : null);
  const [types, setTypes] = useState<RecordType[] | null>(null);
  // the phone's search field shows from its icon (or while it holds words)
  const [finding, setFinding] = useState(false);
  const searchRef = useRef<ComponentRef<typeof TextInput> | null>(null);
  const rootRef = useRef<unknown>(null);

  // the latest of everything, for menus built once and for the document's key, paste and drop listeners
  const live = useRef({ filter, take, openId, shareId, askId, sheet, sel, bar, phone, phoneOpen, notes: data.notes });
  live.current = { filter, take, openId, shareId, askId, sheet, sel, bar, phone, phoneOpen, notes: data.notes };
  const noteOf = useCallback((id: string | null): Note | undefined => (id ? store.get().notes.find((n) => n.noteId === id) : undefined), [store]);

  const say = useCallback((text: string): void => setBar((b) => barStep(b, { t: "say", text })), []);
  useEffect(() => { store.setSay(say); }, [store, say]);
  useEffect(() => { void store.load(); }, [store]);
  // what changed in the Space (a note shared with you, a clip from Chrome) reads the list again, at most once a second
  useEffect(() => {
    if (!rt.changes) return undefined;
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = rt.changes.subscribe(() => { if (t === null) t = setTimeout(() => { t = null; void store.load(); }, 1000); });
    return () => { off(); if (t !== null) clearTimeout(t); };
  }, [rt, store]);
  // a line goes on its own; Undo stays a little longer
  useEffect(() => {
    if (bar === null) return undefined;
    const t = setTimeout(() => setBar(null), bar.undo ? UNDO_MS : SAY_MS);
    return () => clearTimeout(t);
  }, [bar]);
  // a search hit or a link opens its note once the notes are read
  const linked = useRef<string | null>(null);
  useEffect(() => {
    if (!noteId || linked.current === noteId || data.status !== "ready") return;
    linked.current = noteId;
    const open = (): void => { if (live.current.phone) setPhoneOpen(noteId); else { setOpenId(noteId); setSel(noteId); } };
    if (noteOf(noteId)) { open(); return; }
    void Promise.resolve(rt.call("notes.get", { noteId })).then(() => { void store.load().then(open); }, () => say("That note is gone, or it was not shared with you."));
  }, [noteId, data.status, noteOf, rt, store, say]);

  /* ---------- what the grid shows ---------- */
  const shown = useMemo(() => visibleNotes(data.notes, filter, q), [data.notes, filter, q]);
  const { pinned, others } = useMemo(() => splitPinned(shown), [shown]);
  const first = pinned[0]?.noteId ?? others[0]?.noteId ?? null;
  const tabStop = sel && shown.some((n) => n.noteId === sel) ? sel : first;
  const counts = useMemo(() => labelCounts(data.notes, data.labels), [data.notes, data.labels]);
  const clock = rt.clock();

  /* ---------- saving ---------- */
  const unfurl = useCallback((url: string): void => {
    dispatch({ t: "reading", url });
    void Promise.resolve(rt.call("automations.read_link", { url })).then(
      (o) => {
        const out = o as CapMap["automations.read_link"]["out"];
        const m = out.ok ? out.meta ?? {} : {};
        const link: LinkPreview = { url, siteName: m.siteName || hostOf(url), ...(m.title ? { title: m.title } : {}), ...(m.image && /^(https:\/\/|data:image\/)/.test(m.image) ? { image: m.image } : {}), ...(m.description ? { description: m.description } : {}) };
        dispatch({ t: "read", link });
      },
      () => dispatch({ t: "read", link: { url, siteName: hostOf(url) } }),
    );
  }, [rt]);
  const saveTake = useCallback((): void => {
    const t = live.current.take;
    if (!t.open) return;
    const input = createInput(t, key());
    dispatch({ t: "reset" });
    if (input === null) return;
    void store.create(input).then((n) => {
      if (!n) return;
      if (t.share === "space") void store.share(n.noteId, { space: "view" });
      if (t.share === "person") setShareId(n.noteId);
    });
  }, [store]);
  // the opened note saves as you type, half a second after the last key
  const pending = useRef<{ id: string; patch: { title?: string; body?: string }; t: ReturnType<typeof setTimeout> } | null>(null);
  const flush = useCallback((): void => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.t);
    pending.current = null;
    void store.update(p.id, p.patch);
  }, [store]);
  const edit = useCallback((id: string, patch: { title?: string; body?: string }): void => {
    const p = pending.current;
    const merged = p && p.id === id ? { ...p.patch, ...patch } : patch;
    if (p) { clearTimeout(p.t); if (p.id !== id) void store.update(p.id, p.patch); }
    pending.current = { id, patch: merged, t: setTimeout(flush, SAVE_MS) };
  }, [store, flush]);
  useEffect(() => () => flush(), [flush]);

  /* ---------- acts ---------- */
  const closeNote = useCallback((): void => { flush(); const id = live.current.openId; setOpenId(null); focusCard(id); }, [flush]);
  const openNote = useCallback((id: string): void => {
    if (live.current.phone) { setPhoneOpen(id); return; }
    setOpenId(id); setShareId(null); setSheet(null); setSel(id); setBar(null);
  }, []);
  const pin = useCallback((id: string): void => { const n = noteOf(id); if (!n) return; store.pin(id, !n.pinned); say(n.pinned ? "Unpinned" : "Pinned"); }, [noteOf, store, say]);
  const remove = useCallback((id: string): void => {
    const n = noteOf(id);
    if (!n) return;
    flush();
    if (live.current.openId === id) setOpenId(null);
    if (live.current.askId === id) setAskId(null);
    if (live.current.phoneOpen === id) setPhoneOpen(null);
    void store.remove(id).then((ok) => { if (ok) setBar((b) => barStep(b, { t: "deleted", noteId: id, mine: n.mine })); });
    // the focus goes to the next card
    const ids = live.current.notes.map((x) => x.noteId);
    focusCard(ids[ids.indexOf(id) + 1] ?? ids[ids.indexOf(id) - 1] ?? null);
  }, [noteOf, store, flush]);
  const undo = useCallback((): void => {
    const id = live.current.bar?.undo;
    if (!id) return;
    setBar((b) => barStep(b, { t: "undone" }));
    void store.restore(id).then((n) => { if (n) { setSel(n.noteId); focusCard(n.noteId); } });
  }, [store]);
  const share = useCallback((id: string): void => { const n = noteOf(id); if (!n?.mine) return; flush(); setShareId(id); }, [noteOf, flush]);
  const ask = useCallback((id: string): void => { flush(); setAskId(id); setSel(id); setOpenId(null); setSheet(null); setPhoneOpen(null); }, [flush]);
  const me: Person = useMemo(() => ({ id: rt.me.id, name: rt.me.name, kind: "person" }), [rt.me.id, rt.me.name]);
  const dues = useMemo(() => dueChoices(clock.now, clock.offsetMin), [clock.now, clock.offsetMin]);
  const toTask = useCallback((id: string, title?: string, due?: string): void => {
    const n = noteOf(id);
    if (!n) return;
    flush();
    setOpenId(null); setPhoneOpen(null);
    const d: DueChoice = dues.find((x) => x.label === due) ?? dues[dues.length - 1]!;
    setSheet({ kind: "task", noteId: id, done: null, draft: { title: title ?? (n.title || firstLine(n) || noteName(n)), who: me, due: d, keep: true } });
  }, [noteOf, flush, dues, me]);
  const loadTypes = useCallback((): Promise<RecordType[]> => {
    if (types !== null) return Promise.resolve(types);
    return Promise.resolve(rt.call("schema.describe", {})).then((o) => {
      const all = (o as CapMap["schema.describe"]["out"]).types;
      const list = [...all.filter((t) => !t.system), ...all.filter((t) => t.system)].map((t) => ({ key: t.key, title: t.title, plural: t.plural, titleField: t.titleField, ...(t.summaryField ? { summaryField: t.summaryField } : {}), fields: t.fields.map((f) => ({ key: f.key, type: f.type, title: f.title })) }));
      setTypes(list);
      return list;
    }, () => { setTypes([]); return []; });
  }, [rt, types]);
  const toRecord = useCallback((id: string, type?: string): void => {
    const n = noteOf(id);
    if (!n) return;
    flush();
    setOpenId(null); setPhoneOpen(null);
    setSheet({ kind: "record", noteId: id, done: null, draft: { type: "", fields: {}, keep: true } });
    void loadTypes().then((list) => {
      const t = list.find((x) => x.key === type) ?? list[0];
      if (t) setSheet((s) => (s && s.kind === "record" && s.noteId === id && s.draft.type === "" ? { ...s, draft: { ...s.draft, type: t.key, fields: fillFromNote(t, n) } } : s));
    });
  }, [noteOf, flush, loadTypes]);
  const make = useCallback((): void => {
    const s = live.current.sheet;
    if (!s || s.done) return;
    if (s.kind === "task") {
      const d = s.draft;
      if (d.title.trim() === "") return;
      void store.toTask({ noteId: s.noteId, title: d.title.trim(), assigned: { kind: d.who.kind, id: d.who.id }, ...(d.due.at !== null ? { due: d.due.at } : {}), keep: d.keep, idempotencyKey: key() })
        .then((done) => { if (done) setSheet((cur) => (cur && cur.kind === "task" && cur.noteId === s.noteId ? { ...cur, done } : cur)); });
    } else {
      const d = s.draft;
      const fields = Object.fromEntries(Object.entries(d.fields).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, v.trim()]));
      if (!d.type) return;
      void store.toRecord({ noteId: s.noteId, type: d.type, fields, keep: d.keep, idempotencyKey: key() }).then((out) => {
        if (!out) return;
        const t = types?.find((x) => x.key === d.type);
        setSheet((cur) => (cur && cur.kind === "record" && cur.noteId === s.noteId ? { ...cur, done: { recordId: out.recordId, type: d.type, name: t ? d.fields[t.titleField] ?? "" : "" } } : cur));
      });
    }
  }, [store, types]);
  const closeSheet = useCallback((): void => {
    const s = live.current.sheet;
    setSheet(null);
    if (s?.done) say(s.kind === "task" ? `${s.done.key ?? "Task"} made from the note` : "Record made from the note");
    if (s) focusCard(s.noteId);
  }, [say]);
  const closeShare = useCallback((): void => { const id = live.current.shareId; setShareId(null); if (!live.current.openId) focusCard(id); }, []);
  const copyLink = useCallback((id: string): void => {
    const clip = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard;
    void clip?.writeText(`vyre://note/${id}`);
    say("Link copied. Only people it is shared with can open it");
  }, [say]);
  const duplicate = useCallback((id: string): void => {
    const n = noteOf(id);
    if (!n) return;
    const img = fromDataUri(store.image(id) ?? "");
    void store.create({ idempotencyKey: key(), title: `${noteName(n)} (copy)`, ...(n.body ? { body: n.body } : {}), ...(n.color ? { color: n.color } : {}), ...(n.labels.length ? { labels: n.labels } : {}), ...(n.link ? { link: n.link.url } : {}), ...(img ? { image: { data: img.data, contentType: img.contentType } } : {}) })
      .then((c) => { if (c) say("Copy made. It is private"); });
  }, [noteOf, store, say]);
  const setImage = useCallback((id: string | "take"): void => {
    pickFile((uri) => {
      const img = fromDataUri(uri);
      if (!img) { say("A note keeps PNG, JPEG, GIF or WebP images."); return; }
      if (id === "take") { dispatch({ t: "image", image: img }); setFocusBody((n) => n + 1); }
      else void store.update(id, { image: { data: img.data, contentType: img.contentType } });
    });
  }, [store, say]);
  const openTake = useCallback((): void => { dispatch({ t: "open" }); setFocusBody((n) => n + 1); }, []);
  useEffect(() => { if (takeNonce > 0) openTake(); }, [takeNonce, openTake]);
  // on a phone an opened note is its own page
  useEffect(() => { if (phone && openId) { setPhoneOpen(openId); setOpenId(null); } }, [phone, openId]);
  // a bar that starts with a link being read (a screenshot of a paste) reads it
  useEffect(() => { if (initial?.take?.reading) unfurl(initial.take.reading); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- menus (ui/Menu) ---------- */
  const colourItems = useCallback((target: string): MenuEntry[] => {
    const cur: NoteColor = target === "take" ? live.current.take.color : noteOf(target)?.color ?? "";
    return [{ head: "Colour" }, ...COLORS.map(([c, name]): MenuItem => ({
      label: name, checked: cur === c, leading: <Swatch fill={noteFill(c)} on={cur === c} />,
      onSelect: () => { if (target === "take") dispatch({ t: "color", c }); else void store.update(target, { color: c }); },
    }))];
  }, [noteOf, store]);
  const colourMenu = useCallback((target: string, x: number, y: number): void => menu.show(colourItems(target), x, y, "other"), [menu, colourItems]);
  const labelQuery = useRef("");
  const labelItems = useCallback((target: string): MenuEntry[] => {
    const cur = target === "take" ? live.current.take.labels : noteOf(target)?.labels ?? [];
    const all = labelCounts(store.get().notes, store.get().labels).map((l) => l.name);
    for (const l of cur) if (!all.includes(l)) all.push(l);
    const typed = labelQuery.current.trim();
    const set = (name: string, on: boolean): void => {
      if (target === "take") dispatch({ t: "label", name }); else store.label(target, name, on);
      setTimeout(() => menu.update(labelItems(target)), 0);
    };
    const items: MenuEntry[] = all.map((name): MenuItem => ({ label: name, keep: true, leading: <TickBox on={cur.includes(name)} size={15} />, onSelect: () => set(name, !cur.includes(name)) }));
    if (typed && !all.some((l) => l.toLowerCase() === typed.toLowerCase())) {
      items.push({ label: `Make “${typed.slice(0, 40)}”`, pinned: true, keep: true, leading: <Ico name="plus" size={14} color="var(--ink-3)" />, onSelect: () => { store.addLabel(typed.slice(0, 40)); set(typed.slice(0, 40), true); } });
    }
    return items;
  }, [noteOf, store, menu]);
  const labelMenu = useCallback((target: string, x: number, y: number): void => {
    labelQuery.current = "";
    menu.show(labelItems(target), x, y, "other", undefined, { search: "Find or make a label", onSearch: (t) => { labelQuery.current = t; menu.update(labelItems(target)); } });
  }, [menu, labelItems]);
  const filterItems = useCallback((): MenuEntry[] => {
    const f = live.current.filter;
    const flip = (k: string): void => { const next = toggle(live.current.filter, k); live.current.filter = next; setFilter(next); setTimeout(() => menu.update(filterItems()), 0); };
    const rows = labelCounts(store.get().notes, store.get().labels);
    return [
      { head: "Show notes with" },
      ...rows.map((l): MenuItem => ({ label: l.name, count: l.count, keep: true, leading: <TickBox on={f.includes(l.name)} size={15} />, onSelect: () => flip(l.name) })),
      { separator: true },
      ...SPECIAL.map((sp): MenuItem => ({ label: sp.label, keep: true, leading: <TickBox on={f.includes(sp.key)} size={15} />, onSelect: () => flip(sp.key) })),
      ...(f.length ? [{ separator: true } as const, { label: "Clear the filter", leading: <Ico name="x" size={14} color="var(--ink-3)" />, onSelect: () => { setFilter([]); setQ(""); } } as MenuItem] : []),
    ];
  }, [store, menu]);
  const filterMenu = useCallback((x: number, y: number): void => menu.show(filterItems(), x, y, "other", undefined, { width: 240 }), [menu, filterItems]);
  const noteItems = useCallback((id: string): MenuEntry[] => {
    const n = noteOf(id);
    if (!n) return [];
    const at = (): { x: number; y: number } => { const el = doc()?.querySelector(`[data-noteid="${id}"]`) as El | null; const r = el?.getBoundingClientRect?.(); return r ? { x: r.left, y: r.bottom - 40 } : { x: -1, y: -1 }; };
    return [
      { label: "Open", icon: icoSvg("note"), hint: "Enter", onSelect: () => openNote(id) },
      { label: n.pinned ? "Unpin" : "Pin", icon: icoSvg(n.pinned ? "pinf" : "pin"), hint: "P", onSelect: () => pin(id) },
      ...(n.canEdit ? [{ label: "Colour", icon: icoSvg("palette"), onSelect: () => { const p = at(); setTimeout(() => colourMenu(id, p.x, p.y), 0); } }] : []),
      { label: "Labels", icon: icoSvg("tag"), hint: "L", onSelect: () => { const p = at(); setTimeout(() => labelMenu(id, p.x, p.y), 0); } },
      ...(n.mine ? [{ label: "Share", icon: icoSvg("share"), hint: "S", onSelect: () => share(id) }] : []),
      { separator: true },
      { label: "Ask about this note", icon: icoSvg("ask"), hint: "A", onSelect: () => ask(id) },
      { label: "Turn into task", icon: icoSvg("task"), hint: "T", onSelect: () => toTask(id) },
      { label: "Turn into record", icon: icoSvg("record"), hint: "R", onSelect: () => toRecord(id) },
      { separator: true },
      { label: "Copy link", icon: icoSvg("link"), onSelect: () => copyLink(id) },
      { label: "Make a copy", icon: icoSvg("copy"), onSelect: () => duplicate(id) },
      n.mine ? { label: "Delete", icon: icoSvg("trash"), hint: "Del", danger: true, onSelect: () => remove(id) } : { label: "Remove from my notes", icon: icoSvg("x"), hint: "Del", danger: true, onSelect: () => remove(id) },
    ];
  }, [noteOf, openNote, pin, colourMenu, labelMenu, share, ask, toTask, toRecord, copyLink, duplicate, remove]);
  const noteMenu = useCallback((id: string, x: number, y: number, from: "button" | "context"): void => { setSel(id); menu.show(noteItems(id), x, y, from === "context" ? "context" : "other", { label: `note:${id}` }); }, [menu, noteItems]);
  const phoneItems = useCallback((id: string): MenuEntry[] => {
    const n = noteOf(id);
    if (!n) return [];
    return [
      { label: "Ask about this note", icon: icoSvg("ask", 18), onSelect: () => ask(id) },
      { label: "Turn into task", icon: icoSvg("task", 18), onSelect: () => toTask(id) },
      { label: "Turn into record", icon: icoSvg("record", 18), onSelect: () => toRecord(id) },
      { separator: true },
      ...(n.mine ? [{ label: "Share", icon: icoSvg("share", 18), onSelect: () => share(id) }] : []),
      { label: n.pinned ? "Unpin" : "Pin", icon: icoSvg(n.pinned ? "pinf" : "pin", 18), onSelect: () => pin(id) },
      { label: "Make a copy", icon: icoSvg("copy", 18), onSelect: () => duplicate(id) },
      { label: n.mine ? "Delete" : "Remove from my notes", icon: icoSvg("trash", 18), danger: true, onSelect: () => remove(id) },
    ];
  }, [noteOf, ask, toTask, toRecord, share, pin, duplicate, remove]);
  const moreMenu = useCallback((x: number, y: number): void => menu.show([
    { label: "Grid", icon: icoSvg("grid"), checked: view === "grid", onSelect: () => setView("grid") },
    { label: "List", icon: icoSvg("list"), checked: view === "list", onSelect: () => setView("list") },
    { separator: true },
    { label: "Take a note", icon: icoSvg("edit"), hint: "C", onSelect: openTake },
    { label: "Search notes", icon: icoSvg("search"), hint: "/", onSelect: () => searchRef.current?.focus?.() },
  ], x, y, "other"), [menu, view, openTake]);
  const whoMenu = useCallback((x: number, y: number): void => {
    const cur = live.current.take.share;
    menu.show([
      { head: "Who can see it" },
      { label: "Private", icon: icoSvg("lock"), checked: cur === "private", hint: "Only you", onSelect: () => dispatch({ t: "share", v: "private" }) },
      { label: "Share with a person", icon: icoSvg("people"), checked: cur === "person", onSelect: () => dispatch({ t: "share", v: "person" }) },
      { label: rt.space.name, icon: icoSvg("globe"), checked: cur === "space", hint: "Everyone in the Space", onSelect: () => dispatch({ t: "share", v: "space" }) },
    ], x, y, "other");
  }, [menu, rt.space.name]);
  const takeMenu = useCallback((x: number, y: number): void => menu.show([
    { label: "Take a note", icon: icoSvg("edit"), hint: "C", onSelect: openTake },
    { label: "Add an image", icon: icoSvg("image"), onSelect: () => setImage("take") },
  ], x, y, "context", { label: "take" }), [menu, openTake, setImage]);

  // the label filter starts open (a screenshot of it)
  useEffect(() => {
    if (!initial?.filterMenu || data.status !== "ready") return undefined;
    const t = setTimeout(() => { const el = doc()?.querySelector("[data-testid='notes-labels']") as El | null; const r = el?.getBoundingClientRect?.(); filterMenu(r ? r.left : 600, r ? r.bottom + 4 : 48); }, 60);
    return () => clearTimeout(t);
  }, [initial?.filterMenu, data.status]);   // eslint-disable-line react-hooks/exhaustive-deps
  // a sheet the page starts on (screenshots)
  const started = useRef(false);
  useEffect(() => {
    if (started.current || data.status !== "ready") return;
    started.current = true;
    if (initial?.task) toTask(initial.task.noteId, initial.task.title, initial.task.due);
    if (initial?.record) toRecord(initial.record.noteId, initial.record.type);
  }, [data.status]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- keys, paste and drop, on the document while the page is on screen ---------- */
  const shownNow = useCallback((): boolean => {
    const el = rootRef.current as El | null;
    return !!el && (el.getClientRects?.().length ?? 1) > 0;
  }, []);
  useEffect(() => {
    const d = doc();
    if (!d) return undefined;
    const onKey = (e: KeyEv): void => {
      if (!shownNow()) return;
      const t = e.target as unknown as El | null;
      if (t?.closest?.("[role=menu]") || t?.closest?.("[data-testid='menu-layer']")) return;
      const L = live.current;
      const inAsk = !!t?.closest?.("[data-testid='notes-ask-pane']");
      const inTake = !!t?.closest?.("[data-ntake]");
      const top = topLayer({ sheet: L.sheet !== null, share: L.shareId !== null, note: L.openId !== null, take: L.take.open, ask: L.askId !== null, bar: L.bar !== null }, inAsk, inTake);
      const lk = layerKey(e, top);
      if (lk !== null && !(top === "take" && typingIn(t))) {
        e.preventDefault();
        if (top === "sheet") { if (lk === "make") make(); else closeSheet(); }
        else if (top === "share") closeShare();
        else if (top === "note") closeNote();
        else if (top === "take") saveTake();
        else if (top === "ask") { const id = L.askId; setAskId(null); focusCard(id); }
        else if (top === "bar") setBar(null);
        return;
      }
      if (L.sheet || L.shareId || L.openId || L.phoneOpen) return;
      const typing = typingIn(t);
      const pk = pageKey(e, typing, !!L.bar?.undo);
      if (pk) {
        e.preventDefault();
        if (pk.t === "search") searchRef.current?.focus?.();
        else if (pk.t === "take") openTake();
        else undo();
        return;
      }
      if (typing) return;
      const card = t?.closest?.("[data-noteid]");
      const id = card?.getAttribute?.("data-noteid");
      if (!card || !id) return;
      const ck = cardKey(e);
      if (!ck || ck.t === "menu") return;
      e.preventDefault();
      switch (ck.t) {
        case "move": {
          const boxes: Box[] = [];
          const all = d.querySelectorAll("[data-noteid]");
          for (let i = 0; i < all.length; i++) { const el = all[i] as El; const r = el.getBoundingClientRect?.(); const nid = el.getAttribute?.("data-noteid"); if (r && nid) boxes.push({ id: nid, left: r.left, top: r.top, width: r.width, height: r.height }); }
          const from = boxes.find((b) => b.id === id);
          const to = from ? nearest(from, boxes, ck.dir as Dir) : null;
          if (to) { setSel(to); const el = d.querySelector(`[data-noteid="${to}"]`) as El | null; el?.focus?.(); el?.scrollIntoView?.({ block: "nearest" }); }
          return;
        }
        case "open": openNote(id); return;
        case "pin": pin(id); return;
        case "labels": { const r = card.getBoundingClientRect?.(); labelMenu(id, r ? r.left + 8 : -1, r ? r.bottom - 36 : -1); return; }
        case "share": share(id); return;
        case "ask": ask(id); return;
        case "task": toTask(id); return;
        case "record": toRecord(id); return;
        case "delete": remove(id); return;
      }
    };
    const onPaste = (e: PasteEv): void => {
      const L = live.current;
      if (!shownNow() || L.sheet || L.shareId || L.openId || L.phoneOpen) return;
      const t = e.target as unknown as El | null;
      const inTake = !!t?.closest?.("[data-ntake]");
      const inField = typingIn(t) && !inTake;
      const dt = e.clipboardData;
      if (!dt) return;
      const files: { type: string; f: unknown }[] = [];
      for (let i = 0; i < dt.files.length; i++) { const f = dt.files[i]!; files.push({ type: f.type, f }); }
      const kind = pasteKind({ files, text: dt.getData("text/plain") ?? "" }, inField);
      if (kind === null || (kind.kind === "text" && inTake)) return;
      e.preventDefault();
      if (kind.kind === "image") void readImage(files[kind.index]!.f).then((u) => { const img = u ? fromDataUri(u) : null; if (img) { dispatch({ t: "image", image: img }); setFocusBody((n) => n + 1); } });
      else if (kind.kind === "link") { unfurl(kind.url); setFocusBody((n) => n + 1); }
      else { dispatch({ t: "paste-text", text: kind.text }); setFocusBody((n) => n + 1); }
    };
    const hasFiles = (e: DragEv): boolean => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onOver = (e: DragEv): void => { if (!shownNow() || !hasFiles(e)) return; e.preventDefault(); setDropping(true); };
    const onLeave = (e: DragEv): void => { if (!e.relatedTarget) setDropping(false); };
    const onDrop = (e: DragEv): void => {
      setDropping(false);
      if (!shownNow() || !hasFiles(e)) return;
      e.preventDefault();
      const f = Array.from(e.dataTransfer?.files ?? []).find((x) => x.type.startsWith("image/"));
      if (!f) return;
      const t = e.target as unknown as El | null;
      const card = t?.closest?.("[data-noteid]")?.getAttribute?.("data-noteid");
      const onto = card && !t?.closest?.("[data-ntake]") ? noteOf(card) : undefined;
      void readImage(f).then((u) => {
        const img = u ? fromDataUri(u) : null;
        if (!img) { say("A note keeps PNG, JPEG, GIF or WebP images."); return; }
        if (onto?.canEdit) void store.update(onto.noteId, { image: { data: img.data, contentType: img.contentType } });
        else { dispatch({ t: "image", image: img }); setFocusBody((n) => n + 1); }
      });
    };
    // a press outside the open bar saves it (a press in a menu it opened does not)
    const onDown = (e: DownEv): void => {
      if (!live.current.take.open || !shownNow()) return;
      const t = e.target as unknown as El | null;
      if (t?.closest?.("[data-ntake]") || t?.closest?.("[data-testid='menu-layer']") || t?.closest?.("[role=menu]")) return;
      saveTake();
    };
    d.addEventListener("keydown", onKey as never);
    d.addEventListener("paste", onPaste as never, true);
    d.addEventListener("dragover", onOver as never);
    d.addEventListener("dragleave", onLeave as never);
    d.addEventListener("drop", onDrop as never);
    d.addEventListener("pointerdown", onDown as never, true);
    return () => {
      d.removeEventListener("keydown", onKey as never);
      d.removeEventListener("paste", onPaste as never, true);
      d.removeEventListener("dragover", onOver as never);
      d.removeEventListener("dragleave", onLeave as never);
      d.removeEventListener("drop", onDrop as never);
      d.removeEventListener("pointerdown", onDown as never, true);
    };
  }, [shownNow, make, closeSheet, closeShare, closeNote, saveTake, openTake, undo, openNote, pin, labelMenu, share, ask, toTask, toRecord, remove, unfurl, noteOf, store, say]);

  /* ---------- drawing ---------- */
  const cardActs: CardActions = useMemo(() => ({
    open: openNote, pin, share, ask, focus: (id) => setSel(id),
    menu: noteMenu, colour: (id, x, y) => colourMenu(id, x, y), labels: (id, x, y) => labelMenu(id, x, y),
    sheet: (id) => setPhoneSheet(id),
  }), [openNote, pin, share, ask, noteMenu, colourMenu, labelMenu]);
  // ui-rows-lint: not a list (note cards in a masonry grid)
  const cards = (list: readonly Note[]): ReactElement[] => list.map((n) => (
    <NoteCard key={n.noteId} n={n} image={n.hasImage ? store.image(n.noteId) : null} who={who} selected={!phone && (askId === n.noteId || sel === n.noteId)} tabbable={tabStop === n.noteId} phone={phone} a={cardActs} />
  ));
  const grid = (list: readonly Note[], id: string): ReactElement => (web
    ? createElement("div", { "data-testid": id, style: { ...(phone ? { columnCount: 2, columnGap: 10 } : view === "list" ? { columnCount: 1, maxWidth: 600, margin: "0 auto" } : { columnWidth: 236, columnGap: 14 }), marginBottom: 22 } }, cards(list))
    : <View testID={id} style={{ marginBottom: 22 }}>{cards(list)}</View>);
  const section = (label: string): ReactElement => <Text accessibilityRole="header" style={st.gsec}>{label}</Text>;

  let body: ReactElement;
  if (data.status === "failed" && data.notes.length === 0) {
    body = (
      <View style={st.empty} testID="notes-failed">
        <Text style={st.emptyH}>Could not read your notes</Text>
        <Text style={st.emptyP}>Check the connection and try again.</Text>
        <View style={{ marginTop: 14 }}><Btn label="Try again" sm onPress={() => void store.load()} testID="notes-retry" /></View>
      </View>
    );
  } else if (data.status === "loading") {
    body = <View testID="notes-loading" style={{ height: 200 }} />;
  } else if (data.notes.length === 0) {
    body = <Empty />;
  } else if (shown.length === 0) {
    body = (
      <View style={[st.empty, { marginTop: 30 }]} testID="notes-no-match">
        <Text style={st.emptyH}>No notes match</Text>
        <Text style={st.emptyP}>{q ? `Nothing has “${q}”.` : "No notes have this label."}</Text>
        <View style={{ marginTop: 14 }}><Btn label="Clear the filter" sm onPress={() => { setFilter([]); setQ(""); }} testID="notes-clear" /></View>
      </View>
    );
  } else {
    body = pinned.length
      ? <>{section("Pinned")}{grid(pinned, "notes-pinned")}{others.length ? <>{section("Others")}{grid(others, "notes-others")}</> : null}</>
      : grid(others, "notes-others");
  }

  const open = noteOf(openId);
  const shareNote = noteOf(shareId);
  const sheetNote = noteOf(sheet?.noteId ?? null);
  const askNote = noteOf(askId);
  const phoneNote = noteOf(phoneOpen);
  const sheetNoteFor = noteOf(phoneSheet);
  const edited = (n: Note): string => editedWords(n, clock.now, clock.offsetMin);
  const choices: Person[] = useMemo(() => [me, { id: rt.assistant.id, name: rt.assistant.name, kind: "agent" as const }, ...people.filter((p) => p.id !== me.id && p.id !== rt.assistant.id)], [me, rt.assistant.id, rt.assistant.name, people]);

  let layer: ReactElement | null = null;
  if (sheet && sheetNote) {
    layer = sheet.kind === "task"
      ? <TaskSheet n={sheetNote} draft={sheet.draft} setDraft={(d) => setSheet({ ...sheet, draft: d })} done={sheet.done} choices={choices} dues={dues} onMake={make} onOpenTask={(id) => { setSheet(null); rt.open({ subject: { type: "task", id } }); }} onClose={closeSheet} />
      : <RecordSheet n={sheetNote} types={types} draft={sheet.draft} setDraft={(d) => setSheet({ ...sheet, draft: d })} done={sheet.done} onMake={make} onOpenRecord={(id, type) => { setSheet(null); rt.open({ subject: { type: "record", id }, args: { type } }); }} onClose={closeSheet} />;
  } else if (shareNote) {
    layer = <ShareSheet n={shareNote} who={who} people={people} onShare={(p) => void store.share(shareNote.noteId, p)} onCopyLink={() => copyLink(shareNote.noteId)} onClose={closeShare} />;
  } else if (open && !phone) {
    layer = (
      <NoteDialog
        key={open.noteId} n={open} image={open.hasImage ? store.image(open.noteId) : null} who={who} edited={edited(open)}
        a={{
          title: (v) => edit(open.noteId, { title: v }), body: (v) => edit(open.noteId, { body: v }), pin: () => pin(open.noteId), colour: (x, y) => colourMenu(open.noteId, x, y),
          labels: (x, y) => labelMenu(open.noteId, x, y), image: () => setImage(open.noteId), share: () => share(open.noteId), menu: (x, y) => noteMenu(open.noteId, x, y, "button"),
          ask: () => ask(open.noteId), task: () => toTask(open.noteId), record: () => toRecord(open.noteId), close: closeNote,
          openLinked: (kind, id) => rt.open({ subject: { type: kind, id } }), openUrl: (u) => rt.openUrl(u),
        }}
      />
    );
  }

  const takeEl = (
    <TakeNote
      take={take} dispatch={dispatch as (a: TakeAct) => void} close={saveTake} pickImage={() => setImage("take")} colour={(x, y) => colourMenu("take", x, y)} labels={(x, y) => labelMenu("take", x, y)}
      who={whoMenu} menu={takeMenu} spaceName={rt.space.name} dropping={dropping} focusBody={focusBody}
    />
  );
  const askPane = askNote ? (
    <View style={phone ? st.askPhone : st.ask} testID="notes-ask-pane">
      <AskPane about={{}} paneKey="notes-ask" idPrefix="notes-ask" hint={askWords(askNote)} onClose={() => { setAskId(null); focusCard(askNote.noteId); }}>
        <View style={st.about} testID="notes-ask-about">
          <View style={[st.aboutIcon, { backgroundColor: noteFill(askNote.color) }]}><Ico name="note" size={15} color="var(--ink-3)" /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.aboutK}>About this note</Text>
            <Text numberOfLines={1} style={st.aboutT}>{noteName(askNote)}</Text>
            {firstLine(askNote) ? <Text numberOfLines={1} style={st.aboutS}>{firstLine(askNote)}</Text> : null}
          </View>
          <IconBtn icon="note" label="Open the note" iconSize={14} onPress={() => openNote(askNote.noteId)} testID="notes-ask-open" />
        </View>
        <View style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          <RecordsAssistant rt={rt} about={{}} scope={askScope(askNote)} />
        </View>
      </AskPane>
    </View>
  ) : null;
  const toast = bar ? (
    <View style={st.toastWrap} pointerEvents="box-none">
      <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={st.toast} testID="notes-bar">
        <Text numberOfLines={1} style={st.toastText}>{bar.text}</Text>
        {bar.undo ? <Pressable accessibilityRole="button" accessibilityLabel="Undo" onPress={undo} style={st.toastBtn} testID="notes-undo"><Text style={st.toastAct} {...dom({ dataSet: { nbaract: "true" } })}>Undo</Text></Pressable> : null}
        <IconBtn icon="x" label="Dismiss" iconSize={13} size={24} color="color-mix(in srgb, var(--win) 60%, transparent)" onPress={() => setBar(null)} testID="notes-bar-dismiss" />
      </View>
    </View>
  ) : null;

  if (phone) {
    return (
      <View ref={rootRef as never} style={st.root} testID="notes-page">
        <ScrollView style={{ flex: 1 }} contentContainerStyle={st.phoneBody}>
          <View style={st.phoneHead}>
            <Text accessibilityRole="header" aria-level={1} style={st.plt}>Notes</Text>
            <View style={{ flex: 1 }} />
            <IconBtn icon="tag" label={filterLabel(filter)} size={40} iconSize={20} on={filter.length > 0} color="var(--ink-2)" onPress={filterMenu} testID="notes-labels" />
            <IconBtn icon="search" label="Search notes" size={40} iconSize={20} on={finding} color="var(--ink-2)" onPress={() => { setFinding((f) => !f); setTimeout(() => searchRef.current?.focus?.(), 30); }} testID="notes-find" />
          </View>
          {finding || q ? (
            <View style={[st.nsearch, st.nsearchPhone]} {...dom({ dataSet: { nfield: "true" } })}>
              <Ico name="search" size={13} color="var(--ink-3)" />
              <TextInput ref={searchRef} value={q} onChangeText={setQ} placeholder="Search notes" placeholderTextColor="var(--ink-3)" accessibilityLabel="Search notes" testID="notes-search" style={st.nsearchInput} />
            </View>
          ) : null}
          {take.open ? takeEl : null}
          {body}
        </ScrollView>
        {take.open ? null : (
          <View style={st.ptake} testID="notes-phone-take" {...dom({ dataSet: { nfadebg: "true" } })}>
            <Pressable accessibilityRole="button" accessibilityLabel="Take a note" onPress={openTake} style={st.ptakeBar} testID="take-closed">
              <Text style={st.ptakeText}>Take a note</Text>
              <IconBtn icon="image" label="Add an image" size={36} iconSize={22} onPress={() => setImage("take")} testID="take-image-closed" />
            </Pressable>
          </View>
        )}
        {phoneNote ? (
          <PhoneNote
            key={phoneNote.noteId} n={phoneNote} image={phoneNote.hasImage ? store.image(phoneNote.noteId) : null} who={who} edited={edited(phoneNote)}
            a={{
              back: () => { flush(); setPhoneOpen(null); }, pin: () => pin(phoneNote.noteId), share: () => share(phoneNote.noteId), colour: (x, y) => colourMenu(phoneNote.noteId, x, y), labels: (x, y) => labelMenu(phoneNote.noteId, x, y),
              image: () => setImage(phoneNote.noteId), more: () => setPhoneSheet(phoneNote.noteId), title: (v) => edit(phoneNote.noteId, { title: v }), body: (v) => edit(phoneNote.noteId, { body: v }),
            }}
          />
        ) : null}
        {sheetNoteFor ? <ActionSheet entries={phoneItems(sheetNoteFor.noteId)} onClose={() => setPhoneSheet(null)} /> : null}
        {askPane}
        {layer}
        {toast}
        {menu.element}
      </View>
    );
  }

  const n = data.notes.length;
  return (
    <View ref={rootRef as never} style={st.root} testID="notes-page">
      <View style={st.head}>
        <View style={st.ti}>
          <Text accessibilityRole="header" aria-level={1} style={st.tt}>Notes</Text>
          <Text numberOfLines={1} style={st.ts}>{n ? `${n} · private unless you share` : "Private unless you share"}</Text>
        </View>
        <View style={st.nsearch} {...dom({ dataSet: { nfield: "true" } })}>
          <Ico name="search" size={13} color="var(--ink-3)" />
          <TextInput
            ref={searchRef} value={q} onChangeText={setQ} placeholder="Search notes" placeholderTextColor="var(--ink-3)" accessibilityLabel="Search notes" testID="notes-search" style={st.nsearchInput}
            onKeyPress={(e) => { if ((e.nativeEvent as { key?: string }).key === "Escape") { if (q) setQ(""); else searchRef.current?.blur?.(); } }}
          />
          <Keycap text="/" />
        </View>
        <Pressable
          accessibilityRole="button" accessibilityLabel={`Show notes with a label: ${filterLabel(filter)}`} testID="notes-labels"
          onPress={(e) => { const p = pressPoint(e); filterMenu(p.x, p.y); }} style={[st.lfb, filter.length ? st.lfbOn : null]} {...dom({ dataSet: { nbtn: "ghost" } })}
        >
          <Ico name="tag" size={14} color={filter.length ? "var(--ink)" : "var(--ink-3)"} />
          <Text numberOfLines={1} style={[st.lfbText, filter.length ? { color: "var(--ink)" } : null]}>{filterLabel(filter)}</Text>
          <View style={{ transform: [{ rotate: "90deg" }] }}><Ico name="chev" size={10} color="var(--ink-4)" /></View>
        </Pressable>
        <IconBtn icon="more" label="More" iconSize={15} onPress={moreMenu} testID="notes-more" />
      </View>
      <View style={st.stage}>
        <View style={st.center}>
          <ScrollView style={st.feed} contentContainerStyle={st.feedIn} testID="notes-feed">
            <View style={st.wrap}>
              {takeEl}
              {body}
            </View>
          </ScrollView>
          {toast}
        </View>
        {askPane}
      </View>
      {layer}
      {menu.element}
    </View>
  );
}

/** What the assistant is told in Ask about this note: the note, by id and name. It reads the note itself with notes_get, which follows the note's audience. */
function askScope(n: Note): AskScope {
  const name = noteName(n);
  return {
    type: "note", id: n.noteId, title: name,
    context: { title: `Notes, ${name}`, open: [{ type: "note", id: n.noteId, title: name }], actions: ["read the note with notes_get", "sum it up", "say what is still open", "draft a reply from it", "suggest a task"] } as AskScope["context"],
  };
}

function Empty(): ReactElement {
  const way = (icon: "edit" | "image" | "link" | "clip", text: string): ReactElement => (
    <View style={st.way}><Ico name={icon} size={15} color="var(--ink-4)" /><Text style={st.wayText}>{text}</Text></View>
  );
  return (
    <View style={st.empty} testID="notes-empty">
      <View style={st.art}><Ico name="note" size={40} color="var(--ink-4)" /></View>
      <Text style={st.emptyH}>No notes yet</Text>
      <Text style={st.emptyP}>Take a note above, paste anything into it, or clip a page from Vyre for Chrome. Notes are private until you share them.</Text>
      <View style={st.ways}>
        {way("edit", "Type, or press C")}
        {way("image", "Paste or drop an image")}
        {way("link", "Paste a link, it becomes a card")}
        {way("clip", "Clip a page from Vyre for Chrome")}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0, minWidth: 0, backgroundColor: "var(--win)" as string, position: "relative" },
  head: { height: 48, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 20, paddingRight: 10 },
  ti: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "baseline", gap: 8 },
  tt: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  ts: { fontSize: 12.5, color: "var(--ink-3)" as string, flexShrink: 1 },
  nsearch: { flexDirection: "row", alignItems: "center", gap: 7, height: 28, width: 220, paddingLeft: 9, paddingRight: 6, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  nsearchPhone: { width: "100%", height: 36, marginBottom: 6 },
  nsearchInput: { flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--ink)" as string, ...(web ? ({ outlineStyle: "none" } as object) : null) },
  lfb: { flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingHorizontal: 8, borderRadius: 8, maxWidth: 220 },
  lfbOn: { backgroundColor: "var(--sel)" as string },
  lfbText: { fontSize: 12.5, color: "var(--ink-3)" as string, flexShrink: 1 },
  stage: { flex: 1, minHeight: 0, flexDirection: "row" },
  center: { flex: 1, minWidth: 0, position: "relative" },
  feed: { flex: 1, minHeight: 0 },
  feedIn: { paddingTop: 8, paddingBottom: 120, alignItems: "center" },
  wrap: { width: "100%", maxWidth: 1144, paddingHorizontal: 32 },
  gsec: { fontSize: 11.5, fontWeight: "500", color: "var(--ink-4)" as string, marginTop: 6, marginHorizontal: 4, marginBottom: 10 },
  ask: { minHeight: 0, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string },
  askPhone: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, zIndex: 25, backgroundColor: "var(--win)" as string },
  about: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginHorizontal: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: "var(--sunk)" as string },
  aboutIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", ...(web ? ({ boxShadow: "inset 0 0 0 1px var(--line)" } as object) : null) },
  aboutK: { fontSize: 11.5, color: "var(--ink-4)" as string },
  aboutT: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string, marginTop: 1 },
  aboutS: { fontSize: 12, color: "var(--ink-3)" as string, marginTop: 2 },
  toastWrap: { position: "absolute", left: 0, right: 0, bottom: 20, alignItems: "center", zIndex: 30 },
  toast: { flexDirection: "row", alignItems: "center", gap: 10, height: 40, paddingLeft: 14, paddingRight: 6, borderRadius: 12, backgroundColor: "var(--ink)" as string, maxWidth: "92%", ...(web ? ({ boxShadow: "var(--sh-pop)" } as object) : null) },
  toastText: { fontSize: 13, color: "var(--win)" as string, flexShrink: 1 },
  toastBtn: { height: 28, paddingHorizontal: 10, borderRadius: 8, justifyContent: "center" },
  toastAct: { fontSize: 13, fontWeight: "600" },
  empty: { alignItems: "center", alignSelf: "center", marginTop: 56, maxWidth: 380, width: "100%" },
  art: { width: 88, height: 88, borderRadius: 24, backgroundColor: "var(--sunk)" as string, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  emptyH: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string, textAlign: "center" },
  emptyP: { fontSize: 13.5, lineHeight: 20, color: "var(--ink-3)" as string, marginTop: 6, textAlign: "center" },
  ways: { marginTop: 20, gap: 2, width: "100%" },
  way: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 32 },
  wayText: { fontSize: 13, color: "var(--ink-2)" as string },
  phoneBody: { paddingHorizontal: 14, paddingBottom: 170 },
  phoneHead: { flexDirection: "row", alignItems: "center", marginTop: 4, marginHorizontal: 4, marginBottom: 8 },
  plt: { fontSize: 32, fontWeight: "700", letterSpacing: -0.6, color: "var(--ink)" as string },
  ptake: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingVertical: 10 },
  ptakeBar: { height: 46, borderRadius: 14, backgroundColor: "var(--raised)" as string, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 16, paddingRight: 8, ...(web ? ({ boxShadow: "var(--sh-2)" } as object) : null) },
  ptakeText: { flex: 1, fontSize: 15, color: "var(--ink-3)" as string },
});
