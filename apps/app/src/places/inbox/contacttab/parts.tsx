// The pieces of the conversation feed (spec 2.18, 3.3), drawn from the prototype's Inbox: an email (the quoted text folded, attachments, record chips), a run of text bubbles, a call with its
// player, summary and transcript, a campaign step as a quiet line, an agent's draft with its Gate line. Colours are skin tokens, so a skin switch repaints with no re-render.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { each } from "./each.ts";
import { Icon } from "./icons.tsx";
import type { IconName } from "./icons.tsx";
import { Face } from "../sidebar/parts.tsx";
import { callLabel, clockTime, deliveryNote, duration, gateLine, isMissed } from "./model.ts";
import type { DraftCard, FeedEntry } from "./model.ts";

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
        {r.campaign && !out ? <View style={s.camptag}><Icon name="flag" size={11} color="var(--accent)" /><Text style={s.camptext}>{r.campaign}</Text></View> : null}
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

/** A campaign step, a record link or a note: one quiet centred line. */
export function QuietLine({ text, testID }: { text: string; testID: string }): ReactElement {
  return (
    <View style={s.ev} testID={testID}><View style={s.evdot} /><Text style={s.evText}>{text}</Text></View>
  );
}

/** An agent's draft: what it would send, from which inbox, the Gate line, and Send, Edit and Discard. */
export function DraftBlock({ d, note, busy, onSend, onEdit, onDiscard }: { d: DraftCard; note?: string | undefined; busy: boolean; onSend(): void; onEdit(): void; onDiscard(): void }): ReactElement {
  return (
    <View style={s.dr} testID={`draft:${d.id}`}>
      <View style={s.dh}>
        <Face name={d.agent} size={20} round={false} />
        <Text style={s.dhText}><Text style={s.dhName}>{d.agent}</Text> drafted a {d.channel === "sms" ? "text" : "reply"}</Text>
        <View style={s.grow} />
        <Via name={d.via} />
      </View>
      {d.subject ? <Text style={s.drSj}>{d.subject}</Text> : null}
      <Text style={s.drBd}>{d.body}</Text>
      <View style={s.gate} testID={`gate:${d.id}`}>
        <Icon name="shield" size={13} />
        <Text style={s.gateText}>{gateLine(d.agent, d.via)}</Text>
      </View>
      {note ? <Text style={s.note} accessibilityRole="alert" testID={`draft-note:${d.id}`}>{note}</Text> : null}
      <View style={s.acts}>
        <Pressable accessibilityRole="button" accessibilityLabel="Send" accessibilityState={{ disabled: busy }} testID={`draft-send:${d.id}`} disabled={busy} onPress={onSend} style={(st: { hovered?: boolean }) => [s.btn, s.btnP, hover(st) && s.btnPOver, busy && s.dim]}>
          <Icon name="up" size={14} color="var(--accent-ink)" /><Text style={s.btnPText}>Send</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Edit" testID={`draft-edit:${d.id}`} onPress={onEdit} style={(st: { hovered?: boolean }) => [s.btn, hover(st) && s.btnOver]}>
          <Icon name="edit" size={14} color="var(--ink)" /><Text style={s.btnText}>Edit</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Discard" testID={`draft-discard:${d.id}`} onPress={onDiscard} style={(st: { hovered?: boolean }) => [s.btn, hover(st) && s.btnOver]}>
          <Icon name="x" size={14} color="var(--ink)" /><Text style={s.btnText}>Discard</Text>
        </Pressable>
      </View>
    </View>
  );
}

const ink = (v: string): string => `var(${v})`;
const s = StyleSheet.create({
  grow: { flex: 1 },
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
  camptag: { flexDirection: "row", alignItems: "center", gap: 4 },
  camptext: { fontSize: 11.5, fontWeight: "500", color: ink("--accent") },
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
