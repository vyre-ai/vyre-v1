// Calendar > event pane (lane l-calevents, owner 3 Nov; the prototype's #calnext and #calevent): a click on an event opens it beside the calendar, where it was pressed (on a phone, in a
// sheet). Title, when in your time zone and how it repeats, the calendar, who organised it, a big Join button, Going? Yes, No or Maybe, Edit, Prepare, Ask and More (Copy Link,
// Delete); where it is and what it is about, with its links; who is coming and how each answered. A past meeting shows its close-out (summary, tasks, Open close-out) and the
// recording or transcript. Edit happens in place; a repeating event asks This Event or All Events on Save. Everything goes through capabilities as the person.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Row } from "../../../../../../../ui/src/Row/index.tsx";
import { Recipients } from "../../../../../../../ui/src/Recipients/index.tsx";
import { useMenu } from "../../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../../ui/src/Menu/index.tsx";
import { useInboxData } from "../../sidebar/data.tsx";
import { pointOf } from "../../sidebar/parts.tsx";
import { Icon } from "../icons.tsx";
import { LENGTHS, lengthText } from "../model.ts";
import type { CalendarRow } from "../model.ts";
import {
  RESPONSE_LABEL, RSVP, editDraft, editInput, ended, eventLink, guestName, linkParts, repeatsLine, rsvpSummary, undoInput, whenLine, zoneName,
} from "./model.ts";
import type { Closeout, EditDraft, EventFull, EventRow, Prep, Response } from "./model.ts";

export interface EventPaneNav {
  join(url: string): void;
  openUrl(url: string): void;
  openRecord(recordId: string): void;
  openMeeting(meetingId: string): void;
  openFile(fileId: string): void;
  ask(e: EventRow): void;
}

export interface EventPaneProps {
  eventId: string;
  calendars: readonly CalendarRow[];
  /** email to name, for guests the invitation does not name */
  names: ReadonlyMap<string, string>;
  /** directory for the guest field when editing */
  directory: readonly { name: string; email: string; kind: "team"; sub: string }[];
  me: string;
  /** start in edit (a double-click on the event) */
  editing?: boolean;
  /** inside the phone's sheet: the sheet already carries the title and Done */
  inSheet?: boolean;
  /** bumped when the calendar re-read its events: the pane reads the event again */
  stamp: string;
  nav: EventPaneNav;
  onClose(): void;
  /** a change with Undo, for the calendar's status line */
  onUndo(label: string, run: () => Promise<unknown>): void;
  onDeleted(e: EventRow): void;
}

const READY = (s: string): boolean => s === "ready";

function Btn({ label, onPress, primary = false, icon, testID, disabled = false }: { label: string; onPress: (x: number, y: number) => void; primary?: boolean; icon?: Parameters<typeof Icon>[0]["name"]; testID: string; disabled?: boolean }): ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} testID={testID} disabled={disabled} onPress={(e) => { const p = pointOf(e); onPress(p.x, p.y); }}
      style={({ hovered }: { hovered?: boolean }) => [st.btn, primary && PRIMARY, !primary && hovered === true && st.btnOver]}>
      {icon ? <Icon name={icon} size={13} color={primary ? "var(--win)" : "var(--ink-2)"} /> : null}
      <Text style={[st.btnText, primary && st.btnTextP]}>{label}</Text>
    </Pressable>
  );
}

function Section({ title, aside, children, testID }: { title: string; aside?: string; children: ReactElement | ReactElement[] | null; testID: string }): ReactElement {
  return (
    <View style={st.sec} testID={testID}>
      <View style={st.secHead}><Text style={st.secTitle}>{title}</Text>{aside ? <Text style={st.secAside} numberOfLines={1}>{aside}</Text> : null}</View>
      {children}
    </View>
  );
}

export function EventPane(p: EventPaneProps): ReactElement {
  const data = useInboxData();
  const menu = useMenu();
  const c = data.clock();
  const [full, setFull] = useState<EventFull | null>(null);
  const [missing, setMissing] = useState(false);
  const [rev, setRev] = useState(0);
  const [edit, setEdit] = useState<EditDraft | null>(null);
  const [err, setErr] = useState("");
  const [close, setClose] = useState<Closeout | null>(null);
  const [rec, setRec] = useState<{ fileId?: string; transcript: boolean } | null>(null);
  const [tx, setTx] = useState<string[] | null>(null);
  const [prep, setPrep] = useState<Prep | null>(null);
  const [prepShut, setPrepShut] = useState(false);

  // the event, again whenever the calendar re-read its events or the pane changed it
  useEffect(() => {
    let live = true;
    void Promise.resolve(data.call("calendar.get_event", { eventId: p.eventId })).then((o) => { if (live) { setFull(o as EventFull); setMissing(false); } }, () => { if (live) setMissing(true); });
    return () => { live = false; };
  }, [data, p.eventId, p.stamp, rev]);
  const e = full?.event;
  useEffect(() => { if (p.editing && e && !edit) setEdit(editDraft(e, c.offsetMin)); }, [p.editing, e?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- a double-click starts the edit once the event is here
  const past = e ? ended(e, c.now) : false;

  // a past meeting: its close-out and its recording; one still to come: the prep notes, read again while the Assistant works
  useEffect(() => {
    let live = true;
    setClose(null); setRec(null); setTx(null);
    if (!e?.meetingId || !past) return;
    const mid = e.meetingId;
    void Promise.resolve(data.call("meetings.closeout.get", { meetingId: mid })).then((o) => { if (live) setClose(o as Closeout); }, () => undefined);
    void Promise.resolve(data.call("meetings.get", { meetingId: mid })).then((o) => {
      const m = o as { recordingFileId?: string; meeting?: { hasTranscript?: boolean } };
      if (live && (m.recordingFileId || m.meeting?.hasTranscript)) setRec({ ...(m.recordingFileId ? { fileId: m.recordingFileId } : {}), transcript: m.meeting?.hasTranscript === true });
    }, () => undefined);
    return () => { live = false; };
  }, [data, e?.meetingId, past]);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (!e || past) { setPrep(null); return; }
    const read = (): void => {
      void Promise.resolve(data.call("meetings.prep.get", { eventId: e.id })).then((o) => {
        if (!live) return;
        const v = o as Prep;
        setPrep(v);
        if (v.state === "working") timer = setTimeout(read, 4000);
      }, () => undefined);
    };
    read();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [data, e?.id, past, rev]);

  const run = async (cap: string, input: Record<string, unknown>): Promise<unknown> => {
    setErr("");
    try { const out = await data.call(cap, input); setRev((r) => r + 1); return out; } catch (x) { setErr((x as { message?: string }).message || "That did not go through. Try again."); throw x; }
  };

  if (missing) return <View style={st.pane} testID="event-pane"><Text style={st.quiet}>This event is not there any more.</Text></View>;
  if (!e) return <View style={st.pane} testID="event-pane-loading" accessibilityLabel="Loading"><View style={st.skTitle} /><View style={st.skLine} /></View>;

  const cal = p.calendars.find((x) => x.id === e.calendarId);
  const tz = zoneName(e.startsAt);
  const repeats = repeatsLine(full?.repeats, e.startsAt, c.offsetMin);
  const organiser = e.organizer ? (full?.mine?.email === e.organizer ? "you" : guestName(e.attendees.find((a) => a.email === e.organizer) ?? { email: e.organizer }, p.names)) : "";
  const mine = full?.mine;
  const canAnswer = !!mine && !past && mine.email !== e.organizer;

  const save = (scope: "this" | "all"): void => {
    if (!edit) return;
    const got = editInput(e, edit, c.offsetMin);
    if (!got.ok) { setErr(got.error); return; }
    if (Object.keys(got.patch).length === 0) { setEdit(null); return; }
    const undo = undoInput(e, got.patch);
    void run("calendar.update_event", { eventId: e.id, ...got.patch, ...(e.seriesId ? { scope } : {}) }).then((o) => {
      setEdit(null);
      const n = (o as { changed?: number }).changed;
      p.onUndo(scope === "all" && n ? `Saved ${n} events` : `Saved “${(got.patch["title"] as string | undefined) ?? e.title}”`, () => data.call("calendar.update_event", { eventId: e.id, ...undo, ...(e.seriesId ? { scope } : {}) }));
    }, () => undefined);
  };
  const onSave = (x: number, y: number): void => {
    if (!e.seriesId) { save("this"); return; }
    menu.show([{ head: repeats ? `Repeats: ${repeats}` : "This event repeats" }, { label: "This Event", onSelect: () => save("this") }, { label: "All Events", onSelect: () => save("all") }], x, y);
  };
  const more = (x: number, y: number): void => {
    const entries: MenuEntry[] = [
      { label: "Copy Link", onSelect: () => { void (globalThis as { navigator?: { clipboard?: { writeText(s: string): Promise<void> } } }).navigator?.clipboard?.writeText(eventLink(e.id))?.catch(() => undefined); p.onUndo("Link copied", async () => undefined); } },
      { label: "Ask About This", onSelect: () => p.nav.ask(e) },
      ...(e.recordIds[0] ? [{ label: "Open Record", onSelect: () => p.nav.openRecord(e.recordIds[0]!) }] : []),
      { separator: true },
      { label: "Delete", danger: true, onSelect: () => { void run("calendar.delete_event", { eventId: e.id }).then(() => p.onDeleted(e), () => undefined); } },
    ];
    menu.show(entries, x, y);
  };
  const lenMenu = (x: number, y: number): void => {
    if (!edit) return;
    menu.show([{ head: "Length" }, ...LENGTHS.map((m) => ({ label: lengthText(m), checked: m === edit.minutes, onSelect: () => setEdit({ ...edit, minutes: m }) }))], x, y);
  };

  // ---- the parts
  const head = edit ? (
    <View style={st.edit} testID="event-edit">
      <TextInput value={edit.title} onChangeText={(t) => setEdit({ ...edit, title: t })} accessibilityLabel="Title" placeholder="Title" placeholderTextColor="var(--ink-4)" testID="event-edit-title" style={[st.input, st.inputTitle]} autoFocus />
      <View style={st.editRow}>
        <TextInput value={edit.day} onChangeText={(t) => setEdit({ ...edit, day: t })} accessibilityLabel="Day, as 2026-11-07" testID="event-edit-day" style={[st.input, st.grow]} />
        <TextInput value={edit.time} onChangeText={(t) => setEdit({ ...edit, time: t })} accessibilityLabel="Starts, as 14:30" testID="event-edit-time" style={[st.input, st.time]} />
        <Pressable accessibilityRole="button" accessibilityLabel="Length" testID="event-edit-length" onPress={(x) => { const q = pointOf(x); lenMenu(q.x, q.y); }} style={({ hovered }: { hovered?: boolean }) => [st.pick, hovered === true && st.btnOver]}>
          <Text style={st.pickText}>{lengthText(edit.minutes)}</Text><Icon name="chevd" size={9} />
        </Pressable>
      </View>
    </View>
  ) : (
    <View>
      {p.inSheet ? null : <Text accessibilityRole="header" aria-level={2} style={st.title} testID="event-title">{e.title}</Text>}
      <Text style={st.when} testID="event-when">{whenLine(e, c.offsetMin)}{repeats ? ` · ${repeats}` : ""}{tz ? <Text style={st.tz}>{` · ${tz}`}</Text> : null}</Text>
    </View>
  );
  const meta = (
    <View style={st.meta}>
      {cal ? <View style={st.metaRow}><View style={[st.dot, { backgroundColor: cal.color }]} /><Text style={st.metaText} testID="event-calendar">{cal.title}</Text></View> : null}
      {organiser ? <Text style={st.metaText} testID="event-organiser">Organised by <Text style={st.metaBold}>{organiser}</Text></Text> : null}
      {e.location ? <View style={st.metaRow}><Icon name="pin" size={13} /><Text style={st.metaText} testID="event-location">{e.location}</Text></View> : null}
    </View>
  );
  const join = e.joinUrl && !past && !edit ? (
    <Pressable accessibilityRole="button" accessibilityLabel={`Join ${e.joinProvider === "meet" ? "Google Meet" : e.joinProvider === "zoom" ? "Zoom" : e.joinProvider === "teams" ? "Teams" : "the call"}`} testID="event-join"
      onPress={() => p.nav.join(e.joinUrl!)} style={({ hovered }: { hovered?: boolean }) => [st.join, hovered === true && st.joinOver]}>
      <Icon name="video" size={15} color="var(--win)" /><Text style={st.joinText}>{`Join ${e.joinProvider === "meet" ? "Google Meet" : e.joinProvider === "zoom" ? "Zoom" : e.joinProvider === "teams" ? "Teams" : "the call"}`}</Text>
    </Pressable>
  ) : null;
  const rsvp = canAnswer && !edit ? (
    <View style={st.rsvp} testID="event-rsvp">
      <Text style={st.rsvpLabel}>Going?</Text>
      <View style={st.seg} accessibilityRole="radiogroup" accessibilityLabel="Going?">
        {/* ui-rows-lint: not a list (the three parts of one Going? control) */}
        {RSVP.map((r) => {
          const on = mine?.response === r.response;
          return (
            <Pressable key={r.response} accessibilityRole="radio" accessibilityState={{ checked: on }} aria-checked={on} testID={`event-rsvp-${r.response}`}
              onPress={() => { const was: Response = mine?.response ?? "needs_action"; void run("calendar.respond", { eventId: e.id, response: r.response }).then(() => { if (was !== "needs_action" && was !== r.response) p.onUndo(`${RESPONSE_LABEL[r.response]}`, () => data.call("calendar.respond", { eventId: e.id, response: was })); }, () => undefined); }}
              style={({ hovered }: { hovered?: boolean }) => [st.segBtn, on && st.segOn, !on && hovered === true && st.btnOver]}>
              <Text style={[st.segText, on && st.segTextOn]}>{r.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  ) : null;
  const actions = edit ? (
    <View style={st.actions}>
      <Btn label="Cancel" testID="event-edit-cancel" onPress={() => { setEdit(null); setErr(""); }} />
      <Btn label="Save" primary testID="event-edit-save" onPress={onSave} />
    </View>
  ) : (
    <View style={st.actions}>
      <Btn label="Edit" icon="pen" testID="event-edit-btn" onPress={() => setEdit(editDraft(e, c.offsetMin))} />
      {past ? null : <Btn label="Prepare" icon="spark" testID="event-prepare" onPress={() => { setPrepShut(false); void run("meetings.prep.start", { eventId: e.id }).catch(() => undefined); }} disabled={prep?.state === "working"} />}
      <Btn label="Ask" icon="chat" testID="event-ask" onPress={() => p.nav.ask(e)} />
      <View style={st.grow} />
      <Pressable accessibilityRole="button" accessibilityLabel="More" testID="event-more" onPress={(x) => { const q = pointOf(x); more(q.x, q.y); }} style={({ hovered }: { hovered?: boolean }) => [st.icon, hovered === true && st.btnOver]}><Icon name="more" size={15} /></Pressable>
    </View>
  );
  const prepCard = !past && prep && prep.state !== "none" && !prepShut ? (
    <View style={st.prep} testID="event-prep">
      <View style={st.prepHead}><Icon name="spark" size={13} color="var(--accent)" /><Text style={st.prepTitle}>{prep.state === "working" ? "Your Assistant is preparing notes from the attendees' records and past meetings" : "Prep notes"}</Text></View>
      {READY(prep.state) ? <>
        {/* ui-rows-lint: not a list (lines of one note) */}
        {prep.notes.map((n, i) => <Text key={i} style={st.prepLine}>{`• ${n}`}</Text>)}
      </> : null}
      {READY(prep.state) ? (
        <View style={st.prepFoot}>
          <Btn label="Copy" testID="event-prep-copy" onPress={() => { void (globalThis as { navigator?: { clipboard?: { writeText(s: string): Promise<void> } } }).navigator?.clipboard?.writeText(prep.notes.join("\n"))?.catch(() => undefined); }} />
          <Btn label="Close" testID="event-prep-close" onPress={() => setPrepShut(true)} />
        </View>
      ) : null}
    </View>
  ) : null;
  const description = e.description && !edit ? (
    <Text style={st.desc} testID="event-description">
      {/* ui-rows-lint: not a list (the words and links of one paragraph) */}
      {linkParts(e.description).map((part, i) => (part.url ? <Text key={i} accessibilityRole="link" style={st.link} onPress={() => p.nav.openUrl(part.url!)}>{part.text}</Text> : <Text key={i}>{part.text}</Text>))}
    </Text>
  ) : null;
  const guests = edit ? (
    <Section title="Attendees" testID="event-guests">
      <View style={st.recip}><Recipients to={edit.people} me={p.me} directory={[...p.directory]} onChange={(r) => setEdit({ ...edit, people: [...r.to] })} testID="event-edit-people" /></View>
    </Section>
  ) : e.attendees.length ? (
    <Section title="Attendees" aside={rsvpSummary(e.attendees)} testID="event-guests">
      {e.attendees.map((a) => (
        <Row key={a.email} id={`guest:${a.email}`} title={guestName(a, p.names)} {...(a.email === e.organizer ? { titleSuffix: "Organiser" } : mine?.email === a.email ? { titleSuffix: "You" } : {})}
          trailing={<Text style={[st.resp, a.response === "accepted" && st.respYes, a.response === "declined" && st.respNo]} testID={`guest-response:${a.email}`}>{RESPONSE_LABEL[a.response ?? "needs_action"]}</Text>}
          {...(a.contactId ? { onPress: () => p.nav.openRecord(a.contactId!) } : {})} />
      ))}
    </Section>
  ) : null;
  const closeout = past && close ? (
    <Section title="Close-out" aside={close.state === "ready" ? `${close.items.filter((i) => i.status === "proposed").length} to approve` : close.state === "closed" ? "Closed" : close.state === "preparing" ? "Preparing" : "Nothing to do"} testID="event-closeout">
      <>
        {close.summary ? <Text style={st.desc}>{close.summary}</Text> : null}
        {close.items.filter((i) => i.kind === "task").slice(0, 6).map((i) => (
          <Row key={i.itemId} id={`closeout-task:${i.itemId}`} title={i.title} note={i.status === "approved" ? "Task created" : i.status === "skipped" ? "Skipped" : "Waiting for approval"}
            leading={<View style={st.taskMark}><Icon name={i.status === "approved" ? "check" : "task"} size={12} /></View>} />
        ))}
        <View style={st.actions}><Btn label="Open close-out" testID="event-open-closeout" onPress={() => p.nav.openMeeting(e.meetingId!)} /></View>
      </>
    </Section>
  ) : null;
  const recording = past && rec ? (
    <Section title={rec.fileId ? "Recording" : "Transcript"} testID="event-recording">
      <>
        <View style={st.actions}>
          {rec.fileId ? <Btn label="Open recording" icon="video" testID="event-open-recording" onPress={() => p.nav.openFile(rec.fileId!)} /> : null}
          {rec.transcript ? <Btn label={tx ? "Hide transcript" : "Transcript"} testID="event-transcript" onPress={() => {
            if (tx) { setTx(null); return; }
            void Promise.resolve(data.call("meetings.transcript.get", { meetingId: e.meetingId, limit: 60 })).then((o) => setTx(((o as { segments: { speaker?: string; text: string }[] }).segments).map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text))), () => setTx([]));
          }} /> : null}
        </View>
        {/* ui-rows-lint: not a list (the lines of a transcript, read not picked) */}
        {tx ? <View style={st.tx} testID="event-transcript-text">{tx.length ? tx.map((l, i) => <Text key={i} style={st.txLine}>{l}</Text>) : <Text style={st.quiet}>No words in it yet.</Text>}</View> : null}
      </>
    </Section>
  ) : null;

  return (
    <View style={st.pane} testID="event-pane" accessibilityLabel={e.title}>
      {p.inSheet ? null : (
        <View style={st.top}>
          <View style={st.grow} />
          <Pressable accessibilityRole="button" accessibilityLabel="Close" testID="event-close" onPress={p.onClose} style={({ hovered }: { hovered?: boolean }) => [st.icon, hovered === true && st.btnOver]}><Icon name="x" size={14} /></Pressable>
        </View>
      )}
      <ScrollView style={st.scroll} contentContainerStyle={st.scrollIn}>
        {head}
        {meta}
        {join}
        {rsvp}
        {actions}
        {err ? <Text style={st.err} accessibilityRole="alert" testID="event-error">{err}</Text> : null}
        {prepCard}
        {description}
        {guests}
        {closeout}
        {recording}
      </ScrollView>
      {menu.element}
    </View>
  );
}

const PRIMARY = { backgroundColor: "var(--ink)" };
const st = StyleSheet.create({
  pane: { flex: 1, minHeight: 0, backgroundColor: "var(--side)" as string },
  top: { height: 40, flexDirection: "row", alignItems: "center", paddingHorizontal: 8 },
  scroll: { flex: 1 },
  scrollIn: { paddingHorizontal: 18, paddingTop: 2, paddingBottom: 28, gap: 10 },
  grow: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, lineHeight: 21, fontWeight: "600", letterSpacing: -0.16, color: "var(--ink)" as string },
  when: { fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string, marginTop: 3 },
  tz: { color: "var(--ink-4)" as string },
  meta: { gap: 4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  metaText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  metaBold: { color: "var(--ink-2)" as string, fontWeight: "500" },
  dot: { width: 8, height: 8, borderRadius: 8 },
  join: { height: 38, borderRadius: 9, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "var(--accent)" as string, marginTop: 4 },
  joinOver: { opacity: 0.92 },
  joinText: { fontSize: 13.5, fontWeight: "600", color: "var(--win)" as string },
  rsvp: { flexDirection: "row", alignItems: "center", gap: 8 },
  rsvpLabel: { fontSize: 12.5, color: "var(--ink-3)" as string },
  seg: { flexDirection: "row", borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 7, overflow: "hidden" },
  segBtn: { height: 26, paddingHorizontal: 12, justifyContent: "center", borderRightWidth: 1, borderRightColor: "var(--line)" as string },
  segOn: { backgroundColor: "var(--ink)" as string },
  segText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  segTextOn: { color: "var(--win)" as string, fontWeight: "500" },
  actions: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  btn: { height: 28, paddingHorizontal: 10, borderRadius: 7, flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: "var(--line)" as string },
  btnOver: { backgroundColor: "var(--hover)" as string },
  btnText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink)" as string },
  btnTextP: { color: "var(--win)" as string },
  icon: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  err: { fontSize: 12.5, color: "var(--danger)" as string },
  quiet: { fontSize: 12.5, color: "var(--ink-3)" as string, padding: 18 },
  desc: { fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string },
  link: { color: "var(--accent)" as string },
  sec: { gap: 4, marginTop: 6 },
  secHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  secTitle: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string, textTransform: "uppercase", letterSpacing: 0.3 },
  secAside: { flex: 1, textAlign: "right", fontSize: 11.5, color: "var(--ink-4)" as string },
  resp: { fontSize: 11.5, color: "var(--ink-4)" as string },
  respYes: { color: "var(--ok, #2e9a78)" as string },
  respNo: { color: "var(--danger)" as string },
  taskMark: { width: 18, alignItems: "center", marginRight: 6 },
  prep: { borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 9, padding: 10, gap: 4, backgroundColor: "var(--win)" as string },
  prepHead: { flexDirection: "row", alignItems: "center", gap: 7 },
  prepTitle: { flex: 1, fontSize: 12.5, fontWeight: "600", color: "var(--ink)" as string },
  prepLine: { fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string },
  prepFoot: { flexDirection: "row", gap: 6, marginTop: 4 },
  tx: { gap: 3, maxHeight: 280 },
  txLine: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-2)" as string },
  edit: { gap: 8 },
  editRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: { height: 32, borderRadius: 8, borderWidth: 1, borderColor: "var(--field-line)" as string, backgroundColor: "var(--field)" as string, paddingHorizontal: 10, fontSize: 13, color: "var(--ink)" as string, outlineStyle: "none" as "none", minWidth: 0 },
  inputTitle: { fontSize: 15, fontWeight: "600" },
  time: { width: 76 },
  pick: { height: 30, paddingHorizontal: 8, borderRadius: 7, flexDirection: "row", alignItems: "center", gap: 5 },
  pickText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  recip: { minHeight: 34 },
  skTitle: { height: 14, width: "60%", borderRadius: 6, margin: 18, backgroundColor: "var(--hover)" as string },
  skLine: { height: 10, width: "40%", borderRadius: 5, marginHorizontal: 18, backgroundColor: "var(--hover)" as string },
});
