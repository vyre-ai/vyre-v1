// The pieces of the conversation feed (spec 2.18, 3.3), drawn from the prototype's Inbox: an email (the quoted text folded, attachments, record chips), a run of text bubbles, a call with its
// player, summary and transcript, an agent's draft with its Gate line. Colours are skin tokens, so a skin switch repaints with no re-render.
import { createElement, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { each } from "./each.ts";
import { Icon } from "./icons.tsx";
import type { IconName } from "./icons.tsx";
import { Face } from "../sidebar/parts.tsx";
import { callLabel, clockTime, deliveryNote, duration, firstName, sendsLine, isMine, isMissed, msgPreview, partyName, recipientLine, roleLine, senderName, sizeLabel, whenLabel, withLine } from "./model.ts";
import type { DraftCard, FeedEntry, ThreadMsg } from "./model.ts";

type EmailEntry = Extract<FeedEntry, { kind: "email" }>;
type TextsEntry = Extract<FeedEntry, { kind: "texts" }>;
type CallEntry = Extract<FeedEntry, { kind: "call" }>;

const hover = ({ hovered }: { hovered?: boolean }): boolean => hovered === true;

export function DaySep({ label }: { label: string }): ReactElement {
  return (
    <View style={s.daysep} testID={`day:${label}`}>
      <View style={s.rule} /><Text style={s.dayText}>{label}</Text><View style={s.rule} />
    </View>
  );
}

function Via({ name }: { name?: string | undefined }): ReactElement | null {
  return name ? <Text style={s.via} numberOfLines={1}>{name}</Text> : null;
}

/** One email. `quoteOpen` is controlled by the feed, so the folded quote is one click and one piece of state. */
export function EmailItem({ e, who, offsetMin, quoteOpen, onQuote, onAttachment, onChip }: {
  e: EmailEntry; who: string; offsetMin: number; quoteOpen: boolean; onQuote(): void; onAttachment?(name: string): void; onChip?(title: string, recordId?: string): void;
}): ReactElement {
  const r = e.ref;
  const out = e.item.direction === "out";
  const name = out ? (r.agent ?? "You") : who;
  const bad = deliveryNote(r.status);
  return (
    <View style={s.em} testID={`email:${e.item.id}`}>
      <View style={s.eh}>
        <Icon name="mail" size={14} />
        <Text style={[s.ehName, out && s.ehOut]}>{name}</Text>
        <View style={s.grow} />
        <Via name={r.via} />
        <Text style={s.time}>{clockTime(e.item.at, offsetMin)}</Text>
      </View>
      {r.subject ? <Text style={s.sj} accessibilityRole="header" aria-level={3}>{r.subject}</Text> : null}
      {r.body ? <Text style={s.bd} selectable>{r.body}</Text> : null}
      {bad ? <Text style={s.bad} testID={`delivery:${e.item.id}`}>{bad}</Text> : null}
      {r.quoted ? (
        <View style={s.qt}>
          <Pressable
            accessibilityRole="button" accessibilityLabel={quoteOpen ? "Hide quoted text" : "Show quoted text"} accessibilityState={{ expanded: quoteOpen }} testID={`quote-toggle:${e.item.id}`}
            onPress={onQuote} style={(st: { hovered?: boolean }) => [s.qtb, hover(st) && s.qtbOver]}
          >
            <Icon name="more" size={12} />
          </Pressable>
          {quoteOpen ? <Text style={s.qx} testID={`quote:${e.item.id}`}>{r.quoted}</Text> : null}
        </View>
      ) : null}
      {r.attachments && r.attachments.length > 0 ? (
        <View style={s.atts}>
          {each(r.attachments, (a) => (
            <Pressable key={a.name} accessibilityRole="button" accessibilityLabel={`Open ${a.name}`} testID={`attachment:${a.name}`} onPress={() => onAttachment?.(a.name)} style={(st: { hovered?: boolean }) => [s.att, hover(st) && s.attOver]}>
              <Icon name="file" size={14} /><Text style={s.attText}>{a.name}</Text>{a.size ? <Text style={s.attSize}>{a.size}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      {r.chips && r.chips.length > 0 ? (
        <View style={s.chips}>
          {each(r.chips, (c) => (
            <Pressable key={c.title} accessibilityRole="link" accessibilityLabel={`Open record ${c.title}`} testID={`chip:${c.title}`} onPress={() => onChip?.(c.title, c.recordId)} style={(st: { hovered?: boolean }) => [s.rc, hover(st) && s.rcOver]}>
              <Icon name="link" size={12} /><Text style={s.rcText}>{c.title}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** A run of texts from one side and one number: bubbles close together, one line under them with the number and the time of the last. */
export function Bubbles({ t, offsetMin }: { t: TextsEntry; offsetMin: number }): ReactElement {
  const out = t.direction === "out";
  return (
    <View style={[s.sg, out && s.sgOut]} testID={`texts:${t.key}`}>
      {each(t.items, (b, i) => (
        <View key={b.id} testID={`bubble:${b.id}`} style={[s.bub, out ? s.bubOut : s.bubIn, i === 0 && (out ? s.bubFirstOut : s.bubFirstIn)]}>
          <Text style={[s.bubText, out && s.bubTextOut]} selectable>{b.body}</Text>
        </View>
      ))}
      <View style={s.smeta}>
        <Icon name="sms" size={12} />
        <Text style={s.metaText}>{t.via ? `${t.via} · ` : ""}{clockTime(t.at, offsetMin)}</Text>
      </View>
    </View>
  );
}

/** The recording of a call or voicemail. A web build plays the file; where there is no audio the bar still moves for the length of the call. */
export function Player({ id, url, durationSec }: { id: string; url?: string | undefined; durationSec?: number | undefined }): ReactElement {
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const audio = useRef<{ play(): Promise<void> | void; pause(): void; currentTime: number; duration: number } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const width = useRef(0);
  const total = durationSec ?? 0;
  useEffect(() => () => { if (timer.current !== null) clearInterval(timer.current); audio.current?.pause(); }, []);

  const stopTimer = (): void => { if (timer.current !== null) { clearInterval(timer.current); timer.current = null; } };
  const toggle = (): void => {
    if (playing) { audio.current?.pause(); stopTimer(); setPlaying(false); return; }
    const Ctor = (globalThis as { Audio?: new (src: string) => EventTarget & NonNullable<typeof audio.current> }).Audio;
    if (Platform.OS === "web" && url && Ctor) {
      if (!audio.current) {
        const a = new Ctor(url);
        a.addEventListener("timeupdate", () => setPos(a.duration > 0 ? a.currentTime / a.duration : 0));
        a.addEventListener("ended", () => { setPlaying(false); setPos(0); });
        audio.current = a;
      }
      void audio.current.play();
      setPlaying(true);
      return;
    }
    setPlaying(true);
    timer.current = setInterval(() => setPos((p) => {
      const next = p + 0.25 / Math.max(1, total);
      if (next >= 1) { stopTimer(); setPlaying(false); return 0; }
      return next;
    }), 250);
  };
  const seek = (ratio: number): void => {
    const r = Math.max(0, Math.min(1, ratio));
    setPos(r);
    if (audio.current && audio.current.duration > 0) audio.current.currentTime = r * audio.current.duration;
  };
  return (
    <View style={s.player} testID={`player:${id}`}>
      <Pressable accessibilityRole="button" accessibilityLabel={playing ? "Pause" : "Play"} testID={`play:${id}`} onPress={toggle} style={(st: { hovered?: boolean }) => [s.pb, hover(st) && s.pbOver]}>
        <Icon name={playing ? "stop" : "play"} size={11} color="var(--accent-ink)" />
      </Pressable>
      <Pressable
        accessibilityRole="adjustable" accessibilityLabel="Seek" testID={`seek:${id}`} style={s.bar}
        onLayout={(e: { nativeEvent: { layout: { width: number } } }) => { width.current = e.nativeEvent.layout.width; }}
        onPress={(e: { nativeEvent: { locationX?: number } }) => { if (width.current > 0 && typeof e.nativeEvent.locationX === "number") seek(e.nativeEvent.locationX / width.current); }}
      >
        <View style={[s.barFill, { width: `${Math.round(pos * 100)}%` as unknown as number }]} />
      </Pressable>
      <Text style={s.dur}>{duration(total)}</Text>
    </View>
  );
}

export function CallLine({ c, offsetMin, open, onTranscript }: { c: CallEntry; offsetMin: number; open: boolean; onTranscript(): void }): ReactElement {
  const missed = isMissed(c.ref);
  const icon: IconName = c.meeting ? "cal" : c.ref.state === "voicemail" ? "vm" : "call";
  const label = callLabel(c.ref, c.item.direction, c.meeting);
  const hasPlayer = c.ref.recording === true || c.ref.state === "voicemail";
  const lines = c.ref.transcript ?? [];
  return (
    <View style={[s.cl, missed && s.clMissed]} testID={`call:${c.item.id}`}>
      <View style={s.ch}>
        <Icon name={icon} size={15} color={missed ? "var(--danger)" : "var(--ink-3)"} />
        <Text style={[s.chLabel, missed && s.chMissed]}>{label}</Text>
        {missed || c.ref.durationSec === undefined ? null : <Text style={s.chDur}>{duration(c.ref.durationSec)}</Text>}
        <View style={s.grow} />
        <Via name={c.ref.via} />
        <Text style={s.time}>{clockTime(c.item.at, offsetMin)}</Text>
      </View>
      {hasPlayer ? <Player id={c.item.id} url={c.ref.recordingUrl} durationSec={c.ref.durationSec} /> : null}
      {c.ref.summary ? <Text style={s.sm}>{c.ref.summary}</Text> : null}
      {lines.length > 0 ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Transcript" accessibilityState={{ expanded: open }} testID={`transcript-toggle:${c.item.id}`} onPress={onTranscript} style={(st: { hovered?: boolean }) => [s.tlink, hover(st) && s.tlinkOver]}>
          <View style={open ? s.chevOpen : undefined}><Icon name="chevr" size={10} color="var(--accent)" /></View><Text style={s.tlinkText}>Transcript</Text>
        </Pressable>
      ) : null}
      {open ? (
        <View style={s.tx} testID={`transcript:${c.item.id}`}>
          {each(lines, (l, i) => <Text key={i} style={s.txLine}><Text style={s.txWho}>{l.who}</Text>{` ${l.text}`}</Text>)}
        </View>
      ) : null}
      {c.ref.notes ? <Text style={s.notes}>Notes: {c.ref.notes}</Text> : null}
    </View>
  );
}

/** A record link or a note: one quiet centred line. */
export function QuietLine({ text, testID }: { text: string; testID: string }): ReactElement {
  return (
    <View style={s.ev} testID={testID}><View style={s.evdot} /><Text style={s.evText}>{text}</Text></View>
  );
}

/** An agent's draft: what it would send, from which inbox, the Gate line, and Send, Edit and Discard. */
export interface DraftEditing { text: string; subject: string; loading?: boolean }
export function DraftBlock({ d, note, busy, offsetMin = 0, editing = null, onChange, onSave, onCancel, onSend, onEdit, onDiscard }: {
  d: DraftCard; note?: string | undefined; busy: boolean; offsetMin?: number; editing?: DraftEditing | null;
  onChange?(next: { text: string; subject: string }): void; onSave?(): void; onCancel?(): void; onSend(): void; onEdit(): void; onDiscard(): void;
}): ReactElement {
  const [showEarlier, setShowEarlier] = useState(false);
  return (
    <View style={s.dr} testID={`draft:${d.id}`}>
      <View style={s.dh}>
        <Face name={d.agent} size={20} round={false} />
        <Text style={s.dhText}><Text style={s.dhName}>{d.agent}</Text> drafted a {d.channel === "sms" ? "text" : "reply"}{d.earlier ? <Text style={s.dhUpdated} testID={`draft-updated:${d.id}`}>{` · Updated ${clockTime(d.updatedAt, offsetMin)}`}</Text> : null}</Text>
        <View style={s.grow} />
        <Via name={d.via} />
      </View>
      {editing ? (
        <View testID={`draft-editor:${d.id}`} style={s.dEdit}>
          {d.channel === "email" ? <TextInput accessibilityLabel="Subject" testID={`draft-edit-subject:${d.id}`} value={editing.subject} onChangeText={(subject) => onChange?.({ text: editing.text, subject })} style={s.dEditSj} /> : null}
          <TextInput accessibilityLabel="Draft" testID={`draft-edit-body:${d.id}`} multiline value={editing.loading ? "Loading the draft..." : editing.text} editable={!editing.loading} onChangeText={(text) => onChange?.({ text, subject: editing.subject })} style={s.dEditBody} />
          <View style={s.acts}>
            <Pressable accessibilityRole="button" accessibilityLabel="Save" testID={`draft-save:${d.id}`} disabled={busy || editing.loading === true} onPress={onSave} style={(st: { hovered?: boolean }) => [s.btn, s.btnP, hover(st) && s.btnPOver]}><Text style={s.btnPText}>Save</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel" testID={`draft-cancel:${d.id}`} onPress={onCancel} style={(st: { hovered?: boolean }) => [s.btn, hover(st) && s.btnOver]}><Text style={s.btnText}>Cancel</Text></Pressable>
          </View>
        </View>
      ) : (<>
        {d.subject ? <Text style={s.drSj}>{d.subject}</Text> : null}
        <Text style={s.drBd}>{d.body}</Text>
      </>)}
      {d.earlier ? (
        <View>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showEarlier }} testID={`draft-earlier:${d.id}`} onPress={() => setShowEarlier((v) => !v)}><Text style={s.earlierLink}>{showEarlier ? "Hide the earlier draft" : "Show the earlier draft"}</Text></Pressable>
          {showEarlier ? <Text style={s.earlierText} testID={`draft-earlier-text:${d.id}`}>{d.earlier.text}</Text> : null}
        </View>
      ) : null}
      <View style={s.gate} testID={`gate:${d.id}`}>
        <Icon name="shield" size={13} />
        <Text style={s.gateText}>{sendsLine(d.from)}</Text>
      </View>
      {note ? <Text style={s.note} accessibilityRole="alert" testID={`draft-note:${d.id}`}>{note}</Text> : null}
      {editing ? null : <View style={s.acts}>
        <Pressable accessibilityRole="button" accessibilityLabel="Send" accessibilityState={{ disabled: busy }} testID={`draft-send:${d.id}`} disabled={busy} onPress={onSend} style={(st: { hovered?: boolean }) => [s.btn, s.btnP, hover(st) && s.btnPOver, busy && s.dim]}>
          <Icon name="up" size={14} color="var(--accent-ink)" /><Text style={s.btnPText}>Send</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Edit" testID={`draft-edit:${d.id}`} onPress={onEdit} style={(st: { hovered?: boolean }) => [s.btn, hover(st) && s.btnOver]}>
          <Icon name="edit" size={14} color="var(--ink)" /><Text style={s.btnText}>Edit</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Discard" testID={`draft-discard:${d.id}`} onPress={onDiscard} style={(st: { hovered?: boolean }) => [s.btn, hover(st) && s.btnOver]}>
          <Icon name="x" size={14} color="var(--ink)" /><Text style={s.btnText}>Discard</Text>
        </Pressable>
      </View>}
    </View>
  );
}

const ink = (v: string): string => `var(${v})`;
const s = StyleSheet.create({
  grow: { flex: 1 },
  dEdit: { gap: 8, paddingVertical: 6 },
  dEditSj: { fontSize: 14, fontWeight: "600", color: ink("--ink"), borderWidth: 1, borderColor: ink("--line"), borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  dEditBody: { minHeight: 140, fontSize: 13.5, lineHeight: 20, color: ink("--ink"), borderWidth: 1, borderColor: ink("--line"), borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  dhUpdated: { color: ink("--ink-3"), fontSize: 11.5 },
  earlierLink: { fontSize: 12, color: ink("--accent"), paddingVertical: 4 },
  earlierText: { fontSize: 12.5, lineHeight: 18, color: ink("--ink-3"), paddingBottom: 6 },
  daysep: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12, marginBottom: 10 },
  rule: { flex: 1, height: 1, backgroundColor: ink("--line") },
  dayText: { fontSize: 11.5, fontWeight: "500", color: ink("--ink-3") },
  via: { fontSize: 11.5, color: ink("--ink-3"), flexShrink: 1 },
  time: { fontSize: 11.5, color: ink("--ink-3"), fontVariant: ["tabular-nums"] },
  metaText: { fontSize: 11.5, color: ink("--ink-3") },
  em: { paddingTop: 12, paddingBottom: 10, borderTopWidth: 1, borderTopColor: ink("--line") },
  eh: { flexDirection: "row", alignItems: "center", gap: 9 },
  ehName: { fontSize: 13, fontWeight: "600", color: ink("--ink") },
  ehOut: { color: ink("--accent") },
  sj: { marginTop: 6, marginBottom: 4, marginLeft: 23, fontSize: 14.5, fontWeight: "600", letterSpacing: -0.07, color: ink("--ink") },
  bd: { marginLeft: 23, fontSize: 14, lineHeight: 22, color: ink("--ink") },
  bad: { marginTop: 4, marginLeft: 23, fontSize: 12, fontWeight: "500", color: ink("--danger") },
  qt: { marginTop: 6, marginLeft: 23 },
  qtb: { alignSelf: "flex-start", width: 26, height: 16, borderRadius: 5, alignItems: "center", justifyContent: "center", backgroundColor: ink("--hover") },
  qtbOver: { backgroundColor: ink("--press") },
  qx: { marginTop: 6, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: ink("--line-2"), fontSize: 13, lineHeight: 20, color: ink("--ink-3") },
  atts: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8, marginLeft: 23 },
  att: { flexDirection: "row", alignItems: "center", gap: 7, height: 28, paddingLeft: 8, paddingRight: 10, borderRadius: 7, backgroundColor: ink("--hover") },
  attOver: { backgroundColor: ink("--press") },
  attText: { fontSize: 12.5, color: ink("--ink-2") },
  attSize: { fontSize: 11.5, color: ink("--ink-3") },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8, marginLeft: 23 },
  rc: { flexDirection: "row", alignItems: "center", gap: 6, height: 24, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1, borderColor: ink("--line-2") },
  rcOver: { backgroundColor: ink("--hover") },
  rcText: { fontSize: 12, color: ink("--ink-2") },
  sg: { alignItems: "flex-start", gap: 3, marginVertical: 6 },
  sgOut: { alignItems: "flex-end" },
  bub: { maxWidth: "68%", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16 },
  bubIn: { backgroundColor: ink("--sunk"), borderWidth: 1, borderColor: ink("--line") },
  bubOut: { backgroundColor: ink("--accent") },
  bubFirstIn: { borderTopLeftRadius: 6 },
  bubFirstOut: { borderTopRightRadius: 6 },
  bubText: { fontSize: 14, lineHeight: 20, color: ink("--ink") },
  bubTextOut: { color: ink("--accent-ink") },
  smeta: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4 },
  cl: { marginVertical: 8, paddingVertical: 10, borderTopWidth: 1, borderBottomWidth: 1, borderTopColor: ink("--line"), borderBottomColor: ink("--line") },
  clMissed: {},
  ch: { flexDirection: "row", alignItems: "center", gap: 9 },
  chLabel: { fontSize: 13, fontWeight: "600", color: ink("--ink") },
  chMissed: { color: ink("--danger") },
  chDur: { fontSize: 13, color: ink("--ink-3") },
  player: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8, marginLeft: 24, height: 34, maxWidth: 420, paddingLeft: 4, paddingRight: 12, borderRadius: 99, backgroundColor: ink("--hover") },
  pb: { width: 26, height: 26, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: ink("--accent") },
  pbOver: { opacity: 0.9 },
  bar: { flex: 1, height: 4, borderRadius: 4, overflow: "hidden", backgroundColor: ink("--line-2") },
  barFill: { height: "100%", backgroundColor: ink("--accent") },
  dur: { fontSize: 12, color: ink("--ink-3"), fontVariant: ["tabular-nums"] },
  sm: { marginTop: 6, marginLeft: 24, fontSize: 13.5, lineHeight: 20, color: ink("--ink-2") },
  tlink: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6, marginLeft: 24, height: 22, paddingHorizontal: 5, borderRadius: 5 },
  tlinkOver: { backgroundColor: ink("--accent-wash") },
  tlinkText: { fontSize: 12.5, fontWeight: "500", color: ink("--accent") },
  chevOpen: { transform: [{ rotate: "90deg" }] },
  tx: { marginTop: 4, marginLeft: 24 },
  txLine: { fontSize: 13, lineHeight: 20, color: ink("--ink-2") },
  txWho: { fontWeight: "600", color: ink("--ink") },
  notes: { marginTop: 6, marginLeft: 24, fontSize: 13.5, color: ink("--ink-3") },
  ev: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginVertical: 10 },
  evdot: { width: 5, height: 5, borderRadius: 5, backgroundColor: ink("--accent"), opacity: 0.7 },
  evText: { fontSize: 12.5, color: ink("--ink-3") },
  dr: { marginTop: 10, marginBottom: 8, marginLeft: 23, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: ink("--accent-line"), backgroundColor: ink("--accent-wash") },
  dh: { flexDirection: "row", alignItems: "center", gap: 8 },
  dhText: { fontSize: 12.5, color: ink("--ink-2") },
  dhName: { fontWeight: "600", color: ink("--ink") },
  drSj: { marginTop: 8, fontSize: 14, fontWeight: "600", color: ink("--ink") },
  drBd: { marginTop: 8, fontSize: 14, lineHeight: 21, color: ink("--ink") },
  gate: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 10 },
  gateText: { fontSize: 12, color: ink("--ink-3") },
  note: { marginTop: 8, fontSize: 12.5, fontWeight: "500", color: ink("--ink-2") },
  acts: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  btn: { height: 30, paddingHorizontal: 12, borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: ink("--hover") },
  btnOver: { backgroundColor: ink("--press") },
  btnP: { backgroundColor: ink("--accent") },
  btnPOver: { opacity: 0.92 },
  btnText: { fontSize: 12.5, fontWeight: "600", color: ink("--ink") },
  btnPText: { fontSize: 12.5, fontWeight: "600", color: ink("--accent-ink") },
  dim: { opacity: 0.5 },
});

// ---------------------------------------------------------------- an email thread (owner, 3 Nov)

type ThreadEntry = Extract<FeedEntry, { kind: "thread" }>;

/** The sanitised HTML of a message (the server removed scripts, styles and handlers, held remote images and named each link's host). Web draws it; elsewhere the text body stands. */
function MailHtml({ html, id }: { html: string; id: string }): ReactElement {
  return createElement("div", { className: "vy-mailhtml", "data-testid": `html:${id}`, dangerouslySetInnerHTML: { __html: html } });
}
const MAIL_HTML_CSS = ".vy-mailhtml{font-size:14px;line-height:22px;color:var(--ink);overflow-wrap:break-word}.vy-mailhtml p{margin:0 0 10px}.vy-mailhtml p:last-child{margin-bottom:0}"
  + ".vy-mailhtml a{color:var(--accent);text-decoration:underline;text-underline-offset:2px}.vy-mailhtml .vy-link-host{color:var(--ink-3);font-size:12px}.vy-mailhtml img{max-width:100%;height:auto;border-radius:6px}"
  + ".vy-mailhtml table{border-collapse:collapse;max-width:100%}.vy-mailhtml td{padding:2px 0;vertical-align:top}.vy-mailhtml blockquote{margin:6px 0;padding-left:12px;border-left:2px solid var(--line-2);color:var(--ink-3)}";

export interface ThreadView {
  mine: ReadonlySet<string>;
  fresh: ReadonlySet<string>;
  now: number;
  offsetMin: number;
  open: boolean;
  msgOpen(id: string): boolean;
  quoteOpen(id: string): boolean;
  sigOpen(id: string): boolean;
  onToggle(): void;
  onMessage(id: string, open: boolean): void;
  onQuote(id: string): void;
  onSig(id: string): void;
  onImages(): void;
  onReply(mode: "one" | "all"): void;
  onAttachment?(name: string): void;
  /** The inbox a message came in or went out on, as the sidebar names it. */
  viaOf?(mailboxId: string): string;
  /** Record chips the history put on an email. */
  chipsOf?(messageId: string): { title: string; recordId?: string }[];
  onChip?(title: string, recordId?: string): void;
  /** A phone width: the message head keeps the name and the time and drops the rest. */
  narrow?: boolean;
  /** Where the card sits in the feed, for landing on the first one with something new. */
  onLayoutY?(y: number): void;
}

/** One email thread as a card: subject once, who is on it, how many messages, the last activity, what is new and your role; open, older messages one line each and the newest in full. */
export function ThreadCard({ e, v }: { e: ThreadEntry; v: ThreadView }): ReactElement {
  const t = e.thread;
  const msgs = t.messages.map((x) => x.message);
  const fresh = msgs.filter((m) => v.fresh.has(m.id)).length;
  const role = roleLine(t.role);
  const last = msgs[msgs.length - 1];
  const people = t.participants.filter((p) => !isMine(p.address, v.mine));
  let divided = false;
  const body: ReactElement[] = [];
  if (v.open && t.role === "added_later" && msgs[0]) {
    body.push(<Text key="note" style={th.thNote} testID={`thread-added:${t.threadId}`}>{`You were added on ${whenLabel(msgs[0].at, v.now, v.offsetMin)}. What came before is in the quoted text of ${firstName(senderName(msgs[0], v.mine))}'s message.`}</Text>);
  }
  if (v.open) {
    for (const m of msgs) {
      if (!divided && v.fresh.has(m.id) && fresh < msgs.length) {
        divided = true;
        body.push(<View key="new" style={th.thDiv} testID={`thread-new:${t.threadId}`}><Text style={th.thDivText}>New since you last looked</Text><View style={th.thDivRule} /></View>);
      }
      body.push(v.msgOpen(m.id) ? <ThreadMessage key={m.id} m={m} v={v} /> : <MessageLine key={m.id} m={m} v={v} />);
    }
  }
  const many = last ? last.to.length + last.cc.length > 1 : false;
  return (
    <View style={[th.th, fresh > 0 && th.thNew]} testID={`thread:${t.threadId}`} onLayout={v.onLayoutY ? (ev) => v.onLayoutY?.(ev.nativeEvent.layout.y) : undefined}>
      <Pressable
        accessibilityRole="button" accessibilityLabel={`${t.subject}, ${t.messageCount} messages${fresh ? `, ${fresh} new` : ""}`} accessibilityState={{ expanded: v.open }} testID={`thread-toggle:${t.threadId}`}
        onPress={v.onToggle} style={(st: { hovered?: boolean }) => [th.thh, v.open && th.thhOpen, hover(st) && th.thhOver]}
      >
        <View style={th.thl1}>
          <Text style={th.thSj} numberOfLines={1} accessibilityRole="header" aria-level={3}>{t.subject}</Text>
          <View style={s.grow} />
          {fresh > 0 ? <><View style={th.udot} /><Text style={th.thNewText} numberOfLines={1} testID={`thread-fresh:${t.threadId}`}>{`${fresh} new`}</Text></> : null}
          <Text style={[s.time, th.keep]} numberOfLines={1}>{whenLabel(t.lastAt, v.now, v.offsetMin)}</Text>
        </View>
        <View style={th.thl2}>
          <View style={th.faces}>{each(people.slice(0, 3), (p, i) => <View key={p.address} style={[th.faceRing, i > 0 && th.faceOverlap]}><Face name={partyName(p)} size={18} /></View>)}</View>
          <Text style={th.thWho} numberOfLines={1}>{withLine(t, v.mine)}</Text>
          <Text style={th.thSep}>·</Text>
          <Text style={th.thMeta} numberOfLines={1}>{t.messageCount === 1 ? "1 message" : `${t.messageCount} messages`}</Text>
          {role ? <><Text style={th.thSep}>·</Text><Text style={th.thRole} numberOfLines={1} testID={`thread-role:${t.threadId}`}>{role}</Text></> : null}
        </View>
        {!v.open && last ? <Text style={th.thPv} numberOfLines={1}><Text style={th.thPvWho}>{`${firstName(senderName(last, v.mine))} `}</Text>{msgPreview(last, 160)}</Text> : null}
      </Pressable>
      {v.open ? (
        <View style={th.thb}>
          {body}
          <View style={th.thf}>
            <Pressable accessibilityRole="button" accessibilityLabel="Reply" testID={`thread-reply:${t.threadId}`} onPress={() => v.onReply("one")} style={(st: { hovered?: boolean }) => [s.btn, th.thBtn, hover(st) && s.btnOver]}>
              <Icon name="reply" size={13} color="var(--ink-2)" /><Text style={s.btnText}>Reply</Text>
            </Pressable>
            {many ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Reply all" testID={`thread-replyall:${t.threadId}`} onPress={() => v.onReply("all")} style={(st: { hovered?: boolean }) => [s.btn, th.thBtn, hover(st) && s.btnOver]}>
                <Icon name="reply" size={13} color="var(--ink-2)" /><Text style={s.btnText}>Reply all</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** An older message, closed: who, the first words, any reaction, when. */
function MessageLine({ m, v }: { m: ThreadMsg; v: ThreadView }): ReactElement {
  const who = senderName(m, v.mine);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${who}: ${msgPreview(m, 80)}. Show the whole message`} testID={`email:${m.id}`} onPress={() => v.onMessage(m.id, true)} style={(st: { hovered?: boolean }) => [th.mrow, hover(st) && th.mrowOver]}>
      <Face name={who === "You" ? "You" : partyName(m.from)} size={18} />
      <Text style={th.mrowWho}>{firstName(who)}</Text>
      <Text style={th.mrowPv} numberOfLines={1}>{msgPreview(m, 140)}</Text>
      {m.reactions.length ? <Text style={th.mrowRx}>{m.reactions.map((r) => r.emoji).join("")}</Text> : null}
      <Text style={[s.time, th.keep]} numberOfLines={1}>{whenLabel(m.at, v.now, v.offsetMin)}</Text>
    </Pressable>
  );
}

/** A message in full: every word of what was written this time; the quoted history and the signature one quiet press away. */
function ThreadMessage({ m, v }: { m: ThreadMsg; v: ThreadView }): ReactElement {
  const who = senderName(m, v.mine);
  const out = who === "You";
  const quote = v.quoteOpen(m.id), sig = v.sigOpen(m.id);
  const web = Platform.OS === "web" && m.html !== undefined;
  const chips = v.chipsOf?.(m.id) ?? [];
  return (
    <View style={th.tmsg} testID={`email:${m.id}`}>
      <View style={th.tmh}>
        <Face name={out ? "You" : partyName(m.from)} size={24} />
        <Text style={[s.ehName, out && s.ehOut, th.keep]} numberOfLines={1}>{who}</Text>
        {v.narrow ? null : <Text style={th.tmRcp} numberOfLines={1}>{recipientLine(m, v.mine)}</Text>}
        <View style={s.grow} />
        {v.viaOf && !v.narrow ? <Text style={s.via} numberOfLines={1}>{v.viaOf(m.mailboxId)}</Text> : null}
        <Text style={[s.time, th.keep]} numberOfLines={1}>{whenLabel(m.at, v.now, v.offsetMin)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Collapse" testID={`collapse:${m.id}`} onPress={() => v.onMessage(m.id, false)} style={(st: { hovered?: boolean }) => [th.mcol, hover(st) && s.btnOver]}>
          <Icon name="chevd" size={12} />
        </Pressable>
      </View>
      <View style={th.tmBody}>
        {web ? <MailHtml html={m.html as string} id={m.id} /> : <Text style={th.tmText} selectable testID={`body:${m.id}`}>{m.body}</Text>}
      </View>
      {m.imagesHeld ? (
        <View style={th.imgoff} testID={`images-held:${m.id}`}>
          <Icon name="file" size={13} />
          <Text style={th.imgoffText}>{m.imagesHeld === 1 ? "1 image not loaded" : `${m.imagesHeld} images not loaded`}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Show images" testID={`images-show:${m.id}`} onPress={v.onImages}><Text style={th.imgoffBtn}>Show images</Text></Pressable>
        </View>
      ) : null}
      {m.signature || m.quoted ? (
        <View style={th.tools}>
          {m.signature ? (
            <Pressable accessibilityRole="button" accessibilityLabel={sig ? "Hide signature" : "Show signature"} accessibilityState={{ expanded: sig }} testID={`sig-toggle:${m.id}`} onPress={() => v.onSig(m.id)} style={(st: { hovered?: boolean }) => [s.qtb, hover(st) && s.qtbOver]}>
              <Icon name="more" size={12} />
            </Pressable>
          ) : null}
          {m.quoted ? (
            <Pressable accessibilityRole="button" accessibilityLabel={quote ? "Hide quoted text" : "Show quoted text"} accessibilityState={{ expanded: quote }} testID={`quote-toggle:${m.id}`} onPress={() => v.onQuote(m.id)}>
              {(st: { hovered?: boolean }) => <Text style={[th.qLink, hover(st) && th.qLinkOver]}>{quote ? "Hide quoted text" : "Show quoted text"}</Text>}
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {sig && m.signature ? <Text style={th.sigx} testID={`sig:${m.id}`} selectable>{m.signature}</Text> : null}
      {quote && m.quoted ? <Text style={[s.qx, th.tmIndent]} testID={`quote:${m.id}`} selectable>{m.quoted}</Text> : null}
      {m.reactions.length ? (
        <View style={th.rxs} testID={`reactions:${m.id}`}>
          {each(m.reactions, (r) => <Text key={`${r.from.address}:${r.at}`} style={th.rx}>{`${r.emoji} ${isMine(r.from.address, v.mine) ? "You" : firstName(partyName(r.from))}`}</Text>)}
        </View>
      ) : null}
      {m.attachments.length ? (
        <View style={[s.atts, th.tmIndent]}>
          {each(m.attachments, (a) => (
            <Pressable key={a.attachmentId} accessibilityRole="button" accessibilityLabel={`Open ${a.name}`} testID={`attachment:${a.name}`} onPress={() => v.onAttachment?.(a.name)} style={(st: { hovered?: boolean }) => [s.att, hover(st) && s.attOver]}>
              <Icon name="file" size={14} /><Text style={s.attText}>{a.name}</Text>{sizeLabel(a.size) ? <Text style={s.attSize}>{sizeLabel(a.size)}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      {chips.length ? (
        <View style={[s.chips, th.tmIndent]}>
          {each(chips, (c) => (
            <Pressable key={c.title} accessibilityRole="link" accessibilityLabel={`Open record ${c.title}`} testID={`chip:${c.title}`} onPress={() => v.onChip?.(c.title, c.recordId)} style={(st: { hovered?: boolean }) => [s.rc, hover(st) && s.rcOver]}>
              <Icon name="link" size={12} /><Text style={s.rcText}>{c.title}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** The style the sanitised HTML needs, once per page. */
export function MailHtmlStyle(): ReactElement | null {
  if (Platform.OS !== "web") return null;
  return createElement("style", { "data-vy": "mailhtml", dangerouslySetInnerHTML: { __html: MAIL_HTML_CSS } });
}

const th = StyleSheet.create({
  th: { marginVertical: 8, borderRadius: 12, backgroundColor: "var(--raised)", borderWidth: 1, borderColor: "var(--line)" },
  thNew: { borderColor: "var(--line-2)" },
  thh: { paddingTop: 11, paddingBottom: 10, paddingHorizontal: 14, borderRadius: 11 },
  thhOpen: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  thhOver: { backgroundColor: "var(--hover)" },
  thl1: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
  thSj: { fontSize: 14, fontWeight: "600", letterSpacing: -0.07, color: "var(--ink)", flexShrink: 1 },
  udot: { width: 7, height: 7, borderRadius: 7, backgroundColor: "var(--accent)" },
  thNewText: { fontSize: 12, fontWeight: "600", color: "var(--accent)", flexShrink: 0 },
  keep: { flexShrink: 0 },
  thl2: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 5, minWidth: 0 },
  faces: { flexDirection: "row" },
  faceRing: { borderRadius: 99, borderWidth: 2, borderColor: "var(--raised)", margin: -2 },
  faceOverlap: { marginLeft: -6 },
  thWho: { fontSize: 12.5, color: "var(--ink-3)", flexShrink: 1 },
  thSep: { fontSize: 12.5, color: "var(--ink-4)" },
  thMeta: { fontSize: 12.5, color: "var(--ink-3)", fontVariant: ["tabular-nums"], flexShrink: 0 },
  thRole: { fontSize: 12.5, color: "var(--ink-2)", flexShrink: 0 },
  thPv: { marginTop: 6, fontSize: 13, lineHeight: 19, color: "var(--ink-2)" },
  thPvWho: { fontWeight: "600", color: "var(--ink)" },
  thb: { paddingTop: 2, paddingBottom: 12, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: "var(--line)" },
  thNote: { marginTop: 10, marginBottom: 4, fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" },
  thDiv: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, marginBottom: 2 },
  thDivText: { fontSize: 11.5, fontWeight: "600", color: "var(--accent)" },
  thDivRule: { flex: 1, height: 1, backgroundColor: "var(--accent-line)" },
  mrow: { flexDirection: "row", alignItems: "center", gap: 8, height: 34, paddingHorizontal: 6, marginHorizontal: -6, borderRadius: 7 },
  mrowOver: { backgroundColor: "var(--hover)" },
  mrowWho: { fontSize: 13, fontWeight: "600", color: "var(--ink)" },
  mrowPv: { flex: 1, minWidth: 0, fontSize: 13, color: "var(--ink-3)" },
  mrowRx: { fontSize: 12 },
  tmsg: { paddingTop: 10, paddingBottom: 8, borderTopWidth: 1, borderTopColor: "var(--line)" },
  tmh: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
  tmRcp: { fontSize: 12, color: "var(--ink-3)", flexShrink: 1, minWidth: 0 },
  mcol: { width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  tmBody: { marginTop: 6, marginLeft: 32 },
  tmText: { fontSize: 14, lineHeight: 22, color: "var(--ink)" },
  tmIndent: { marginLeft: 32 },
  imgoff: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, marginLeft: 32 },
  imgoffText: { fontSize: 12.5, color: "var(--ink-3)" },
  imgoffBtn: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" },
  tools: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 8, marginLeft: 32 },
  qLink: { fontSize: 12.5, color: "var(--ink-3)" },
  qLinkOver: { color: "var(--ink)", textDecorationLine: "underline" },
  sigx: { marginTop: 8, marginLeft: 32, fontSize: 13, lineHeight: 20, color: "var(--ink-3)" },
  rxs: { flexDirection: "row", gap: 12, marginTop: 8, marginLeft: 32 },
  rx: { fontSize: 12.5, color: "var(--ink-2)" },
  thf: { flexDirection: "row", gap: 6, marginTop: 10, marginLeft: 32 },
  thBtn: { height: 28, gap: 6 },
});
