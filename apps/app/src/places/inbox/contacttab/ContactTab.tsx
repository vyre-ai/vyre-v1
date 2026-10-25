// Inbox > a contact's tab (spec 3.3, 2.18, 2.14): the whole history of one person across email, text and calls, newest at the foot next to the composer. Emails keep their quoted text folded;
// texts are bubbles; calls carry a player, a summary and a transcript; campaign steps are quiet lines; record chips link to the record. The header has the record link, Email, Text, Call, Follow
// and Ask. The composer switches Email and Text and picks the sending inbox (a reply goes out from the inbox the thread came in on); an agent's draft shows its Gate line with Send, Edit and
// Discard. Everything reads from the local copy and works offline: a send queues and the foot says so.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import type { ComposerLists } from "../../../../../../ui/src/Composer/index.tsx";
import { Recipients } from "../../../../../../ui/src/Recipients/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { useInboxData, useOnline, useOptionalInboxData, useScreenQuery } from "../sidebar/data.tsx";
import { Face, Ghost, pointOf } from "../sidebar/parts.tsx";
import type { Mailbox } from "../sidebar/model.ts";
import { discardDraft, markRead, sendAgentDraft, sendEmail, sendText, setFollow } from "./actions.ts";
import { each } from "./each.ts";
import { Icon } from "./icons.tsx";
import type { IconName } from "./icons.tsx";
import { followMenuEntries, fromMenuEntries } from "./menus.ts";
import {
  buildFeed, canSend, cannedLists, choicesFor, draftCards, initialDraft, pickInbox, sendBlocker, startChannel, textTarget,
} from "./model.ts";
import type { Chan, ComposerDraft, DraftCard, DraftRow, InboxChoice, SendOptions, ThreadOut } from "./model.ts";
import { Bubbles, CallLine, DaySep, DraftBlock, EmailItem, QuietLine } from "./parts.tsx";

export const SCREEN = "inbox.contact-tab";
type MailboxesOut = { mailboxes: Mailbox[] };
type DraftsOut = { drafts: DraftRow[] };

export interface ContactTabProps {
  conversationId: string;
  contactId?: string;
  /** Open the person's or company's record (the header link and a record chip). */
  onOpenRecord?(contactId: string, recordId?: string): void;
  onAsk?(contactId?: string): void;
  onDial?(number: string): void;
  /** Open Vyre Files to attach; the app answers with the attachments' file ids. */
  onAttach?(): void;
  onOpenAttachment?(name: string): void;
}

const agentName = (id: string): string => {
  const base = id.replace(/^agt_/, "");
  return base.charAt(0).toUpperCase() + base.slice(1);
};

function HeadButton({ icon, label, on = false, testID, disabled = false, onPress, text }: { icon: IconName; label: string; on?: boolean; testID: string; disabled?: boolean; onPress(x: number, y: number): void; text?: string }): ReactElement {
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on, disabled }} testID={testID} disabled={disabled}
      onPress={(e) => { const p = pointOf(e); onPress(p.x, p.y); }}
      style={({ hovered }: { hovered?: boolean }) => [s.hic, text !== undefined && s.hicText, (hovered === true || on) && s.hicOver, disabled && s.dim]}
    >
      <Icon name={icon} size={16} color={on ? "var(--accent)" : "var(--ink-2)"} />
      {text !== undefined ? <Text style={s.hicLabel}>{text}</Text> : null}
    </Pressable>
  );
}

/** The frame before data arrives: the header and the composer of the right height, so nothing moves when the thread lands. */
export function TabLoading(): ReactElement {
  return (
    <View style={s.main} testID="contact-tab-loading" accessibilityLabel="Loading">
      <View style={s.head}><View style={s.skFace} /><View style={[s.skBar, { width: 140 }]} /></View>
      <View style={s.feed}>{each([0, 1, 2, 3], (i) => <View key={i} style={s.skBlock}><View style={[s.skBar, { width: `${40 + i * 10}%` as unknown as number }]} /><View style={[s.skBar, s.skSmall]} /></View>)}</View>
      <View style={s.cmpWrap}><View style={s.skComposer} /></View>
    </View>
  );
}

function Tab({ conversationId, contactId, ...props }: ContactTabProps): ReactElement {
  const data = useInboxData();
  const online = useOnline();
  const menu = useMenu();
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < 560;
  const scroll = useRef<ScrollView | null>(null);
  const state = { conversationId, ...(contactId ? { contactId } : {}) };
  const thread = useScreenQuery<ThreadOut>(SCREEN, "thread", state);
  const opts = useScreenQuery<SendOptions>(SCREEN, "options", state);
  const drafts = useScreenQuery<DraftsOut>(SCREEN, "drafts", contactId ? { contactId } : {});
  const boxes = useScreenQuery<MailboxesOut>("inbox.sidebar", "mailboxes");

  const [over, setOver] = useState<Partial<ComposerDraft>>({});
  const [quotes, setQuotes] = useState<readonly string[]>([]);
  const [transcripts, setTranscripts] = useState<readonly string[]>([]);
  const [note, setNote] = useState("");
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<readonly string[]>([]);
  const [attached, setAttached] = useState<readonly { name: string }[]>([]);

  const conv = thread.status === "ready" ? thread.data.conversation : null;
  const items = thread.status === "ready" ? thread.data.items : [];
  const options = opts.status === "ready" ? opts.data : null;
  const clock = data.clock();

  const titles = useMemo(() => {
    const m = new Map<string, string>();
    if (boxes.status === "ready") for (const b of boxes.data.mailboxes) m.set(b.id, b.title);
    return m;
  }, [boxes]);
  const agents = useMemo(() => {
    const m = new Map<string, string>();
    if (boxes.status === "ready") for (const b of boxes.data.mailboxes) if (b.agentId) m.set(b.agentId, agentName(b.agentId));
    return m;
  }, [boxes]);
  const feed = useMemo(() => buildFeed(items, clock.now, clock.offsetMin), [items, clock.now, clock.offsetMin]);
  const cards = useMemo<DraftCard[]>(() => (drafts.status === "ready" ? draftCards(drafts.data.drafts, titles, agents) : []), [drafts, titles, agents]);

  const chan: Chan = over.chan ?? (conv ? startChannel(conv.lastChannel, options) : "email");
  const base = conv ? initialDraft(conv, chan, items) : null;
  const draft: ComposerDraft | null = base ? { ...base, ...over, chan, from: { ...base.from, ...over.from } } : null;
  const choices = choicesFor(chan, options, titles);
  const inbox = draft && conv ? (choices.find((c) => c.id === draft.from[chan]) ?? pickInbox(choices, conv.mailboxIds)) : null;
  const textTo = conv ? textTarget(conv, items) : null;

  // the newest message is at the foot: open scrolled down, and again when something arrives
  useEffect(() => { scroll.current?.scrollToEnd?.({ animated: false }); }, [feed.length, cards.length]);
  // opening the conversation reads it
  const unread = conv?.unreadCount ?? 0;
  useEffect(() => { if (unread > 0) void markRead(data, conversationId); }, [conversationId, unread > 0]);

  if (!conv || !draft) return <TabLoading />;

  const patch = (p: Partial<ComposerDraft>): void => setOver((o) => ({ ...o, ...p }));
  const toggled = (list: readonly string[], id: string): string[] => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const withBusy = async (key: string, run: () => Promise<void>): Promise<void> => {
    setBusy((b) => [...b, key]);
    try { await run(); } finally { setBusy((b) => b.filter((x) => x !== key)); }
  };
  const fail = (e: unknown): string => (e as { error?: { message?: string } }).error?.message ?? (e instanceof Error ? e.message : "Could not send");

  const send = async (text: string): Promise<void> => {
    if (!inbox) return;
    const d = { ...draft, text };
    try {
      setNote(online ? "" : "Saved on this device. It sends when you are back online");
      const done = d.chan === "email" ? await sendEmail(data, d, inbox, conv, items) : textTo ? await sendText(data, d, inbox, conv, textTo) : "No phone number for this contact";
      setNote(online ? done : "Saved on this device. It sends when you are back online");
      setOver((o) => ({ ...o, text: "", draftId: null }));
      setAttached([]);
    } catch (e) {
      setNote(fail(e));
    }
  };

  const draftSend = (card: DraftCard): Promise<void> => withBusy(card.id, async () => {
    try {
      const text = over.draftId === card.id && over.text ? over.text : card.body;
      const subject = over.draftId === card.id && over.subject ? over.subject : card.subject;
      const done = await sendAgentDraft(data, card, conv, text, subject);
      setDraftNotes((n) => ({ ...n, [card.id]: done }));
      if (over.draftId === card.id) setOver((o) => ({ ...o, text: "", draftId: null }));
    } catch (e) { setDraftNotes((n) => ({ ...n, [card.id]: fail(e) })); }
  });
  const draftEdit = (card: DraftCard): void => { patch({ chan: "email", draftId: card.id, text: card.body, subject: card.subject, to: card.to, from: { email: card.mailboxId, sms: null } }); };
  const draftDiscard = (card: DraftCard): Promise<void> => withBusy(card.id, async () => {
    try { await discardDraft(data, card.id); if (over.draftId === card.id) setOver((o) => ({ ...o, text: "", draftId: null })); } catch (e) { setDraftNotes((n) => ({ ...n, [card.id]: fail(e) })); }
  });

  const showFollow = (x: number, y: number): void => {
    if (!conv.contactId) return;
    const id = conv.contactId;
    menu.show(followMenuEntries(conv.followed, conv.alertOnReplies, { follow: (f) => void setFollow(data, id, f), alert: (a) => void setFollow(data, id, true, a) }), x, y);
  };
  const showFrom = (x: number, y: number): void => menu.show(fromMenuEntries(choices, inbox?.id ?? null, conv.mailboxIds, (id) => patch({ from: { ...draft.from, [chan]: id } })), x, y);
  const dial = (): void => { const n = textTo ?? (conv.address.includes("@") ? null : conv.address); if (n && props.onDial) props.onDial(n); else data.nav.openDialer(); };

  const lists: ComposerLists = cannedLists(conv);
  const mail = chan === "email";
  const unmatched = conv.needsMatch && !conv.contactId;
  const blocker = sendBlocker(draft, inbox, online, textTo);
  const target = mail ? draft.to.join(", ") : textTo ?? "";

  return (
    <View style={s.main} testID="contact-tab" accessibilityLabel={`Conversation with ${conv.displayName}`}>
      <View style={s.head} testID="contact-head">
        <View style={s.hid}>
          {unmatched ? <Ghost size={28} /> : <Face name={conv.displayName} size={28} />}
          <Text accessibilityRole="header" aria-level={1} style={s.name} numberOfLines={1}>{conv.displayName}</Text>
          {phone ? null : <Text style={s.co} numberOfLines={1}>{conv.address}</Text>}
        </View>
        {unmatched ? (
          <Pressable accessibilityRole="link" accessibilityLabel="Match to a record" testID="head-match" onPress={() => data.nav.openMatch(conv.id)} style={s.mlink}>
            <Icon name="link" size={12} color="var(--accent)" /><Text style={s.mlinkText}>Match to a record</Text>
          </Pressable>
        ) : conv.contactId && !phone ? (
          <Pressable accessibilityRole="link" accessibilityLabel="Open the record" testID="head-record" onPress={() => props.onOpenRecord?.(conv.contactId as string)} style={({ hovered }: { hovered?: boolean }) => [s.rlink, hovered === true && s.hicOver]}>
            <Icon name="link" size={13} color="var(--ink-2)" /><Text style={s.rlinkText}>Record</Text>
          </Pressable>
        ) : null}
        <View style={s.grow} />
        <HeadButton icon="mail" label="Email" testID="head-email" on={chan === "email"} disabled={!(options?.channels.includes("email") ?? false)} onPress={() => patch({ chan: "email" })} />
        <HeadButton icon="sms" label="Text" testID="head-text" on={chan === "sms"} disabled={!(options?.channels.includes("sms") ?? false)} onPress={() => patch({ chan: "sms" })} />
        <HeadButton icon="call" label="Call" testID="head-call" onPress={dial} />
        {conv.contactId ? <HeadButton icon="bell" label={conv.followed ? "Following" : "Follow"} testID="head-follow" on={conv.followed} onPress={showFollow} /> : null}
        {phone ? null : <HeadButton icon="ask" label="Ask" testID="head-ask" text="Ask" onPress={() => props.onAsk?.(conv.contactId)} />}
      </View>
      {online ? null : <Text style={s.offline} accessibilityRole="alert" testID="contact-offline">Offline, showing your saved copy</Text>}

      <ScrollView ref={scroll} style={s.feed} contentContainerStyle={s.col} testID="contact-feed">
        {feed.length === 0 && cards.length === 0 ? <States kind="empty" title="No messages yet." icon="chat" /> : null}
        {each(feed, (f): ReactElement => {
          switch (f.kind) {
            case "day": return <DaySep key={f.key} label={f.label} />;
            case "email": return <EmailItem key={f.key} e={f} who={conv.displayName} offsetMin={clock.offsetMin} quoteOpen={quotes.includes(f.key)} onQuote={() => setQuotes((q) => toggled(q, f.key))} {...(props.onOpenAttachment ? { onAttachment: props.onOpenAttachment } : {})} onChip={(title, recordId) => props.onOpenRecord?.(conv.contactId ?? "", recordId ?? title)} />;
            case "texts": return <Bubbles key={f.key} t={f} offsetMin={clock.offsetMin} />;
            case "call": return <CallLine key={f.key} c={f} offsetMin={clock.offsetMin} open={transcripts.includes(f.key)} onTranscript={() => setTranscripts((t) => toggled(t, f.key))} />;
            case "step": return <QuietLine key={f.key} text={f.item.title ?? "Campaign step"} testID={`step:${f.item.id}`} />;
            case "chip": return <QuietLine key={f.key} text={f.item.title ?? "Record"} testID={`chip-line:${f.item.id}`} />;
            case "note": return <QuietLine key={f.key} text={f.item.title ?? f.item.preview ?? ""} testID={`note:${f.item.id}`} />;
          }
        })}
        {each(cards, (d) => <DraftBlock key={d.id} d={d} note={draftNotes[d.id]} busy={busy.includes(d.id) || !online} onSend={() => void draftSend(d)} onEdit={() => draftEdit(d)} onDiscard={() => void draftDiscard(d)} />)}
      </ScrollView>

      <View style={s.cmpWrap} testID="contact-composer">
        <View style={s.cmpIn}>
          <View style={s.ctop}>
            <View style={s.seg} accessibilityRole="tablist">
              {each(["email", "sms"] as const, (c) => {
                const can = options?.channels.includes(c) ?? false;
                return (
                  <Pressable
                    key={c} accessibilityRole="tab" accessibilityLabel={c === "email" ? "Email" : "Text"} accessibilityState={{ selected: chan === c, disabled: !can }} testID={`chan-${c}`} disabled={!can}
                    onPress={() => patch({ chan: c })} style={({ hovered }: { hovered?: boolean }) => [s.segBtn, chan === c && s.segOn, hovered === true && chan !== c && s.hicOver, !can && s.dim]}
                  >
                    <Icon name={c === "email" ? "mail" : "sms"} size={13} color={chan === c ? "var(--ink)" : "var(--ink-3)"} />
                    <Text style={[s.segText, chan === c && s.segTextOn]}>{c === "email" ? "Email" : "Text"}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={mail ? "Send from" : "Text from"} testID="from-pick" onPress={(e) => { const p = pointOf(e); showFrom(p.x, p.y); }} style={({ hovered }: { hovered?: boolean }) => [s.pick, hovered === true && s.hicOver]}>
              <Text style={s.pickText}>{mail ? "From " : "From "}<Text style={s.pickName} testID="from-name">{inbox?.label ?? "No inbox"}</Text></Text>
              <Icon name="chevd" size={9} />
            </Pressable>
          </View>
          <Composer
            key={`${conv.id}:${chan}`}
            whoWillAnswer={inbox ? `Sends from ${inbox.label}${target ? ` to ${target}` : ""}` : "No inbox can send"}
            placeholder={mail ? "Write a reply…" : "Write a text…"}
            label={mail ? "Email" : "Text"}
            value={draft.text}
            enterSends={!mail}
            symbols={["at", "slash"]}
            sendsOutside={mail}
            lists={lists}
            attachments={attached}
            density={phone ? "compact" : "regular"}
            testID="contact-composer-field"
            onChange={(t) => patch({ text: t })}
            onAttach={() => { if (props.onAttach) props.onAttach(); else setNote("Attach from Files is not connected in this view"); }}
            onSubmit={(p) => { if (blocker === "") void send(p.text); else setNote(blocker); }}
            {...(mail ? {
              recipients: (
                <View>
                  <Recipients to={draft.to} cc={draft.cc} bcc={draft.bcc} me={inbox?.address ?? ""} onChange={(r) => patch({ to: r.to, cc: r.cc, bcc: r.bcc })} testID="contact-recipients" />
                  <TextInput
                    accessibilityLabel="Subject" placeholder="Subject" placeholderTextColor="var(--ink-3)" value={draft.subject} onChangeText={(t) => patch({ subject: t })} testID="contact-subject"
                    style={s.subject}
                  />
                </View>
              ),
            } : {})}
          />
          {note ? <Text style={s.note} accessibilityRole="alert" testID="contact-note">{note}</Text> : null}
        </View>
      </View>
      {menu.element}
    </View>
  );
}

/** The tab: a draw of the frame before the shell has given the Inbox its data. */
export function ContactTab(props: ContactTabProps): ReactElement {
  const data = useOptionalInboxData();
  if (!data) return <TabLoading />;
  return <Tab {...props} />;
}

const ink = (v: string): string => `var(${v})`;
const s = StyleSheet.create({
  main: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: ink("--win") },
  head: { height: 48, flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 18, paddingRight: 10, borderBottomWidth: 1, borderBottomColor: ink("--line") },
  hid: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0, flexShrink: 1 },
  name: { fontSize: 14, fontWeight: "600", color: ink("--ink") },
  co: { fontSize: 12.5, color: ink("--ink-3"), flexShrink: 1 },
  grow: { flex: 1 },
  hic: { height: 28, minWidth: 28, paddingHorizontal: 6, borderRadius: 7, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  hicText: { paddingHorizontal: 8 },
  hicOver: { backgroundColor: ink("--hover") },
  hicLabel: { fontSize: 12.5, fontWeight: "500", color: ink("--ink-2") },
  dim: { opacity: 0.4 },
  rlink: { flexDirection: "row", alignItems: "center", gap: 5, height: 24, paddingHorizontal: 7, borderRadius: 6, marginLeft: 8 },
  rlinkText: { fontSize: 12.5, color: ink("--ink-2") },
  mlink: { flexDirection: "row", alignItems: "center", gap: 5, height: 26, paddingHorizontal: 8, borderRadius: 6, marginLeft: 8 },
  mlinkText: { fontSize: 12.5, fontWeight: "600", color: ink("--accent") },
  offline: { fontSize: 12.5, color: ink("--ink-3"), paddingHorizontal: 18, paddingVertical: 6 },
  feed: { flex: 1 },
  col: { width: "100%", maxWidth: 740, alignSelf: "center", paddingHorizontal: 28, paddingTop: 18, paddingBottom: 20 },
  cmpWrap: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  cmpIn: { width: "100%", maxWidth: 740, alignSelf: "center" },
  ctop: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 6 },
  seg: { flexDirection: "row", padding: 2, borderRadius: 8, backgroundColor: ink("--hover") },
  segBtn: { height: 24, paddingHorizontal: 10, borderRadius: 6, flexDirection: "row", alignItems: "center", gap: 6 },
  segOn: { backgroundColor: ink("--win") },
  segText: { fontSize: 12.5, fontWeight: "500", color: ink("--ink-3") },
  segTextOn: { color: ink("--ink") },
  pick: { height: 24, paddingHorizontal: 6, borderRadius: 6, flexDirection: "row", alignItems: "center", gap: 5 },
  pickText: { fontSize: 12.5, color: ink("--ink-2") },
  pickName: { fontWeight: "500", color: ink("--ink") },
  subject: { paddingTop: 8, paddingBottom: 2, fontSize: 14, fontWeight: "600", color: ink("--ink"), backgroundColor: "transparent", borderWidth: 0 },
  note: { marginTop: 8, fontSize: 12.5, color: ink("--ink-2") },
  skFace: { width: 28, height: 28, borderRadius: 28, backgroundColor: ink("--hover"), marginRight: 10 },
  skBar: { height: 9, borderRadius: 5, backgroundColor: ink("--hover") },
  skSmall: { height: 8, width: "70%", marginTop: 8, opacity: 0.7 },
  skBlock: { width: "100%", maxWidth: 740, alignSelf: "center", paddingHorizontal: 28, paddingVertical: 14 },
  skComposer: { width: "100%", maxWidth: 740, alignSelf: "center", height: 96, borderRadius: 14, backgroundColor: ink("--hover") },
});
