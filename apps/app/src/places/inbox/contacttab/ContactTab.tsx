// Inbox > a contact's tab (spec 3.3, 2.18, 2.14): the whole history of one person across email, text and calls, newest at the foot next to the composer. Emails keep their quoted text folded;
// texts are bubbles; calls carry a player, a summary and a transcript; record chips link to the record. The header has the record link, Email, Text, Call, Follow
// and Ask. The composer switches Email and Text and picks the sending inbox (a reply goes out from the inbox the thread came in on); an agent's draft shows its Gate line with Send, Edit and
// Discard. Everything reads from the local copy and works offline: a send queues and the foot says so.
import { useOpenConnect } from "../../../shell/connect/context.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { ComposerLists, ComposerSend } from "../../../../../../ui/src/Composer/index.tsx";
import { uploadAttachments, uploadDeps } from "../../chats/conversation/actions.ts";
import { useOptionalShellRuntime } from "../../../shell/providers/runtime.tsx";
import { DeferredComposer as Composer } from "../../../../../../ui/src/Composer/Deferred.tsx";
// the header alone, so the Inbox does not pull the whole composer in before the deferred one loads
import { OutgoingHeader } from "../../../../../../ui/src/Composer/outgoing.tsx";
import type { ComposerSender, OutChannel } from "../../../../../../ui/src/Composer/outgoing.tsx";
import { Recipients } from "../../../../../../ui/src/Recipients/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { useInboxData, useOnline, useOptionalInboxData, useScreenQuery } from "../sidebar/data.tsx";
import { Face, Ghost, pointOf } from "../sidebar/parts.tsx";
import type { Mailbox } from "../sidebar/model.ts";
import { discardDraft, listSnippets, listTemplates, markRead, sendAgentDraft, sendEmail, sendText, setFollow, templateContent } from "./actions.ts";
import { QUICK_FORM_NOTE, askStart, conversationOf, makeQuickForm, startChannel as askChannel, switchText, withLink, withoutLink } from "./ask.ts";
import type { AskRequest } from "./ask.ts";
import { each } from "./each.ts";
import { Icon } from "./icons.tsx";
import { useMobileBack } from "../../../mobile/shell/back.ts";
import type { IconName } from "./icons.tsx";
import { followMenuEntries, quickEntries, templateEntries, threadMenuEntries } from "./menus.ts";
import {
  buildFeed, canSend, cannedLists, choicesFor, emailRef, firstName, draftCards, headerOf, initialDraft, messageOpen, namedTo, pickInbox, replyMessage, replyTarget, sendBlocker, startChannel, textTarget, threadMailbox, threadOpen,
} from "./model.ts";
import type { Chan, ComposerDraft, DraftCard, DraftRow, InboxChoice, MailThread, SendOptions, ThreadOut, ThreadsOut } from "./model.ts";
import { Bubbles, CallLine, DaySep, DraftBlock, EmailItem, MailHtmlStyle, QuietLine, ThreadCard } from "./parts.tsx";
import { usePhone } from "../softphone/phone.tsx";

export const SCREEN = "inbox.contact-tab";
type MailboxesOut = { mailboxes: Mailbox[] };
type DraftsOut = { drafts: DraftRow[] };

export interface ContactTabProps {
  conversationId: string;
  contactId?: string;
  /** Open the person's or company's record (the header link and a record chip). */
  onOpenRecord?(contactId: string, recordId?: string): void;
  /** Ask Vyre about this conversation: the contact when it has one, else the conversation itself, with the name the head shows. */
  onAsk?(contactId?: string, about?: { conversationId: string; title: string }): void;
  onDial?(number: string): void;
  /** Open Vyre Files to attach; the app answers with the attachments' file ids. */
  onAttach?(): void;
  onOpenAttachment?(name: string): void;
  /** Opened from a record's "Ask for these": the message is drafted for the person to read and send, with a quick form when one can be made. */
  ask?: AskRequest;
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

function BarButton({ icon, label, testID, onPress }: { icon: IconName; label: string; testID: string; onPress(x: number, y: number): void }): ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} testID={testID} onPress={(e) => { const p = pointOf(e); onPress(p.x, p.y); }} style={({ hovered }: { hovered?: boolean }) => [s.tool, hovered === true && s.hicOver]}>
      <Icon name={icon} size={15} color="var(--ink-3)" />
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
  const rt = useOptionalShellRuntime();
  const menu = useMenu();
  const width = useWindowDimensions().width;
  const mobileBack = useMobileBack();
  const phone = width > 0 && width < 560;
  const scroll = useRef<ScrollView | null>(null);
  // The star is the caller's own flag. The contract has the flag on the conversation but no writer yet, so a press holds it here until one lands (comment on the packet).
  const [starMine, setStarMine] = useState<boolean | null>(null);
  const state = { ...(conversationId ? { conversationId } : {}), ...(contactId ? { contactId } : {}) };
  const thread = useScreenQuery<ThreadOut>(SCREEN, "thread", state);
  // the contact's email threads, each whole (inbox.threads); "Show images" asks again with remote images allowed
  const [images, setImages] = useState(false);
  const threadsQ = useScreenQuery<ThreadsOut>(SCREEN, "threads", { ...state, ...(images ? { images: true } : {}) });
  const opts = useScreenQuery<SendOptions>(SCREEN, "options", state);
  const drafts = useScreenQuery<DraftsOut>(SCREEN, "drafts", contactId ? { contactId } : {});
  const boxes = useScreenQuery<MailboxesOut>("inbox.sidebar", "mailboxes");

  const ask = props.ask;
  const [senders, setSenders] = useState<ComposerSender[] | null>(null);
  const [sendersTick, setSendersTick] = useState(0);
  useEffect(() => {
    let live = true;
    void Promise.resolve(data.call("comms.senders.list", {})).then(
      (out) => { if (live) setSenders(sendersOf(out)); },
      () => { if (live) setSenders(null); },   // an older server: the send options' inboxes stand in
    );
    return () => { live = false; };
  }, [data, sendersTick]);
  const [over, setOver] = useState<Partial<ComposerDraft>>(() => (ask ? askStart(ask) : {}));
  // the quick form: on by default where one can be made; its link goes into the draft and comes out when the person turns it off
  const [formOn, setFormOn] = useState(ask?.form.available === true);
  const [formUrl, setFormUrl] = useState<string | undefined>();
  const [formBusy, setFormBusy] = useState(false);
  const formStarted = useRef(false);
  useEffect(() => {
    if (!ask || !ask.form.available || !formOn || formUrl || formStarted.current) return;
    formStarted.current = true;
    setFormBusy(true);
    makeQuickForm(data.call, ask.form, ask.id).then(
      (url) => { setFormUrl(url); setOver((o) => ({ ...o, text: withLink(ask, o.chan ?? askChannel(ask), o.text ?? "", url) })); },
      () => { setFormOn(false); formStarted.current = false; setNote("Could not make the quick form. The message is ready without it."); },
    ).finally(() => setFormBusy(false));
  }, [formOn]); // eslint-disable-line react-hooks/exhaustive-deps -- the form is made once per ask; data and ask do not change under it
  const [quotes, setQuotes] = useState<readonly string[]>([]);
  const [transcripts, setTranscripts] = useState<readonly string[]>([]);
  const [note, setNote] = useState("");
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<readonly string[]>([]);
  // threads and messages opened or closed by hand, signatures shown; what was new when the tab opened stays marked new for this visit, though opening reads it
  const [thOpen, setThOpen] = useState<Record<string, boolean>>({});
  const [msgOpen, setMsgOpen] = useState<Record<string, boolean>>({});
  const [sigs, setSigs] = useState<readonly string[]>([]);
  const freshRef = useRef<{ conv: string; ids: ReadonlySet<string> } | null>(null);
  const landed = useRef<string | null>(null);
  const [attached, setAttached] = useState<readonly { name: string }[]>([]);

  const dock = usePhone();
  const conv = conversationOf(thread, ask, data.clock().now);
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
    if (drafts.status === "ready") for (const d of drafts.data.drafts) if (d.draftedByAgent && !m.has(d.draftedByAgent)) m.set(d.draftedByAgent, agentName(d.draftedByAgent));
    return m;
  }, [boxes, drafts]);
  const mailThreads: readonly MailThread[] = threadsQ.status === "ready" ? threadsQ.data.threads : [];
  if (threadsQ.status === "ready" && freshRef.current?.conv !== conversationId) {
    freshRef.current = { conv: conversationId, ids: new Set(mailThreads.flatMap((t) => t.messages.filter((m) => m.unread).map((m) => m.message.id))) };
  }
  const fresh: ReadonlySet<string> = freshRef.current?.conv === conversationId ? freshRef.current.ids : new Set();
  // your own addresses: every mailbox you can send from or read, so "You" and "With ..." leave you out
  const mine = useMemo(() => {
    const m = new Set<string>();
    if (boxes.status === "ready") for (const b of boxes.data.mailboxes) if (b.address.includes("@")) m.add(b.address.toLowerCase());
    for (const x of senders ?? []) if (x.address.includes("@")) m.add(x.address.toLowerCase());
    return m;
  }, [boxes, senders]);
  const feed = useMemo(() => buildFeed(items, clock.now, clock.offsetMin, mailThreads), [items, clock.now, clock.offsetMin, mailThreads]);
  const cards = useMemo<DraftCard[]>(() => (drafts.status === "ready" ? draftCards(drafts.data.drafts, titles, agents) : []), [drafts, titles, agents]);

  const chan: Chan = over.chan ?? (conv ? startChannel(conv.lastChannel, options) : "email");
  const base = conv ? initialDraft(conv, chan, items, mailThreads, mine) : null;
  const draft: ComposerDraft | null = base ? { ...base, ...over, chan, from: { ...base.from, ...over.from } } : null;
  // every sender (comms.senders.list) when the server has the list; else the inboxes the send options name
  const choices: InboxChoice[] = senders
    ? senders.filter((x) => x.channel === (chan === "email" ? "email" : "text") && x.usable !== false).map((x) => ({ id: x.id, kind: chan === "email" ? "mailbox" as const : "number" as const, address: x.address, label: x.name, isDefault: x.default === true, senderId: x.id }))
    : choicesFor(chan, options, titles);
  const listed: ComposerSender[] = senders ?? choices.map((c) => ({ id: c.id, channel: chan === "email" ? "email" as const : "text" as const, name: c.label, address: c.address, via: chan === "email" ? "Mailboxes" : "Numbers", usable: true }));
  const inThread = draft?.th ? mailThreads.find((t) => t.threadId === draft.th) ?? null : null;
  // a reply goes out from the mailbox the thread is in, unless the person picks another
  const threadBox = inThread && chan === "email" ? threadMailbox(inThread, choices.map((c) => c.id)) : null;
  const inbox = draft && conv ? (choices.find((c) => c.id === draft.from[chan]) ?? choices.find((c) => c.id === threadBox) ?? pickInbox(choices, conv.mailboxIds)) : null;
  const textTo = conv ? (ask?.phone?.to ?? textTarget(conv, items)) : null;

  // the newest message is at the foot: open scrolled down, and again when something arrives; a thread with something new is landed on, subject first
  useEffect(() => { if (landed.current !== conversationId) scroll.current?.scrollToEnd?.({ animated: false }); }, [feed.length, cards.length]);
  // opening the conversation reads it
  const unread = conv?.unreadCount ?? 0;
  useEffect(() => { if (unread > 0) void markRead(data, conversationId); }, [conversationId, unread > 0]);

  // every hook above this line: the frame before the conversation arrives and the one after it must call the same hooks
  const openConnect = useOpenConnect();
  const [snippets, setSnippets] = useState<readonly { name: string; body: string }[]>([]);
  useEffect(() => { let live = true; void listSnippets(data).then((x) => { if (live) setSnippets(x); }, () => undefined); return () => { live = false; }; }, [data]);

  if (!conv || !draft) return <TabLoading />;

  const patch = (p: Partial<ComposerDraft>): void => setOver((o) => ({ ...o, ...p }));
  // Email and Text: a drafted ask follows the channel until the person has written their own words
  const pickChan = (next: Chan): void => patch(ask ? { chan: next, text: switchText(ask, chan, next, draft.text, formOn ? formUrl : undefined) } : { chan: next });
  const toggleForm = (): void => {
    if (!ask) return;
    const next = !formOn;
    setFormOn(next);
    if (!formUrl) return;
    setOver((o) => ({ ...o, text: next ? withLink(ask, o.chan ?? askChannel(ask), o.text ?? "", formUrl) : withoutLink(ask, o.chan ?? askChannel(ask), o.text ?? "", formUrl) }));
  };
  const toggled = (list: readonly string[], id: string): string[] => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const withBusy = async (key: string, run: () => Promise<void>): Promise<void> => {
    setBusy((b) => [...b, key]);
    try { await run(); } finally { setBusy((b) => b.filter((x) => x !== key)); }
  };
  const fail = (e: unknown): string => (e as { error?: { message?: string } }).error?.message ?? (e instanceof Error ? e.message : "Could not send");

  const send = async (text: string, files: ComposerSend["files"] = []): Promise<void> => {
    if (!inbox) return;
    try {
      // files dropped, pasted or picked in the reply are stored the way a chat stores its uploads, then go as the email's attachments or the text's pictures
      const fresh = files.filter((f) => f.fileId === undefined);
      const kept = files.flatMap((f) => (f.fileId === undefined ? [] : [f.fileId]));
      if (fresh.length > 0) setNote(fresh.length === 1 ? `Attaching ${fresh[0]!.name}` : `Attaching ${fresh.length} files`);
      const stored = fresh.length > 0 ? await uploadAttachments(uploadDeps({ call: data.call, ...(rt?.putBlob ? { putBlob: rt.putBlob.bind(rt) } : {}) }), fresh, `inbox-files:${conv.id}:${Date.now().toString(36)}`) : [];
      const fileIds = [...stored, ...kept];
      // in a thread the reply answers the newest message the sending mailbox holds; New email answers nothing
      const replyTo = draft.th === undefined ? undefined : inThread ? (replyMessage(inThread, inbox.id)?.id ?? null) : null;
      const d = { ...draft, text, ...(fileIds.length > 0 ? { fileIds } : {}), ...(replyTo !== undefined ? { replyTo } : {}) };
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
  const draftEdit = (card: DraftCard): void => { patch({ chan: card.channel, draftId: card.id, text: card.body, subject: card.subject, to: card.channel === "sms" ? [] : card.to, from: card.channel === "sms" ? { email: null, sms: card.mailboxId } : { email: card.mailboxId, sms: null } }); };
  const draftDiscard = (card: DraftCard): Promise<void> => withBusy(card.id, async () => {
    try { await discardDraft(data, card.id); if (over.draftId === card.id) setOver((o) => ({ ...o, text: "", draftId: null })); } catch (e) { setDraftNotes((n) => ({ ...n, [card.id]: fail(e) })); }
  });

  const showFollow = (x: number, y: number): void => {
    if (!conv.contactId) return;
    const id = conv.contactId;
    menu.show(followMenuEntries(conv.followed, conv.alertOnReplies, { follow: (f) => void setFollow(data, id, f), alert: (a) => void setFollow(data, id, true, a) }), x, y);
  };
  // the From list ends in Connect: a mailbox joins the list and is chosen; a Twilio account is added and its number is claimed from the Inbox
  const connectFrom = openConnect ? (c: OutChannel): void => {
    void openConnect(c === "email" ? { kind: "mailbox" } : { kind: "number" }).then((made) => {
      setSendersTick((n) => n + 1);
      if (made && c === "email") patch({ from: { ...draft.from, email: made.id } });
    }, () => setNote("Could not connect it. Try again."));
  } : undefined;
  // the dock (when one is mounted, `dock`) places the call and saves it to this conversation; otherwise the app's own handler, else the shell opens the dialer
  const dial = (): void => { const n = textTo ?? (conv.address.includes("@") ? null : conv.address); if (n && props.onDial) props.onDial(n); else if (n && dock) dock.dial(n, conv.contactId); else data.nav.openDialer(); };

  const lists: ComposerLists = cannedLists(conv, snippets);
  const hdr = headerOf(items);
  const starred = starMine ?? conv.starred === true;
  // Templates are the person's email designs: choosing one puts its text at the foot of the draft (and its subject in an empty subject); the last row opens the email builder
  const insertTemplate = (emailId: string): void => {
    void templateContent(data, emailId, firstName(conv.displayName)).then(
      (t) => patch({ text: `${draft.text}${draft.text && !draft.text.endsWith("\n") ? "\n" : ""}${t.text}`, ...(t.subject && !draft.subject ? { subject: t.subject } : {}) }),
      () => setNote("Could not open that template. Try again."),
    );
  };
  const showTemplates = (x: number, y: number): void => {
    void listTemplates(data).then(
      (rows) => menu.show(templateEntries(rows.map((r) => ({ t: r.name, body: r.emailId })), insertTemplate, () => data.nav.openEmailDesign?.()), x, y),
      () => setNote("Could not load your templates. Try again."),
    );
  };
  const showQuick = (x: number, y: number): void => menu.show(quickEntries(!!conv.contactId, { dial, openRecord: () => props.onOpenRecord?.(conv.contactId as string, hdr?.recordId), attach: () => { if (props.onAttach) props.onAttach(); else setNote("Attach from Files is not connected in this view"); } }), x, y);
  const mail = chan === "email";
  const unmatched = conv.needsMatch && !conv.contactId;
  // Replying in: the thread the reply goes into, Reply or Reply all, or a New email that starts its own thread
  const reTarget = (th: string | null, mode: "one" | "all" = draft.mode ?? "all"): void => {
    const t = th ? mailThreads.find((x) => x.threadId === th) : undefined;
    if (!t) { patch({ chan: "email", th: null, mode, to: conv.address.includes("@") ? [conv.address] : [], cc: [], subject: "" }); return; }
    const r = replyTarget(t, mode, mine);
    patch({ chan: "email", th: t.threadId, mode, to: r.to, cc: r.cc, subject: r.subject, from: { ...draft.from, email: null } });
  };
  // the people on the threads by name, so a reply's To and Cc read as names, not addresses
  const names = new Map<string, string>();
  for (const t of mailThreads) for (const p of t.participants) if (p.name) names.set(p.address.toLowerCase(), p.name);
  const named = (list: readonly (string | { email: string; name: string })[]): (string | { email: string; name: string })[] =>
    list.map((a) => (typeof a === "string" && names.has(a.toLowerCase()) ? { email: a, name: names.get(a.toLowerCase()) as string } : a));
  const showThreads = (x: number, y: number): void => menu.show(threadMenuEntries(mailThreads, draft.th ?? null, reTarget), x, y);

  const blocker = sendBlocker(draft, inbox, online, textTo);
  const target = mail ? draft.to.join(", ") : textTo ?? "";

  return (
    <View style={s.main} testID="contact-tab" accessibilityLabel={`Conversation with ${conv.displayName}`}>
      <View style={s.head} testID="contact-head">
        {mobileBack ? <Pressable accessibilityRole="button" accessibilityLabel="Back" testID="contact-back" onPress={() => mobileBack()} style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", marginLeft: -8 }}><View style={{ transform: [{ rotate: "180deg" }] }}><Icon name="chevr" size={16} color="var(--accent)" /></View></Pressable> : null}
        <View style={s.hid}>
          {unmatched ? <Ghost size={28} /> : <Face name={conv.displayName} seedId={conv.contactId ?? undefined} size={28} />}
          <Text accessibilityRole="header" aria-level={1} style={s.name} numberOfLines={1}>{conv.displayName}</Text>
          {phone || headSub(conv.displayName, conv.address, hdr?.company) === null ? null : <Text style={s.co} numberOfLines={1}>{headSub(conv.displayName, conv.address, hdr?.company)}</Text>}
        </View>
        {unmatched ? (
          <Pressable accessibilityRole="link" accessibilityLabel="Match to a record" testID="head-match" onPress={() => data.nav.openMatch(conv.id)} style={s.mlink}>
            <Icon name="link" size={12} color="var(--accent)" /><Text style={s.mlinkText}>Match to a record</Text>
          </Pressable>
        ) : conv.contactId && !phone ? (
          <Pressable accessibilityRole="link" accessibilityLabel={hdr ? `Open ${hdr.title}` : "Open the record"} testID="head-record" onPress={() => props.onOpenRecord?.(conv.contactId as string, hdr?.recordId)} style={({ hovered }: { hovered?: boolean }) => [s.rlink, hovered === true && s.hicOver]}>
            <Icon name="link" size={13} color="var(--ink-2)" /><Text style={s.rlinkText}>{hdr?.title ?? "Record"}</Text>
          </Pressable>
        ) : null}
        <View style={s.grow} />
        <HeadButton icon="mail" label="Email" testID="head-email" on={chan === "email"} disabled={!(options?.channels.includes("email") ?? false)} onPress={() => pickChan("email")} />
        <HeadButton icon="sms" label="Text" testID="head-text" on={chan === "sms"} disabled={!(options?.channels.includes("sms") ?? false)} onPress={() => pickChan("sms")} />
        <HeadButton icon="call" label="Call" testID="head-call" onPress={dial} />
        {conv.contactId ? <HeadButton icon="star" label={starred ? "Unstar" : "Star"} testID="head-star" on={starred} onPress={() => setStarMine(!starred)} /> : null}
        {conv.contactId ? <HeadButton icon="bell" label={conv.followed ? "Following" : "Follow"} testID="head-follow" on={conv.followed} onPress={showFollow} /> : null}
        {phone ? null : <HeadButton icon="ask" label="Ask" testID="head-ask" text="Ask" onPress={() => props.onAsk?.(conv.contactId, { conversationId: conv.id, title: hdr?.title ?? conv.displayName })} />}
      </View>
      {online ? null : <Text style={s.offline} accessibilityRole="alert" testID="contact-offline">Offline, showing your saved copy</Text>}

      <ScrollView ref={scroll} style={s.feed} contentContainerStyle={s.col} testID="contact-feed">
        {feed.length === 0 && cards.length === 0 ? <States kind="empty" title="No messages yet." icon="chat" /> : null}
        {each(feed, (f): ReactElement => {
          switch (f.kind) {
            case "day": return <DaySep key={f.key} label={f.label} />;
            case "thread": {
              const t = f.thread;
              const firstFresh = mailThreads.length > 0 && feed.find((x) => x.kind === "thread" && x.thread.messages.some((m) => fresh.has(m.message.id))) === f;
              return (
                <ThreadCard key={f.key} e={f} v={{
                  mine, fresh, now: clock.now, offsetMin: clock.offsetMin, narrow: phone,
                  open: threadOpen(t, mailThreads, fresh, thOpen),
                  msgOpen: (id) => { const m = t.messages.find((x) => x.message.id === id)?.message; return m ? messageOpen(t, m, fresh, msgOpen) : false; },
                  quoteOpen: (id) => quotes.includes(id), sigOpen: (id) => sigs.includes(id),
                  onToggle: () => setThOpen((o) => ({ ...o, [t.threadId]: !threadOpen(t, mailThreads, fresh, o) })),
                  onMessage: (id, open) => setMsgOpen((o) => ({ ...o, [id]: open })),
                  onQuote: (id) => setQuotes((q) => toggled(q, id)), onSig: (id) => setSigs((q) => toggled(q, id)), onImages: () => setImages(true),
                  onReply: (mode) => reTarget(t.threadId, mode),
                  viaOf: (id) => titles.get(id) ?? "",
                  chipsOf: (id) => { const i = items.find((x) => x.id === id); return i ? (emailRef(i).chips ?? []) : []; },
                  onChip: (title, recordId) => props.onOpenRecord?.(conv.contactId ?? "", recordId ?? title),
                  ...(props.onOpenAttachment ? { onAttachment: props.onOpenAttachment } : {}),
                  ...(firstFresh ? { onLayoutY: (y: number) => { if (landed.current === conversationId) return; landed.current = conversationId; scroll.current?.scrollTo?.({ y: Math.max(0, y - 16), animated: false }); } } : {}),
                }} />
              );
            }
            case "email": return <EmailItem key={f.key} e={f} who={conv.displayName} offsetMin={clock.offsetMin} quoteOpen={quotes.includes(f.key)} onQuote={() => setQuotes((q) => toggled(q, f.key))} {...(props.onOpenAttachment ? { onAttachment: props.onOpenAttachment } : {})} onChip={(title, recordId) => props.onOpenRecord?.(conv.contactId ?? "", recordId ?? title)} />;
            case "texts": return <Bubbles key={f.key} t={f} offsetMin={clock.offsetMin} />;
            case "call": return <CallLine key={f.key} c={f} offsetMin={clock.offsetMin} open={transcripts.includes(f.key)} onTranscript={() => setTranscripts((t) => toggled(t, f.key))} />;
            case "chip": return <QuietLine key={f.key} text={f.item.title ?? "Record"} testID={`chip-line:${f.item.id}`} />;
            case "note": return <QuietLine key={f.key} text={f.item.title ?? f.item.preview ?? ""} testID={`note:${f.item.id}`} />;
          }
        })}
        {each(cards, (d) => <DraftBlock key={d.id} d={d} note={draftNotes[d.id]} busy={busy.includes(d.id) || !online} onSend={() => void draftSend(d)} onEdit={() => draftEdit(d)} onDiscard={() => void draftDiscard(d)} />)}
      </ScrollView>

      <View style={s.cmpWrap} testID="contact-composer">
        <View style={s.cmpIn}>
          {ask ? (
            ask.form.available ? (
              <Pressable accessibilityRole="switch" accessibilityLabel="Add a quick form" accessibilityState={{ checked: formOn, disabled: formBusy }} aria-checked={formOn} disabled={formBusy} testID="quick-form-toggle" onPress={toggleForm} style={({ hovered }: { hovered?: boolean }) => [s.qf, hovered === true && s.hicOver]}>
                <View style={[s.qfBox, formOn && s.qfBoxOn]} />
                <Text style={s.qfText}>Add a quick form</Text>
                {formBusy ? <Text style={s.qfNote} testID="quick-form-busy">Making the link</Text> : null}
              </Pressable>
            ) : <Text style={s.qfNote} testID="quick-form-note">{QUICK_FORM_NOTE}</Text>
          ) : null}
          {mail && mailThreads.length > 0 ? (
            <View style={s.rin} testID="reply-in">
              {phone ? null : inThread ? <Text style={s.rinLabel} numberOfLines={1}>Replying in</Text> : <Text style={s.rinLabel} numberOfLines={1}>New email</Text>}
              <Pressable accessibilityRole="button" accessibilityLabel={inThread ? `Replying in ${inThread.subject}. Change the thread` : "New email, a separate thread. Reply in a thread instead"} testID="reply-in-pick" onPress={(e) => { const p = pointOf(e); showThreads(p.x, p.y); }} style={({ hovered }: { hovered?: boolean }) => [s.rinPick, hovered === true && s.hicOver]}>
                <Icon name={inThread ? "thread" : "edit"} size={13} />
                <Text style={s.rinName} numberOfLines={1}>{inThread ? inThread.subject : "Starts a separate thread"}</Text>
                <Icon name="chevd" size={9} />
              </Pressable>
              <View style={s.grow} />
              {inThread ? (
                <View style={s.seg} accessibilityRole="radiogroup" accessibilityLabel="Reply or reply all">
                  {each(["one", "all"] as const, (m) => (
                    <Pressable key={m} accessibilityRole="radio" accessibilityState={{ checked: (draft.mode ?? "all") === m }} aria-checked={(draft.mode ?? "all") === m} testID={`reply-mode-${m}`} onPress={() => reTarget(inThread.threadId, m)} style={[s.segBtn, (draft.mode ?? "all") === m && s.segOn]}>
                      <Text style={[s.segText, (draft.mode ?? "all") === m && s.segTextOn]}>{m === "one" ? "Reply" : "Reply all"}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
          <Composer
            key={`${conv.id}:${chan}`}
            whoWillAnswer={inbox ? "" : "No inbox can send"}
            placeholder={mail ? "Write a reply…" : "Write a text…"}
            label={mail ? "Email" : "Text"}
            value={draft.text}
            enterSends={!mail}
            symbols={[]}
            barExtra={(
              <View style={s.bx}>
                <BarButton icon="tpl" label="Templates" testID="composer-templates" onPress={showTemplates} />
                <BarButton icon="bolt" label="Quick actions" testID="composer-quick" onPress={showQuick} />
                <Pressable accessibilityRole="button" accessibilityLabel="Ask" testID="composer-ask" onPress={() => props.onAsk?.(conv.contactId, { conversationId: conv.id, title: hdr?.title ?? conv.displayName })} style={({ hovered }: { hovered?: boolean }) => [s.askChip, hovered === true && s.hicOver]}>
                  <Face name="intake" size={16} round={false} /><Text style={s.askText}>Ask</Text><Icon name="chevd" size={9} />
                </Pressable>
              </View>
            )}
            sendsOutside
            lists={lists}
            attachments={attached}
            density={phone ? "compact" : "regular"}
            testID="contact-composer-field"
            onChange={(t) => patch({ text: t })}
            onAttach={() => { if (props.onAttach) props.onAttach(); else setNote("Attach from Files is not connected in this view"); }}
            onSubmit={(p) => { if (blocker === "") void send(p.text, p.files); else setNote(blocker); }}
            recipients={(
              <OutgoingHeader
                channel={mail ? "email" : "text"}
                channels={(["email", "sms"] as const).filter((c) => options?.channels.includes(c) ?? false).map((c) => (c === "email" ? "email" as const : "text" as const))}
                onChannel={(c) => pickChan(c === "email" ? "email" : "sms")}
                to={mail
                  ? <Recipients to={named(namedTo(draft.to, conv.address, unmatched ? null : conv.displayName))} cc={named(draft.cc)} bcc={draft.bcc} me={inbox?.address ?? ""} hideToLabel onChange={(r) => patch({ to: r.to, cc: r.cc, bcc: r.bcc })} testID="contact-recipients" />
                  : <Text style={s.toText} numberOfLines={1}>{textTo ? `${conv.displayName} \u00b7 ${textTo}` : "No phone number for this contact"}</Text>}
                senders={listed}
                senderId={inbox?.id ?? null}
                onSender={(id) => patch({ from: { ...draft.from, [chan]: id } })}
                {...(connectFrom ? { onConnect: connectFrom } : {})}
                {...(mail && !inThread ? { subject: draft.subject, onSubject: (t: string) => patch({ subject: t }) } : {})}
              />
            )}
          />
          {note ? <Text style={s.note} accessibilityRole="alert" testID="contact-note">{note}</Text> : null}
        </View>
      </View>
      {menu.element}
      <MailHtmlStyle />
    </View>
  );
}

/** The tab: a draw of the frame before the shell has given the Inbox its data. */
/** comms.senders.list as the From picker reads it. */
export function sendersOf(out: unknown): ComposerSender[] {
  const rows = (out as { senders?: { id: string; channel: "email" | "text"; name: string; address: string; via: string; provider?: string; default?: boolean; usable?: boolean; why?: string }[] } | undefined)?.senders ?? [];
  return rows.map((x) => ({ id: x.id, channel: x.channel, name: x.name || x.address, address: x.address, via: x.via, ...(x.provider ? { provider: x.provider } : {}), ...(x.default ? { default: true } : {}), usable: x.usable !== false, ...(x.why ? { why: x.why } : {}) }));
}

/** The quiet line beside a contact's name: the company, else the address. A contact with no name is called by its address, and the line then says nothing rather than say it twice. */
export function headSub(displayName: string, address: string, company: string | undefined): string | null {
  if (company !== undefined && company !== "") return company;
  return displayName.trim().toLowerCase() === address.trim().toLowerCase() ? null : address;
}

export function ContactTab(props: ContactTabProps): ReactElement {
  const data = useOptionalInboxData();
  if (!data) return <TabLoading />;
  return <Tab {...props} />;
}

const ink = (v: string): string => `var(${v})`;
const s = StyleSheet.create({
  qf: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", paddingVertical: 4, paddingHorizontal: 6, borderRadius: 6 },
  qfBox: { width: 14, height: 14, borderRadius: 4, borderWidth: 1, borderColor: ink("--line-2") },
  qfBoxOn: { backgroundColor: ink("--accent"), borderColor: ink("--accent") },
  qfText: { fontSize: 12.5, color: ink("--ink-2") },
  qfNote: { fontSize: 12, color: ink("--ink-3"), paddingVertical: 4, paddingHorizontal: 6 },
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
  toText: { fontSize: 13, color: ink("--ink") },
  rin: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4, paddingBottom: 6, minWidth: 0 },
  rinLabel: { fontSize: 12.5, color: ink("--ink-3"), flexShrink: 0 },
  rinPick: { flexDirection: "row", alignItems: "center", gap: 5, height: 24, paddingHorizontal: 6, borderRadius: 6, minWidth: 0, flexShrink: 1 },
  rinName: { fontSize: 12.5, fontWeight: "500", color: ink("--ink"), flexShrink: 1 },
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
  bx: { flexDirection: "row", alignItems: "center", gap: 2 },
  tool: { width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  askChip: { height: 26, paddingLeft: 5, paddingRight: 7, borderRadius: 7, flexDirection: "row", alignItems: "center", gap: 5, marginLeft: 2 },
  askText: { fontSize: 12.5, fontWeight: "600", color: ink("--accent") },
  skFace: { width: 28, height: 28, borderRadius: 28, backgroundColor: ink("--hover"), marginRight: 10 },
  skBar: { height: 9, borderRadius: 5, backgroundColor: ink("--hover") },
  skSmall: { height: 8, width: "70%", marginTop: 8, opacity: 0.7 },
  skBlock: { width: "100%", maxWidth: 740, alignSelf: "center", paddingHorizontal: 28, paddingVertical: 14 },
  skComposer: { width: "100%", maxWidth: 740, alignSelf: "center", height: 96, borderRadius: 14, backgroundColor: ink("--hover") },
});
