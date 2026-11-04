// One entry of the conversation. Yours is a bubble on the right; anyone else's has a header (face, name, time) when the author changes; an agent's work folds into one line; native
// cards (question, plan, terminal, changeset, file) sit under the text; an error is one inline row (what, why, next). Hover shows Copy and Edit and the rest; right-click opens the same
// list; the keyboard reaches both. Every row is memoised on its item, so a streaming message re-renders alone.
import { HelperRow } from "./helper-row.tsx";
import { CrewStrip } from "../crew/strip.tsx";
import { memberFromBlock, memberOf } from "../crew/status.ts";
import { holdsOf, withTeammates } from "../crew/model.ts";
import { FROM_THREAD_LINE } from "../crew/also.tsx";
import { citable, citeBody, citeRender } from "../crew/cite.tsx";
import type { CrewMember, CrewStatusOut } from "../crew/model.ts";
import { useLinkState } from "../../../../../../ui/src/reach/index.tsx";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { menuTrigger, reportProblem } from "../../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Sheet } from "../../../mobile/sheets/Sheet.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { isItem } from "../../../../../../ui/src/Menu/props.ts";
import { ActivityLine, LiveBody } from "./ActivityLine.tsx";
import { MarkdownBlocks, StreamText } from "../../../../../../ui/src/stream/index.ts";
import type { StreamStore } from "../../../../../../ui/src/stream/index.ts";
import { KeptAside } from "./KeptAside.tsx";
import { LinkCard } from "../../../../../../ui/src/blocks/link-card/LinkCard.tsx";
import { DraftCard, ProviderDraftCard } from "./draft-card.tsx";
import { linkCardOf } from "../../../../../../ui/src/blocks/link-card/model.ts";
import type { LinkCardData } from "../../../../../../ui/src/blocks/link-card/model.ts";
import { doneByState, draftOf, heldTaskOf, probeOf, providerDraftOf, stateOf } from "../../../../../../ui/src/blocks/link-card/state.ts";
import type { CardState } from "../../../../../../ui/src/blocks/link-card/state.ts";
import { useThreadMemory } from "../memory/thread.tsx";
import { rememberMessage } from "../memory/actions.ts";
import { BlockViewA, isPartOneType } from "../../../../../../ui/src/blocks/impl-a/index.tsx";
import type { BlockHost } from "../../../../../../ui/src/blocks/impl-a/index.tsx";
import { Face } from "../needsyou/parts.tsx";
import { ReplyHover } from "../details/ReplyCard.tsx";
import type { ReplyDetailsActions } from "../details/ReplyCard.tsx";
import { LearnedLines } from "../memory/Learned.tsx";
import type { MenuMessage, ShowMenu } from "../memory/menu.tsx";
import { SubjectText, useSubjectBlocks } from "../memory/Subjects.tsx";
import { ReplyMemory } from "../memory/Used.tsx";
import { AgentFileProposal, PlanFileCard, isPlanFile, isProposal } from "./proposal.tsx";
import { Fold, Glyph, IconButton, TextButton } from "./parts.tsx";
import { ApprovalCard } from "./approval.tsx";
import { useFollow } from "./use-follow.ts";
import { CrewResultCard, CrewStartLine, isCrewResult, isCrewStart } from "./crew-card.tsx";
import { GoalCard, goalBlockOf } from "../goals/GoalCard.tsx";
import { KeyRequestCard, isKeyRequest } from "./keyrequest.tsx";
import { AccessRequestCard, isAccessRequest } from "./accessrequest.tsx";
import { RedactRequestCard, isRedactRequest } from "./redactrequest.tsx";
import { ChecklistCard, isChecklist } from "./checklist.tsx";
import { HookLineRow, HookSteps } from "./hookline.tsx";
import { NoteOfferCard, isNoteOffer } from "./noteoffer.tsx";
import { InstallCard, isInstallPlan } from "../install/InstallCard.tsx";
import { QuoteCard, WebPageCard, isQuote, isWebPage } from "./webpage.tsx";
import { ChromeStepCard, HeldSendCard, isChromeHeld, isChromeStep } from "./chrome-cards.tsx";
import type { ChromeCardActions } from "./chrome-cards.tsx";
import { MountCard } from "./mountcard.tsx";
import { TerminalCard } from "./TerminalCard.tsx";
import { RunCode } from "./RunCode.tsx";
import { LiveCard } from "./LiveCard.tsx";
import type { LiveCardConfig } from "./LiveCard.tsx";
import type { RunCodeConfig } from "./RunCode.tsx";
import { commandOf } from "../terminal/runthis.ts";
import { mountOffers } from "./mountcard.ts";
import { useRefChips } from "./ref-chips.tsx";
import { AttachmentChips, LinkedText, MountRefs, refsOf } from "./attachments.tsx";
import { unnamed } from "../names.ts";
import type { ConversationData } from "./data.tsx";
import type { GlyphName } from "./parts.tsx";
import { hookLineOf, hookLineText, pokeLine, pokedBy, reportLabel, bodyBlocks, cardLine, collect, errorRow, isCard, isErrorBlock, isSystemLine, isTurnStatus, onBehalfOf, planSteps, questionOptions, statusView, terminalAskOf, workOf } from "./model.ts";
import type { CardLine, Item, Message } from "./model.ts";
import { MARK } from "./marks.ts";
import type { ReplySummary } from "./replies.ts";
import { ThreadFooter } from "../thread-replies/ThreadFooter.tsx";
import { AlsoSentMark } from "../thread-replies/AlsoSentMark.tsx";
import type { Clock } from "../rightpane/model.ts";
import { TimePop } from "../../../../../../ui/src/Time/index.tsx";

/** A principal id left in someone's words (an agent printed `usr_...`) shows as the name it stands for, when the Space knows it. */
export function namedIds(body: string, nameOf?: (id: string) => string): string {
  if (!nameOf || !/usr_[0-9a-f]{8,}/.test(body)) return body;
  return body.replace(/\busr_[0-9a-f]{8,}\b/g, (id) => { const n = nameOf(id); return n && n !== id && !n.startsWith("usr_") ? n : id; });
}

export interface MessageActions {
  copy(text: string): void;
  edit(messageId: string, body: string): void;
  setPinned(messageId: string, pinned: boolean): void;
  react(messageId: string, emoji: string, remove: boolean): void;
  /** Opens the reaction picker where you pressed. */
  pickReaction?(messageId: string, x: number, y: number): void;
  /** Only people talk here: no agent is in this chat. */
  humanChat?: boolean;
  openThread(messageId: string): void;
  /** In a thread: the messages that were also sent to the chat (a copy from this thread is there). They carry the "Also sent to the chat" mark. */
  alsoSent?: ReadonlySet<string>;
  /** In a thread: the live "Thinking" line carries the agent's own face, not the product mark. */
  faceInThread?: boolean;
  remove(messageId: string): void;
  openAgent(agentId: string): void;
  openBeside(kind: string, id: string): void;
  /** A goal's page, from a goal card in the chat. Left out where the shell has no such page. */
  openGoal?(goalId: string): void;
  answer(blockId: string, answer: unknown): void;
  approvePlan(planId: string): void;
  retryTurn(turnId: string): void;
  /** Run the turn that made this reply once more: "Regenerate" in an agent reply's menu. Left out where the chat cannot. */
  regenerate?(messageId: string): void;
  /** Mark the chat unread from this message on (threads.mark_unread_from, by its sequence number). */
  markUnreadFrom?(seq: number): void;
  /** Copies the plain link to this message (/c/<thread>#<message>). Left out where the chat has no address. */
  copyLink?(messageId: string): void;
  /** The rows of Details on a failed turn, read from the turn when it opens. */
  turnDetail?(turnId: string): Promise<[string, string][]>;
  errorNext(key: string, turnId?: string): void;
  /** True once the person has a working AI account (read after "Connect your AI"). Left out where the chat cannot tell. */
  accountReady?(): Promise<boolean>;
  retrySend(messageId: string): void;
  discardSend(messageId: string): void;
  showMenu(items: readonly MenuEntry[], x: number, y: number, label: string): void;
  /** A reply's hover card on its agent's face and name, and Details in its menu (the right pane's Details tab). Absent where the shell has no right pane. */
  details?: ReplyDetailsActions;
  /** The memory items of the message menu (Remember This, Add to a Page, Forget This); absent where the chat has no memory. */
  memoryEntries?: (m: MenuMessage, x: number, y: number, show: ShowMenu) => MenuEntry[];
  /** Branch the chat into a new one at this message. */
  fork?(messageId: string): void;
  /** Make a task from this message, linked back to it. */
  makeTask?(messageId: string): void;
  /** Ask an agent to answer this message, as if it had been named (owner ruling, 3 Nov 2026): opens the channel's agent picker where you pressed. Left out where no agent can be asked. */
  askAgent?(messageId: string, x: number, y: number): void;
  /** The reader's side of an agent's message for its person (lane l-agentdm): who reads, and mute that person's agents for the rest of the day. Absent where the shell cannot. */
  /** What the buttons on an agent's cards from the person's own Chrome do (Send, Edit, Don't send, Watch, Take over); without it they show and do nothing. */
  chrome?: ChromeCardActions;
  agentMute?: { me: string; mute(personId: string): void; /** the one message the quiet mute line goes under; absent: none */ offerFor?: string | null };
  /** Share this message to a channel or a person: opens the list of places at the point given. */
  share?(messageId: string, x: number, y: number): void;
  /** What the turn behind a reply being written is doing: the live line under it (steps, thinking). */
  activityOf?(rowId: string): import("../../../shell/session/turn-streams.ts").ActivityStore | undefined;
  /** The chat has two or more people in it: an agent's answer is for all of them, and carries the buttons that turn it into work (Make task, Remember). */
  withPeople?: boolean;
  /** A person's or agent's name for an id; a plain word where there is none. */
  nameOf?(id: string): string;
  /** Open another chat on a message (the line a fork starts with). */
  openMessage?(threadId: string, messageId: string): void;
  /** The crew strip: the live read, the open peek, and what its buttons do. Without it the strip draws from the helpers' own blocks and its rows do nothing. */
  crew?: { status: CrewStatusOut | null; selected: string | null; peek(helperThreadId: string): void; stopAll(): void; openPane(): void; retry(helperThreadId: string): void; merge(jobIds: readonly string[]): void };
  /** A hook line's Edit or Details: the Hooks tab of the right pane at that hook. */
  openHooks?(hookId: string | undefined): void;
  /** What files and links in a message need: lookups, opening beside the chat, copying. Left out in a place that cannot open them. */
  files?: Pick<ConversationData, "call" | "nav" | "copy" | "threadId" | "changes" | "nameOf">;
  /** The agents of this chat (for a Mount card, which shares the new folder with them) and the sheet that connects a folder. Left out where the shell has no Files. */
  mountCard?: { agents: readonly { id: string; name: string }[]; data: Pick<ConversationData, "call" | "mountSheet"> };
  /** What a Run this card needs: the capability door, a key for a new session, who asked, and how to show a session. Left out where the shell has no terminal. */
  /** The live card for a screenshot block marked live. Absent: it is the plain card. */
  liveCard?: LiveCardConfig;
  /** Run on a one-line shell block in a message. Absent: a code block is just the code. */
  runCode?: RunCodeConfig;
  terminalCard?: { deps: { call(cap: string, input: unknown): Promise<unknown>; newKey(): string }; agentId?: string; copy(text: string): void; openTerminal(terminalId: string): void };
  /** What the shared native blocks (changeset, plan, question, terminal, deploy) call: capabilities as the person, and tabs beside the chat. */
  host: BlockHost;
}

const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});

export interface MessageViewProps {
  item: Item;
  actions: MessageActions;
  meId: string;
  /** The stream of a message still being written. */
  stream?: StreamStore | undefined;
  /** For your own message that has not been confirmed yet. */
  sending?: "sending" | "failed" | undefined;
  /** Opens the work fold of this message from the start (a live one always shows its steps). */
  openWork?: boolean;
  /** Find in chat: this message matches, or is the match the person is on. */
  mark?: "match" | "active" | "selected" | undefined;
  /** The thread under this message, when anyone has replied in it: the line that opens it. */
  replies?: { s: ReplySummary; clock: Clock } | undefined;
}

/** Where a forked chat came from: the first line of a fork carries the chat, the message and the chat's title. */
export function forkOrigin(m: Pick<Message, "blocks">): { threadId: string; messageId: string; title: string } | null {
  const b = m.blocks.find((x) => x.type === "fork_origin");
  const d = b && typeof b.data === "object" && b.data !== null ? (b.data as Record<string, unknown>) : null;
  return d && typeof d["threadId"] === "string" && typeof d["messageId"] === "string" ? { threadId: d["threadId"], messageId: d["messageId"], title: typeof d["title"] === "string" ? d["title"] : "another chat" } : null;
}

export const MessageView = memo(function MessageView(props: MessageViewProps): ReactElement | null {
  const { item } = props;
  if (item.kind === "day") return <Text testID={`day-${item.key}`} accessibilityRole="header" style={st.day}>{item.label}</Text>;
  if (item.kind === "event") {
    const link = linkCardOf(item.message.blocks.find((x) => x.type === "link_card") ?? { type: "", data: null });
    if (link && link.lead === "Aside" && link.body) return <KeptAside id={item.message.messageId} question={link.title} body={link.body} time={item.time} />;
    if (link) {
      const b = item.message.blocks.find((x) => x.type === "link_card")!;
      return (
        <View testID={`event-${item.key}`} style={[st.event, (link.style === "noted" || link.style === "question") && st.eventCentre]}>
          {link.style === "noted" ? <LinkCardView id={String(b.id)} data={link} actions={props.actions} size={13} trusted={item.message.kind === "system"} time={item.time} /> : <>
            <View style={st.eventCard}><LinkCardView id={String(b.id)} data={link} actions={props.actions} size={13} trusted={item.message.kind === "system"} /></View>
            {link.style === "question" ? null : <TimeTip item={item}><Text style={st.eventTime}>{item.time}</Text></TimeTip>}
          </>}
        </View>
      );
    }
    const hookLine = hookLineOf(item.message);
    const origin = forkOrigin(item.message);
    if (origin && props.actions.openMessage) {
      const go = props.actions.openMessage;
      return (
        <View testID={`event-${item.key}`} accessibilityRole="text" style={st.event}>
          <Glyph name="fork" size={13} color="var(--ink-4)" />
          <Text style={st.eventText}>
            {"Forked from "}
            <Text testID={`fork-origin-${item.key}`} accessibilityRole="link" onPress={() => go(origin.threadId, origin.messageId)} style={st.eventLink}>{origin.title}</Text>
          </Text>
          <TimeTip item={item}><Text style={st.eventTime}>{item.time}</Text></TimeTip>
        </View>
      );
    }
    if (hookLine && props.actions.files) {
      // a hook line (lane l-hooks): the lock where other lines have a dot, the lead words in ink, the way forward quiet
      return <HookLineRow id={item.key} line={hookLine} words={hookLineText(hookLine, props.actions.nameOf ?? unnamed)} threadId={props.actions.files.threadId} call={props.actions.files.call} {...(props.actions.openHooks ? { open: (hookId: string) => props.actions.openHooks?.(hookId) } : {})} stepsBelow={item.stepsBelow === true} st={{ event: st.event, text: st.hookText, lead: st.hookLead, act: st.hookAct }} />;
    }
    return (
      <View testID={`event-${item.key}`} accessibilityRole="text" style={st.event}>
        <View style={st.eventDot} />
        <Text style={st.eventText}>{pokeLine(item.message, props.actions.nameOf ?? unnamed) ?? item.text}</Text>
        <TimeTip item={item}><Text style={st.eventTime}>{item.time}</Text></TimeTip>
      </View>
    );
  }
  return item.kind === "me" ? <Mine {...props} item={item} /> : <Theirs {...props} item={item} />;
});

/* ---------- the hover bar and the menu: the same list in both ---------- */

const firstName = (name: string): string => name.split(" ")[0] || name;

/** A message's time with the hover card (full date, Space time, yours) in a shared place; plain in a private one. */
function TimeTip({ item, children }: { item: { timeTitle?: string; message: { createdAt: number } }; children: ReactElement }): ReactElement {
  return item.timeTitle ? <TimePop at={item.message.createdAt}>{children}</TimePop> : children;
}

export function menuFor(m: Message, mine: boolean, a: MessageActions, onEdit: () => void, at: { x: number; y: number } = { x: 0, y: 0 }): MenuEntry[] {
  // groups, split by a separator: read and write it, then turn it into something, then keep it, then how it was made, then remove it last
  const talk = m.kind !== "system" && m.kind !== "quiet";
  const write: MenuEntry[] = [{ label: "Copy", onSelect: () => a.copy(m.body) }];
  if (a.copyLink) write.push({ label: "Copy Link", onSelect: () => a.copyLink!(m.messageId) });
  if (mine && m.kind === "text") write.push({ label: "Edit", onSelect: onEdit });
  const turn: MenuEntry[] = [{ label: "Reply in Thread", onSelect: () => a.openThread(m.messageId) }];
  // an agent's reply cannot be edited by you; it can be asked again
  if (!mine && m.author.kind === "agent" && m.kind !== "system" && m.kind !== "quiet" && a.regenerate) turn.push({ label: "Regenerate", onSelect: () => a.regenerate!(m.messageId) });
  if (a.askAgent && talk) turn.push({ label: "Ask an Agent…", onSelect: () => a.askAgent!(m.messageId, at.x, at.y) });
  if (a.makeTask && talk) turn.push({ label: "Make a Task", onSelect: () => a.makeTask!(m.messageId) });
  if (a.share && talk) turn.push({ label: "Share to...", onSelect: () => a.share!(m.messageId, at.x, at.y) });
  if (a.fork && talk) turn.push({ label: "Fork From Here", onSelect: () => a.fork!(m.messageId) });
  const keep: MenuEntry[] = [
    { label: m.pinned ? "Unpin Message" : "Pin Message", onSelect: () => a.setPinned(m.messageId, !m.pinned) },
    { label: "Add Reaction", onSelect: () => (a.pickReaction ? a.pickReaction(m.messageId, at.x, at.y) : a.react(m.messageId, "👍", false)) },
  ];
  if (a.markUnreadFrom && !m.messageId.startsWith("pending:")) keep.push({ label: "Mark Unread From Here", onSelect: () => a.markUnreadFrom!(m.threadSeq) });
  if (m.kind !== "quiet" && a.memoryEntries) keep.push(...a.memoryEntries({ messageId: m.messageId, body: m.body, createdAt: m.createdAt }, at.x, at.y, a.showMenu));
  const how: MenuEntry[] = [];
  // how an agent's reply was made: the right pane's Details tab (what the agent knew is a section of it)
  if (!mine && a.details && m.author.kind === "agent") how.push({ label: "Details", onSelect: () => a.details!.open(m.messageId) });
  const ob = onBehalfOf(m);
  if (ob && a.agentMute && ob.teammate === a.agentMute.me) how.push({ label: `Mute Agent Messages From ${firstName(a.nameOf ? a.nameOf(ob.person) : "Them")} for Today`, onSelect: () => a.agentMute!.mute(ob.person) });
  const last: MenuEntry[] = mine ? [{ label: "Delete", danger: true, onSelect: () => a.remove(m.messageId) }] : [];
  const out: MenuEntry[] = [];
  for (const group of [write, turn, keep, how, last]) { if (group.length === 0) continue; if (out.length > 0) out.push({ separator: true }); out.push(...group); }
  return out;
}

/** The bar is drawn only while the row is hovered or has focus: fifty rows that each hold a hidden bar of buttons were most of what the first frame cost. The empty toolbar stays, so the row's size and test hook never change. */
/** Actions by who wrote it and where: an agent's message copies, threads, forks and pins; your own with an agent copies and edits; people talking get reactions and threads. Fork never appears where only people talk. The rest is under More. */
export function HoverBar({ m, mine, a, onEdit, visible, byAgent = false }: { m: Message; mine: boolean; a: MessageActions; onEdit: () => void; visible: boolean; byAgent?: boolean }): ReactElement {
  const bar: { icon: GlyphName; label: string; run: (x: number, y: number) => void }[] = [];
  const memory = useThreadMemory();
  const talk = m.kind !== "system" && m.kind !== "quiet";
  if (byAgent) {
    bar.push({ icon: "copy", label: "Copy", run: () => a.copy(m.body) });
    bar.push({ icon: "reply", label: "Reply in thread", run: () => a.openThread(m.messageId) });
    if (a.fork && talk) bar.push({ icon: "fork", label: "Fork from here", run: () => a.fork!(m.messageId) });
    if (talk) bar.push({ icon: "pin", label: m.pinned ? "Unpin" : "Pin", run: () => a.setPinned(m.messageId, !m.pinned) });
    // an agent's answer in a chat of people can become work or a memory in one tap, from here and from the long-press sheet; nothing of it is drawn at rest
    if (a.withPeople === true && a.makeTask && talk && m.body.trim() !== "") bar.push({ icon: "task", label: "Make task", run: () => a.makeTask!(m.messageId) });
    if (a.withPeople === true && memory && talk && m.body.trim() !== "") bar.push({ icon: "remember", label: "Remember", run: () => { void rememberMessage(memory.memory, memory.threadId, { messageId: m.messageId, body: m.body }, memory.flash); } });
  } else if (mine && a.humanChat !== true) {
    bar.push({ icon: "copy", label: "Copy", run: () => a.copy(m.body) });
    if (m.kind === "text") bar.push({ icon: "edit", label: "Edit", run: onEdit });
    bar.push({ icon: "reply", label: "Reply in thread", run: () => a.openThread(m.messageId) });
    if (a.askAgent && talk) bar.push({ icon: "spark", label: "Ask an agent", run: (x, y) => a.askAgent!(m.messageId, x, y) });
  } else {
    if (a.pickReaction && talk) bar.push({ icon: "smile", label: "React", run: (x, y) => a.pickReaction!(m.messageId, x, y) });
    bar.push({ icon: "reply", label: "Reply in thread", run: () => a.openThread(m.messageId) });
    if (a.askAgent && talk) bar.push({ icon: "spark", label: "Ask an agent", run: (x, y) => a.askAgent!(m.messageId, x, y) });
    if (mine && m.kind === "text") bar.push({ icon: "edit", label: "Edit", run: onEdit });
  }
  return (
    <View testID={`hover-${m.messageId}`} accessibilityRole="toolbar" accessibilityLabel="Message actions" style={[st.hover, mine ? st.hoverMine : st.hoverTheirs, { opacity: visible ? 1 : 0 }, !visible && { width: 0, borderWidth: 0 }]}>
      {visible ? collect(bar, (b) => <IconButton key={b.label} icon={b.icon} label={b.label} size={24} testID={`act-${b.label.split(" ")[0]?.toLowerCase()}-${m.messageId}`} onPress={(x, y) => b.run(x, y)} />) : null}
      {visible ? <IconButton icon="more" label="More" size={24} testID={`act-more-${m.messageId}`} onPress={(x, y) => a.showMenu(menuFor(m, mine, a, onEdit, { x, y }), x, y, "Message")} /> : null}
    </View>
  );
}

/** A phone has no hover: the bar is not drawn and a long press opens the same actions as a sheet. */
const PHONE_BELOW = 560;
const LONG_PRESS_MS = 450;

function useHover(onLong?: () => void): { over: boolean; focus: boolean; phone: boolean; props: Record<string, unknown> } {
  const [over, setOver] = useState(false);
  const [focus, setFocus] = useState(false);
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < PHONE_BELOW;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = (): void => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  type Blur = { currentTarget: { contains(n: unknown): boolean }; relatedTarget: unknown };
  if (phone) {
    return {
      over: false, focus: false, phone,
      props: webProps({ onTouchStart: () => { stop(); timer.current = setTimeout(() => { timer.current = null; onLong?.(); }, LONG_PRESS_MS); }, onTouchMove: stop, onTouchEnd: stop, onTouchCancel: stop }),
    };
  }
  return {
    over, focus, phone,
    // The row takes focus so the bar can be reached from the keyboard; the bar draws while focus is on the row or inside it.
    props: webProps({ tabIndex: 0, onMouseEnter: () => setOver(true), onMouseLeave: () => setOver(false), onFocus: () => setFocus(true), onBlur: (e: Blur) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocus(false); } }),
  };
}

/** The message's actions as a bottom sheet (a long press on a phone): the same list as the menu, one row each. */
function ActionSheet({ open, entries, onClose }: { open: boolean; entries: readonly MenuEntry[]; onClose: () => void }): ReactElement | null {
  return (
    <Sheet open={open} title="Message" onClose={onClose}>
      {entries.filter(isItem).map((e) => <Row key={e.label} id={`sheet-act-${e.label.toLowerCase().replace(/\s+/g, "-")}`} title={e.label} onPress={() => { onClose(); e.onSelect?.(); }} />)}
    </Sheet>
  );
}

/* ---------- yours ---------- */

/** The line under a message with a thread; a press opens the thread beside the chat. */
function Replies({ m, replies, actions, mine }: { m: Message; replies: MessageViewProps["replies"]; actions: MessageActions; mine: boolean }): ReactElement | null {
  if (!replies) return null;
  return <ThreadFooter s={replies.s} threadId={replies.s.threadId} clock={replies.clock} nameOf={actions.nameOf ?? unnamed} mine={mine} testID={`replies-${m.messageId}`} onOpen={() => actions.openThread(m.messageId)} />;
}

function Mine({ item, actions, sending, mark, replies }: MessageViewProps & { item: Extract<Item, { kind: "me" }> }): ReactElement {
  const m = item.message;
  const [sheet, setSheet] = useState(false);
  const h = useHover(() => setSheet(true));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body);
  const startEdit = (): void => { setDraft(m.body); setEditing(true); };
  const save = (): void => {
    const body = draft.trim();
    setEditing(false);
    if (body !== "" && body !== m.body) actions.edit(m.messageId, body);
  };
  return (
    <View testID={`msg-${m.messageId}`} accessibilityLabel={`You, ${item.time}`} {...h.props} {...menuTrigger((x, y) => actions.showMenu(menuFor(m, true, actions, startEdit, { x, y }), x, y, "Message"))} style={[st.me, item.newgroup && st.gapTop, mark === "match" && st.found, mark === "active" && st.foundActive, mark === "selected" && st.selected]}>
      {h.phone ? <ActionSheet open={sheet} entries={menuFor(m, true, actions, startEdit)} onClose={() => setSheet(false)} /> : <HoverBar m={m} mine a={actions} onEdit={startEdit} visible={h.over || h.focus} />}
      <TimeTip item={item}><Text style={st.when}>{item.time}</Text></TimeTip>
      {editing ? (
        <View testID={`edit-${m.messageId}`} style={st.editBox}>
          <TextInput
            testID={`edit-field-${m.messageId}`} accessibilityLabel="Edit message" multiline autoFocus value={draft} onChangeText={setDraft}
            onKeyPress={(e) => {
              const k = (e as unknown as { nativeEvent: { key: string; shiftKey?: boolean } }).nativeEvent;
              if (k.key === "Escape") setEditing(false);
              else if (k.key === "Enter" && !k.shiftKey) { (e as unknown as { preventDefault?: () => void }).preventDefault?.(); save(); }
            }}
            style={st.editField}
          />
          <View style={st.editRow}><TextButton label="Cancel" onPress={() => setEditing(false)} testID={`edit-cancel-${m.messageId}`} /><TextButton label="Save" primary onPress={save} testID={`edit-save-${m.messageId}`} /></View>
        </View>
      ) : m.body.trim() === "" && m.attachments.length > 0 ? null : (
        <View style={[st.bubble, sending === "sending" && { opacity: 0.7 }]}>
      {actions.files && refsOf(m).length > 0 ? <LinkedText body={m.body} refs={refsOf(m)} data={actions.files} textStyle={st.bubbleText} /> : <SubjectText text={m.body} style={st.bubbleText} />}
        </View>
      )}
      {!editing && m.blocks.some((b) => isWebPage(b.type) || isQuote(b.type)) ? (
        <View style={st.mineFiles}>{m.blocks.map((b) => (isWebPage(b.type) ? <WebPageCard key={b.id} id={b.id} data={b.data} /> : isQuote(b.type) ? <QuoteCard key={b.id} id={b.id} data={b.data} /> : null))}</View>
      ) : null}
      {!editing && actions.files && refsOf(m).length > 0 ? <View style={st.mineFiles}><MountRefs refs={refsOf(m)} data={actions.files} /></View> : null}
      {!editing && actions.files && m.attachments.length > 0 ? (
        <View style={st.mineFiles}><AttachmentChips ids={m.attachments} data={actions.files} menu={(items, x, y, label) => actions.showMenu(items, x, y, label)} /></View>
      ) : null}
      {m.editedAt !== undefined ? <Text style={st.edited}>edited</Text> : null}
      {m.pinned ? <Text testID={`pinned-${m.messageId}`} style={st.edited}>pinned</Text> : null}
      {sending === "sending" ? <Text testID={`sending-${m.messageId}`} style={st.edited}>Sending</Text> : null}
      {sending === "failed" ? (
        <View testID={`failed-${m.messageId}`} accessibilityRole="alert" style={st.failed}>
          <Text style={st.failedText}>Not sent.</Text>
          <TextButton label="Retry" onPress={() => actions.retrySend(m.messageId)} testID={`retry-send-${m.messageId}`} />
          <TextButton label="Discard" onPress={() => actions.discardSend(m.messageId)} testID={`discard-send-${m.messageId}`} />
        </View>
      ) : null}
      {/* ui-rows-lint: not a list (at most one line saying which thread a copy came from) */}
      {m.blocks.filter((b) => b.type === "from_thread").map((b) => {
        const tid = String((b.data as { threadId?: unknown } | null)?.threadId ?? "");
        return <Pressable key={b.id} accessibilityRole="link" testID={`from-thread-${m.messageId}`} onPress={() => (tid !== "" ? actions.openMessage?.(tid, "") : undefined)} style={st.fromThreadMine}><Text style={st.fromThread}>{FROM_THREAD_LINE}</Text></Pressable>;
      })}
      <Reactions m={m} a={actions} mine />
      {actions.alsoSent?.has(m.messageId) ? <AlsoSentMark messageId={m.messageId} mine /> : null}
      <Replies m={m} replies={replies} actions={actions} mine />
      <LearnedLines messageId={m.messageId} />
    </View>
  );
}

/* ---------- anyone else's ---------- */

/** An approval asked in a thread rises to the chat as one quiet line: the whole line is a button that opens the thread, where the held card is the newest thing. */
/** Keyboard focus only: a ring after a click or a tap is noise, so the ring shows when the last thing the person did was press a key. */
let byKeyboard = false;
{
  const doc = (globalThis as { document?: { addEventListener(t: string, f: () => void, c?: boolean): void } }).document;
  doc?.addEventListener("keydown", () => { byKeyboard = true; }, true);
  doc?.addEventListener("pointerdown", () => { byKeyboard = false; }, true);
  doc?.addEventListener("mousedown", () => { byKeyboard = false; }, true);
}
const isApprovalUp = (b: { type: string; data?: unknown }): boolean => b.type === "from_thread" && (b.data as { messageId?: unknown } | null)?.messageId === "";
function ApprovalLine({ id, who, threadId, open }: { id: string; who: string; threadId: string; open(threadId: string): void }): ReactElement {
  return (
    <Pressable testID={`approval-line-${id}`} accessibilityRole="button" accessibilityLabel={`${who} needs your OK. Open the thread`} onPress={() => open(threadId)}
      style={({ hovered, focused }: { hovered?: boolean; focused?: boolean }) => [st.approvalLine, hovered === true && st.approvalOver, focused === true && byKeyboard && st.approvalFocus]}>
      <Text style={st.approvalText}>{`${who} needs your OK in a thread. `}<Text style={st.approvalOpen}>Open the thread</Text></Text>
    </Pressable>
  );
}

function Theirs({ item, actions, stream, openWork, mark, meId, replies }: MessageViewProps & { item: Extract<Item, { kind: "other" }> }): ReactElement {
  const m = item.message;
  const [sheet, setSheet] = useState(false);
  const h = useHover(() => setSheet(true));
  const work = workOf(m);
  const [workOpen, setWorkOpen] = useState(openWork === true);
  const crewStart = m.blocks.find(isCrewStart);
  const cards = m.blocks.filter((b) => isCard(b) && !isCrewStart(b));
  const statuses = m.blocks.filter(isTurnStatus).map(statusView);
  // a held call has one card, however many ways the turn named it: the approval card
  const parked = new Set(statuses.flatMap((x) => (x.kind === "approval" ? [x.taskId] : [])));
  const errors = [...m.blocks.filter(isErrorBlock), ...statuses.flatMap((x) => (x.kind === "error" ? [x.block] : []))];
  const person = item.who.kind === "person";
  // a crew result card says it all (who, what changed, the teammate's words): the message's own text is for the lead agent that wakes on it, so the card stands alone
  const crewCard = m.blocks.some(isCrewResult) || crewStart !== undefined;
  // a person's id that slips into an agent's words reads as their name
  // the answer that brings helpers together marks each claim with the number of the helper it came from: [1], [2]. Those marks are chips that open that helper.
  const crewRows = actions.crew?.status ? citable(actions.crew.status.members) : [];
  const words = !person && !stream ? citeBody(namedIds(m.body, actions.nameOf), crewRows.length) : namedIds(m.body, actions.nameOf);
  const citeLink = useMemo(() => (actions.crew ? citeRender(crewRows, (x) => actions.crew!.peek(x.id)) : undefined), [actions.crew, crewRows.length]);  // eslint-disable-line react-hooks/exhaustive-deps
  const chips = useRefChips(words, actions.files);
  const blocks = stream || crewCard ? null : bodyBlocks(chips.body === words ? m.messageId : `${m.messageId}#${chips.body.length}:${chips.body.slice(-24)}`, chips.body);
  const runCfg = actions.runCode;
  const renderCode = useMemo(() => (runCfg ? (b: { lang: string; text: string; closed: boolean }) => { const c = commandOf(b.lang, b.text, b.closed); return c ? <RunCode command={c} cfg={runCfg} /> : null; } : undefined), [runCfg]);
  const subjects = useSubjectBlocks(blocks);
  // an agent's reply: hovering its face or name shows how it was made (model, account, asker, where, cost, tokens, time)
  const withCard = (kids: ReactElement): ReactElement => (!person && actions.details && !stream && !h.phone && !isSystemLine(m) ? <ReplyHover messageId={m.messageId} details={actions.details}>{kids}</ReplyHover> : kids);
  return (
    <View testID={`msg-${m.messageId}`} accessibilityLabel={`${item.who.name}, ${item.time}`} {...h.props} {...menuTrigger((x, y) => actions.showMenu(menuFor(m, false, actions, () => undefined, { x, y }), x, y, "Message"))} style={[st.msg, item.newgroup && st.gapTop, mark === "match" && st.found, mark === "active" && st.foundActive, mark === "selected" && st.selected]}>
      {h.phone ? <ActionSheet open={sheet} entries={menuFor(m, false, actions, () => undefined)} onClose={() => setSheet(false)} /> : <HoverBar byAgent={!person} m={m} mine={false} a={actions} onEdit={() => undefined} visible={h.over || h.focus} />}
      {item.newgroup ? (
        <View style={st.by}>
          {withCard(
            <>
              <Face name={item.who.name} seedId={item.who.face ?? item.who.id} kind={person || item.who.face !== undefined ? "person" : "agent"} size={20} />
              <Pressable accessibilityRole="link" accessibilityLabel={`Open ${item.who.name}`} testID={`who-${m.messageId}`} onPress={() => actions.openAgent(item.who.id)}>
                <Text style={st.who}>{item.who.name}</Text>
              </Pressable>
            </>,
          )}
          <TimeTip item={item}><Text style={st.time}>{item.time}</Text></TimeTip>
          {work?.short ? <Pressable accessibilityRole="button" accessibilityLabel={work.summary} testID={`work-short-${m.messageId}`} onPress={() => setWorkOpen((o) => !o)} style={{ opacity: h.over || workOpen ? 1 : 0 }}><Text style={st.time}>{work.summary}</Text></Pressable> : null}
        </View>
      ) : <Text style={st.whenLeft}>{item.time}</Text>}
      {pokedBy(m, actions.nameOf ?? unnamed) ? <Text testID={`poked-${m.messageId}`} style={st.via}>{pokedBy(m, actions.nameOf ?? unnamed)}</Text> : null}
      {item.paidLine ? <Text testID={`paid-${m.messageId}`} style={st.via}>{item.paidLine}</Text> : null}
      {m.via ? <Text testID={`via-${m.messageId}`} style={st.via}>{`Sent by ${item.who.name} on a routine ${m.via.routineOwner === meId ? "you" : actions.nameOf ? actions.nameOf(m.via.routineOwner) : unnamed(m.via.routineOwner)} set`}</Text> : null}
      {work && (!work.short || !item.newgroup || workOpen) ? (
        <Fold testID={`work-${m.messageId}`} label={work.live ? `Working${work.now ? ` · ${work.now}` : ""}` : work.summary} open={work.live || workOpen} live={work.live} onToggle={() => setWorkOpen((o) => !o)}>
      {person || stream || m.body === "" ? null : <ReplyMemory messageId={m.messageId} threadId={m.threadId} reply={m.body} part="line" />}
          {collect(work.steps, (l) => (
            <View key={l.id} testID={`step-${l.id}`} style={st.step}>
              <View style={[st.stepDot, l.state === "live" && st.stepLive, l.state === "error" && st.stepError]} />
              <Text style={st.stepTitle}>{l.title}</Text>
              {l.sub ? <Text numberOfLines={1} style={st.stepSub}>{l.sub}</Text> : null}
            </View>
          ))}
        </Fold>
      ) : null}
      {stream ? <LiveBody store={stream} hideEmpty={actions.activityOf?.(m.messageId) !== undefined} testID={`body-${m.messageId}`} style={st.body} /> : m.body && !crewCard ? <View testID={`body-${m.messageId}`} style={st.body}><MarkdownBlocks blocks={subjects.blocks} {...(subjects.renderLink || chips.renderLink || citeLink ? { renderLink: ((href, kids, key) => citeLink?.(href, kids, key) ?? chips.renderLink?.(href, kids, key) ?? subjects.renderLink?.(href, kids, key) ?? null) as NonNullable<typeof chips.renderLink> } : {})} {...(renderCode ? { renderCode } : {})} /></View> : null}
      {stream && actions.activityOf?.(m.messageId) ? <ActivityLine store={actions.activityOf(m.messageId)!} stream={stream} {...(actions.faceInThread ? { face: <Face name={item.who.name} seedId={item.who.id} kind="agent" size={20} /> } : {})} /> : null}
          {item.hookSteps && actions.files ? <HookSteps id={m.messageId} steps={item.hookSteps.next} agentId={item.hookSteps.agentId} threadId={actions.files.threadId} call={actions.files.call} /> : null}
      {person || stream || m.body === "" ? null : <ReplyMemory messageId={m.messageId} threadId={m.threadId} reply={m.body} part={work ? "cards" : "all"} />}
          {crewStart && actions.openMessage && !(actions.crew?.status?.members.some((x) => x.kind === "teammate" && x.id === String((crewStart.data as { helperThreadId?: unknown } | null)?.helperThreadId)) ?? false) ? <CrewStartLine block={crewStart} name={actions.nameOf ? actions.nameOf(String((crewStart.data as { agentId?: unknown } | null)?.agentId ?? "")) : item.who.name} onOpen={(id) => actions.openMessage?.(id, "")} /> : null}
      {actions.files && refsOf(m).length > 0 ? <MountRefs refs={refsOf(m)} data={actions.files} /> : null}
      {actions.files && m.attachments.length > 0 ? <AttachmentChips ids={m.attachments} data={actions.files} menu={(items, x, y, label) => actions.showMenu(items, x, y, label)} /> : null}
      {collect(cards, (b) => {
        const goal = goalBlockOf(b);
        if (goal && actions.files) return <GoalCard key={b.id} block={goal} call={actions.files.call} changes={actions.files.changes} {...(actions.openGoal ? { openGoal: actions.openGoal } : {})} me={meId} />;
        if (isInstallPlan(b.type) && actions.files) return <InstallCard key={b.id} id={b.id} data={b.data} chat={{ call: actions.files.call, ...(actions.files.nav.openSkills ? { openSkills: actions.files.nav.openSkills } : {}) }} />;
        if (isCrewResult(b) && actions.files) return <CrewResultCard key={b.id} block={b} leadThreadId={m.threadId} data={actions.files} />;
        if (isProposal(b)) return <AgentFileProposal key={b.id} block={b} host={actions.host} changes={actions.files?.changes} />;
        if (isPlanFile(b)) return <PlanFileCard key={b.id} block={b} onOpen={(id) => actions.openBeside("file", id)} />;
        const lc = linkCardOf(b);
        const held = lc && actions.files ? heldTaskOf(lc) : null;
        if (held !== null) return parked.has(held) ? null : <ApprovalCard key={b.id} taskId={held} agent={item.who.name} agentId={item.who.id} {...(item.who.face ? { face: item.who.face } : {})} data={actions.files!} />;
        const draft = lc && actions.files ? draftOf(lc) : null;
        if (lc && actions.files && providerDraftOf(lc)) return <ProviderDraftCard key={b.id} card={lc} agent={item.who.name} agentId={item.who.id} data={actions.files} />;
        if (draft !== null) return <DraftCard key={b.id} draftId={draft} agent={item.who.name} agentId={item.who.id} data={actions.files!} />;
        if (lc) return <LinkCardView key={b.id} id={b.id} data={lc} actions={actions} size={14} trusted={m.kind === "system"} />;
        if (isAccessRequest(b.type) && actions.files) return <AccessRequestCard key={b.id} block={b.data as never} data={actions.files} />;
        if (isRedactRequest(b.type) && actions.files) return <RedactRequestCard key={b.id} block={b.data as never} agent={item.who.name} data={{ ...actions.files, nameOf: actions.nameOf ?? ((x: string) => x) }} />;
        if (isKeyRequest(b.type) && actions.files) return <KeyRequestCard key={b.id} requestId={String((b.data as { requestId?: unknown }).requestId ?? "")} agent={item.who.name} agentId={item.who.id} data={actions.files} />;
        if (isChecklist(b.type)) return <ChecklistCard key={b.id} id={b.id} data={b.data} />;
        if (isNoteOffer(b.type) && actions.files) return <NoteOfferCard key={b.id} id={b.id} data={b.data} mine={(b.data as { person?: unknown }).person === meId} chat={actions.files} />;
        if (isWebPage(b.type)) return <WebPageCard key={b.id} id={b.id} data={b.data} />;
        if (isQuote(b.type)) return <QuoteCard key={b.id} id={b.id} data={b.data} />;
        if (isChromeHeld(b.type)) return <HeldSendCard key={b.id} id={b.id} data={b.data} agentId={item.who.id} agentName={item.who.name} actions={actions.chrome} />;
        if (isChromeStep(b.type)) return <ChromeStepCard key={b.id} id={b.id} data={b.data} agentId={item.who.id} agentName={item.who.name} actions={actions.chrome} />;
        if (isApprovalUp(b)) return <ApprovalLine key={b.id} id={m.messageId} who={item.who.name} threadId={String((b.data as { threadId?: unknown } | null)?.threadId ?? "")} open={(t) => actions.openMessage?.(t, "")} />;
        if (b.type === "from_thread") {
          const tid = String((b.data as { threadId?: unknown } | null)?.threadId ?? "");
          return <Pressable key={b.id} accessibilityRole="link" testID={`from-thread-${m.messageId}`} onPress={() => (tid !== "" ? actions.openMessage?.(tid, "") : undefined)}><Text style={st.fromThread}>{typeof (b.data as { messageId?: unknown } | null)?.messageId === "string" && (b.data as { messageId: string }).messageId !== "" ? FROM_THREAD_LINE : "Open the thread"}</Text></Pressable>;
        }
        if (b.type === "crew_strip") {
          const blocks = ((b.data as { blocks?: Array<{ data?: unknown; state?: string }> } | null)?.blocks ?? []);
          const live = actions.crew?.status ?? null;
          const members = withTeammates(blocks.map((x) => { const own = memberFromBlock(x, m.threadId); return memberOf(live, own.id) ?? own; }), live);
          const rows = members.length;
          const totals = live && members.every((x) => memberOf(live, x.id) !== undefined) && live.members.filter((x) => x.kind === "helper").length === rows ? live.totals
            : { members: rows, working: members.filter((x) => x.state === "working").length, done: members.filter((x) => x.state === "done").length, needsYou: members.filter((x) => x.state === "needs_you").length, failed: members.filter((x) => x.state === "failed").length, stopped: members.filter((x) => x.state === "stopped").length, tokensIn: 0, tokensOut: 0, costMicros: 0, filesChanged: 0, added: 0, deleted: 0, elapsedMs: Math.max(0, ...members.map((x) => x.elapsedMs)) };
          const c = actions.crew;
          // a helper that waits for a person's yes shows its held request here, in the chat the person reads: the same approval card as anywhere (Allow, Always allow, Deny)
          // the coders on this strip: Review all and Merge sit in its header, and nothing is posted per coder
          const coders = members.filter((x) => (x as { kind?: string }).kind === "teammate") as Array<CrewMember & { jobId?: string }>;
          const coderMerge = coders.length > 0 && c?.merge ? { state: coders.every((x) => x.merged === true) ? "merged" as const : coders.every((x) => x.state === "done") ? "ready" as const : "working" as const, onReview: () => c.openPane(), onMerge: () => c.merge(coders.flatMap((x) => (x.jobId ? [x.jobId] : []))) } : null;
          const holds = holdsOf(members);
          return (
            <View key={b.id}>
              <CrewStrip members={members} totals={totals} parentName={item.who.name} {...(coderMerge ? { merge: coderMerge } : {})} selectedId={c?.selected ?? null} onPeek={(x) => (c ? c.peek(x.id) : actions.openMessage?.(x.id, ""))} {...(c ? { onStopAll: c.stopAll, onOpenPane: c.openPane, onRetry: (x: { id: string }) => c.retry(x.id) } : {})} />
              {typeof (b.data as { after?: unknown } | null)?.after === "string" ? (
                <View testID={`crew-answer-${m.messageId}`} style={[st.body, { marginTop: 10 }]}>
                  <MarkdownBlocks blocks={bodyBlocks(`${m.messageId}#answer`, citeBody(namedIds((b.data as { after: string }).after, actions.nameOf), crewRows.length))} {...(citeLink ? { renderLink: ((href: string, kids: ReactNode, key: number) => citeLink(href, kids, key) ?? null) as never } : {})} />
                </View>
              ) : null}
              {/* ui-rows-lint: not a list (the approval cards of helpers that wait for a yes, each the same card as anywhere else in the chat) */}
              {actions.files ? holds.map((x) => <ApprovalCard key={`hold-${x.id}`} taskId={x.holdTaskId} agent={x.name ?? x.title} agentId={x.agentId} faceSeed={x.id} data={actions.files!} />) : null}
            </View>
          );
        }
        if (b.type === "helper" && !isCrewStart(b)) return <HelperRow key={b.id} block={b} onOpen={(id) => actions.openMessage?.(id, "")} />;
        if (isPartOneType(b.type)) return <BlockViewA key={b.id} block={b} host={actions.host} />;
        return <Card key={b.id} line={cardLine(b)} actions={actions} />;
      })}
      {collect(errors, (b) => <ErrorRowView key={b.id} block={b} actions={actions} />)}
      {collect(m.blocks.some(isApprovalUp) ? statuses.filter((x) => x.kind !== "note") : statuses, (x) => (x.kind === "note" ? <Text key={x.id} testID={`status-${x.id}`} style={st.edited}>{x.text}</Text>
        : x.kind === "wait" ? <View key={x.id} testID={`status-${x.id}`} style={st.waitRow}><Text style={st.edited}>{x.text}</Text><TextButton link label={x.action.label} testID={`status-${x.action.key}`} onPress={() => actions.errorNext(x.action.key)} /></View>
        : x.kind === "approval" && actions.files ? <ApprovalCard key={x.id} taskId={x.taskId} agent={item.who.name} agentId={item.who.id} {...(item.who.face ? { face: item.who.face } : {})} data={actions.files} /> : null))}
      {item.who.forPerson && actions.agentMute && actions.agentMute.offerFor === m.messageId && onBehalfOf(m)?.teammate === actions.agentMute.me ? (
        <Pressable accessibilityRole="button" testID={`agent-mute-${m.messageId}`} onPress={() => actions.agentMute!.mute(item.who.forPerson!)}>
          <Text style={[st.via, st.muteLine]}>{`Mute agent messages from ${firstName(item.who.name.replace(/ \(Agent\)$/, ""))} for today`}</Text>
        </Pressable>
      ) : null}
      <Reactions m={m} a={actions} mine={false} />
      {actions.alsoSent?.has(m.messageId) ? <AlsoSentMark messageId={m.messageId} /> : null}
      <Replies m={m} replies={replies} actions={actions} mine={false} />
      <LearnedLines messageId={m.messageId} />
      {m.pinned ? <Text testID={`pinned-${m.messageId}`} style={st.edited}>pinned</Text> : null}
    </View>
  );
}

function Reactions({ m, a, mine }: { m: Message; a: MessageActions; mine: boolean }): ReactElement | null {
  if (m.reactions.length === 0) return null;
  return (
    <View testID={`reactions-${m.messageId}`} style={[st.reactions, mine && { alignSelf: "flex-end" }]}>
      {collect(m.reactions, (r) => (
        <Pressable key={r.emoji} accessibilityRole="button" accessibilityLabel={`${r.emoji} ${r.by.length}`} onPress={() => a.react(m.messageId, r.emoji, true)} style={st.react}>
          <Text style={st.reactText}>{`${r.emoji} ${r.by.length}`}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/* ---------- native cards ---------- */

/** A link card in the conversation: names by the chat's own lookup, a fact opens the Knows tab of the pane (where the chat has memory), anything else opens beside the chat. */
function LinkCardView({ id, data, actions, size, trusted, time }: { id: string; data: LinkCardData; actions: MessageActions; size: number; trusted: boolean; time?: string }): ReactElement {
  const memory = useThreadMemory();
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  // a button with a capability calls it as the person and reads as done; one that fails says nothing is done (the button stays)
  const act = (key: string): void => {
    const a = data.actions?.find((x) => x.key === key);
    // only a card the app itself wrote (a system line) may name a call; the same card from a model or a tool is words and inert buttons, whatever it carries
    if (!trusted || !a?.cap) return;
    void Promise.resolve(actions.host.invoke(a.cap, a.input ?? {})).then(() => setDone((d) => new Set(d).add(key)), () => undefined);
  };
  const seen = useCardState(data, actions);
  // the Space's link policy (ui/reach): a card for a thing this person cannot open draws as plain words before anyone presses it
  const link = useLinkState(data.reach === undefined && data.target ? { type: data.target.type, id: data.target.id } : undefined);
  // the level the Space attached when it served the message decides the first draw; the probe and the policy are only the fallback for a card that came without one
  const hidden = data.reach !== undefined ? data.reach === "none" : seen.hidden || link.state === "plain";
  const [asked, setAsked] = useState(false);
  const askAccess = (): void => {
    const t = data.target;
    if (!t) return;
    void Promise.resolve(actions.host.invoke("access.request", { resource: { type: t.type === "chat" ? "thread" : t.type, id: t.id }, level: "view", idempotencyKey: `ask:${t.type}:${t.id}` })).then(() => setAsked(true), () => undefined);
  };
  const open = (t: NonNullable<LinkCardData["target"]>): void => { if (t.type === "thread" && actions.openMessage) actions.openMessage(t.id, ""); else if (t.type === "fact" && memory?.memory.showKnows) memory.memory.showKnows(); else actions.openBeside(t.type, t.id); };
  return <LinkCard id={id} data={data} nameOf={actions.nameOf ?? ((x) => x)} icon={<Glyph name={linkGlyph(data.icon)} size={size} color="var(--ink-3)" />} onOpen={open} onAction={act} done={new Set([...done, ...doneByState(data, seen.state)])} state={seen.state} hidden={hidden} {...(time ? { time } : {})} {...(hidden && data.target ? { onAskAccess: askAccess, asked } : {})} />;
}

/** What a work card says now, read as this reader: its state while it is live (read again on every change in the Space), and whether they may open it at all. */
function useCardState(data: LinkCardData, actions: MessageActions): { state: CardState | null; hidden: boolean } {
  const [seen, setSeen] = useState<{ state: CardState | null; hidden: boolean }>({ state: null, hidden: false });
  const probe = probeOf(data);
  const key = probe ? `${probe.cap}:${JSON.stringify(probe.input)}` : "";
  const read = useCallback(async (): Promise<void> => {
    if (!probe) return;
    try { setSeen({ state: stateOf(data, await actions.host.invoke(probe.cap, probe.input)), hidden: false }); }
    catch { setSeen({ state: null, hidden: true }); }
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps -- one read per card and target
  useEffect(() => { void read(); }, [read]);
  useFollow(actions.files?.changes, read, probe !== null && (seen.state === null ? !seen.hidden : seen.state.live));
  return seen;
}

/** The glyph a link card's icon word asks for. */
const LINK_GLYPH: Record<string, GlyphName> = { task: "task", file: "file", fact: "spark", record: "people", run: "term", routine: "spark", computer: "monitor", approval: "alert", thread: "reply" };
export const linkGlyph = (icon: string): GlyphName => LINK_GLYPH[icon] ?? "reply";

const CARD_ICON: Record<string, GlyphName> = { terminal: "term", plan: "plan", file: "file", changeset: "file", diff: "file", screenshot: "file", record_card: "file", question: "spark" };
const OPENS = new Set(["terminal", "changeset", "diff", "file", "record_card", "tab_opened", "screenshot", "deploy", "mount"]);

function Card({ line, actions }: { line: CardLine; actions: MessageActions }): ReactElement {
  const icon: GlyphName = CARD_ICON[line.type] ?? "spark";
  const waiting = line.state === "waiting";
  const opens = OPENS.has(line.type);
  const openId = typeof line.data.id === "string" ? line.data.id : line.id;
  const options = line.type === "question" ? questionOptions(line.data) : [];
  const offers = line.type === "question" ? mountOffers(options) : null;
  const terminalAsk = line.type === "question" ? terminalAskOf(line.data) : null;
  const answered = line.type === "question" && line.data.answer !== undefined ? String(line.data.answer) : "";
  const steps = line.type === "plan" ? planSteps(line.data) : [];
  if (line.type === "screenshot" && line.data.live === true && typeof line.data.computerId === "string" && typeof line.data.fileId === "string" && actions.liveCard) {
    return <LiveCard id={line.id} computerId={line.data.computerId} fileId={line.data.fileId} caption={line.title} cfg={actions.liveCard} />;
  }
  const head = (
    <>
      <Glyph name={icon} size={15} color={waiting ? "var(--accent)" : "var(--ink-3)"} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={st.cardTitle}>{line.title}</Text>
        {line.sub ? <Text numberOfLines={1} style={st.cardSub}>{line.sub}</Text> : null}
      </View>
      {opens ? <Glyph name="chev" size={13} color="var(--ink-4)" /> : null}
    </>
  );
  return (
    <View testID={`card-${line.id}`} accessibilityLabel={line.title} style={[st.card, waiting && st.cardWaiting]}>
      {opens ? <Pressable accessibilityRole="button" accessibilityLabel={`Open ${line.title}`} testID={`card-open-${line.id}`} onPress={() => actions.openBeside(line.type, openId)} style={st.cardHead}>{head}</Pressable> : <View style={st.cardHead}>{head}</View>}
      {steps.length > 0 ? (
        <View testID={`plan-steps-${line.id}`} style={st.planSteps}>
          {collect(steps, (p) => (
            <View key={p.id} style={st.planStep}><Glyph name={p.done ? "check" : "chev"} size={12} color={p.done ? "var(--ok)" : "var(--ink-4)"} /><Text style={[st.stepTitle, p.done && { color: "var(--ink-4)" as string }]}>{p.text}</Text></View>
          ))}
        </View>
      ) : null}
      {line.type === "plan" && waiting ? <View style={st.cardRow}><TextButton label="Allow" primary testID={`plan-approve-${line.id}`} onPress={() => actions.approvePlan(typeof line.data.planId === "string" ? line.data.planId : line.id)} /></View> : null}
      {line.type === "question" && waiting && terminalAsk && actions.terminalCard ? <TerminalCard id={line.id} why={typeof line.data.prompt === "string" ? line.data.prompt : line.title} command={terminalAsk.command} risk={terminalAsk.risk} {...(terminalAsk.host ? { host: terminalAsk.host } : {})} {...(actions.terminalCard.agentId ? { agentId: actions.terminalCard.agentId } : {})} deps={actions.terminalCard.deps} copy={actions.terminalCard.copy} openTerminal={actions.terminalCard.openTerminal} answer={actions.answer} /> : null}
      {line.type === "question" && waiting && offers && actions.mountCard ? <MountCard id={line.id} prompt={typeof line.data.prompt === "string" ? line.data.prompt : line.title} offers={offers} agents={actions.mountCard.agents} data={actions.mountCard.data} answer={actions.answer} /> : null}
      {line.type === "question" && waiting && options.length > 0 && !(offers && actions.mountCard) && !(terminalAsk && actions.terminalCard) ? (
        <View testID={`options-${line.id}`} accessibilityRole="radiogroup" style={st.cardRow}>
          {collect(options, (o) => <TextButton key={o.id} label={o.label} testID={`option-${line.id}-${o.id}`} onPress={() => actions.answer(line.id, o.id)} />)}
        </View>
      ) : null}
      {answered !== "" ? <Text testID={`answered-${line.id}`} style={st.cardSub}>{`Answered: ${answered}`}</Text> : null}
    </View>
  );
}

/* ---------- errors: what, why, next ---------- */

function ErrorRowView({ block, actions }: { block: Message["blocks"][number]; actions: MessageActions }): ReactElement {
  const e = errorRow(block);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<[string, string][] | null>(null);
  const [retried, setRetried] = useState(false);
  useEffect(() => {
    if (!open || detail !== null || e.turnId === "" || !actions.turnDetail) return undefined;
    let live = true;
    void actions.turnDetail(e.turnId).then((rows) => { if (live) setDetail(rows); }, () => undefined);
    return () => { live = false; };
  }, [open, detail, e.turnId, actions]);
  // A reply that could not start for lack of an AI account: once the person has used "Connect your AI" and an account works, a quiet line offers to send it again (one retry of that turn, the message is not posted twice).
  const noAccount = e.code === "no_account" && e.turnId !== "" && actions.accountReady !== undefined;
  const [asked, setAsked] = useState(false);
  const [ready, setReady] = useState(false);
  const [resent, setResent] = useState(false);
  useEffect(() => {
    if (!noAccount || !asked || ready || resent) return;
    let live = true;
    const check = (): void => { void actions.accountReady!().then((ok) => { if (live && ok) setReady(true); }, () => undefined); };
    check();
    const timer = setInterval(check, 2500);
    return () => { live = false; clearInterval(timer); };
  }, [noAccount, asked, ready, resent, actions]);
  return (
    <View testID={`error-${block.id}`} accessibilityRole="alert" {...menuTrigger((x, y) => actions.showMenu([{ label: "Copy error details", onSelect: () => actions.copy(e.traceId) }, { label: "What Happened?", onSelect: () => setOpen((o) => !o) }], x, y, "Error"))} style={st.err}>
      <View style={st.errTop}><Glyph name="alert" size={15} color="var(--warn)" /><Text style={st.errMsg}>{e.message}</Text></View>
      {e.cause ? <Text style={st.errCause}>{e.cause}</Text> : null}
      <View style={st.errActions}>
        {collect(e.next, (n) => <TextButton link key={n.key} label={n.label} testID={`err-next-${n.key}`} onPress={() => { if (n.key === "connect_ai") setAsked(true); actions.errorNext(n.key, e.turnId); }} />)}
        {e.retryable && e.turnId && !retried ? <TextButton link label="Retry" testID="err-retry" onPress={() => { setRetried(true); actions.retryTurn(e.turnId); }} /> : null}
        <TextButton link label="Details" testID="err-what" onPress={() => setOpen((o) => !o)} />
        <TextButton link label="Copy id" testID="err-trace" onPress={() => actions.copy(e.traceId || e.turnId)} />
        <TextButton link label="Report" testID="err-report" onPress={() => reportProblem({ label: reportLabel(e.message, e.traceId) })} />
      </View>
      {noAccount && ready && !resent ? (
        <View testID="err-connected" style={st.errActions}>
          <Text style={st.errCause}>Connected. Send it again?</Text>
          <TextButton link label="Retry" testID="err-connected-retry" onPress={() => { setResent(true); actions.retryTurn(e.turnId); }} />
        </View>
      ) : null}
      {open ? (
        <View testID="err-steps" style={st.errSteps}>
          {collect(detail ?? e.steps, ([k, v]) => <View key={k} style={st.kv}><Text style={st.kvK}>{k}</Text><Text style={st.kvV}>{v}</Text></View>)}
        </View>
      ) : null}
    </View>
  );
}

export const st = StyleSheet.create({
  approvalLine: { flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "flex-start", marginTop: 4, paddingVertical: 5, paddingHorizontal: 10, marginLeft: -10, borderRadius: 8 },
  approvalOver: { backgroundColor: "var(--hover)" as string },
  approvalFocus: { borderWidth: 2, borderColor: "var(--accent)" as string, paddingVertical: 3, paddingHorizontal: 8 },
  approvalText: { fontSize: 14, lineHeight: 20, color: "var(--ink-2)" as string },
  fromThread: { fontSize: 12, color: "var(--ink-3)" as string },
  approvalOpen: { color: "var(--accent)" as string, fontWeight: "500" },
  fromThreadMine: { alignSelf: "flex-end", marginTop: 4 },
  day: { alignSelf: "center", fontSize: 12, color: "var(--ink-3)" as string, marginTop: 18, marginBottom: 6 },
  eventCard: { flexShrink: 1, minWidth: 0 },
  eventCentre: { justifyContent: "center" },
  event: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, marginBottom: 2 },
  eventDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "var(--ink-4)" as string },
  eventText: { flexShrink: 1, fontSize: 12.5, color: "var(--ink-3)" as string },
  eventLink: { color: "var(--accent)" as string, textDecorationLine: "underline", cursor: "pointer" } as object,
  eventTime: { fontSize: 11.5, color: "var(--ink-4)" as string },
  hookText: { flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: 19, color: "var(--ink-2)" as string },
  hookLead: { color: "var(--ink)" as string, fontWeight: "500" },
  hookAct: { fontSize: 12.5, lineHeight: 19, color: "var(--ink-3)" as string, cursor: "pointer" } as object,
  gapTop: { marginTop: 18 },
  // the mark sits outside the message (marks.ts), so nothing touches its edge
  found: MARK.found as object,
  foundActive: MARK.foundActive as object,
  selected: MARK.selected as object,
  me: { alignItems: "flex-end", paddingVertical: 2, marginTop: 4, position: "relative" },
  when: { position: "absolute", left: 0, top: 10, fontSize: 11, color: "var(--ink-4)" as string, opacity: 0 },
  whenLeft: { position: "absolute", left: -44, top: 4, fontSize: 11, color: "var(--ink-4)" as string, opacity: 0 },
  bubble: { maxWidth: "85%", backgroundColor: "var(--me)" as string, borderRadius: 18, paddingHorizontal: 15, paddingVertical: 9 },
  mineFiles: { alignSelf: "flex-end", maxWidth: "85%" },
  bubbleText: { color: "var(--ink)" as string, fontSize: 15, lineHeight: 23 },
  edited: { marginTop: 2, fontSize: 11.5, color: "var(--ink-4)" as string },
  editBox: { width: "85%", gap: 6, borderWidth: 1, borderColor: "var(--line-2)" as string, borderRadius: 12, padding: 8, backgroundColor: "var(--win)" as string },
  editField: { minHeight: 44, fontSize: 15, lineHeight: 22, color: "var(--ink)" as string, outlineStyle: "none", outlineWidth: 0 } as object,
  editRow: { flexDirection: "row", justifyContent: "flex-end", gap: 6 },
  waitRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  failed: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  failedText: { fontSize: 12.5, color: "var(--danger)" as string },
  msg: { paddingVertical: 2, position: "relative", gap: 6 },
  by: { flexDirection: "row", alignItems: "center", gap: 8, height: 26 },
  who: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  time: { fontSize: 11.5, color: "var(--ink-3)" as string },
  via: { fontSize: 12, color: "var(--ink-3)" as string },
  /** under an agent's message for its person, read by the teammate it went to (lane l-agentdm) */
  muteLine: { marginTop: 4 },
  body: { paddingRight: 8 },
  step: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 },
  stepDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "var(--ink-4)" as string },
  stepLive: { backgroundColor: "var(--ok)" as string },
  stepError: { backgroundColor: "var(--danger)" as string },
  stepTitle: { flexShrink: 1, fontSize: 13, color: "var(--ink-2)" as string },
  stepSub: { flexShrink: 1, fontSize: 12, color: "var(--ink-4)" as string },
  hover: { position: "absolute", top: -10, flexDirection: "row", alignItems: "center", gap: 0, paddingHorizontal: 2, height: 26, borderRadius: 8, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--win)" as string, zIndex: 2 },
  hoverMine: { right: 0 },
  hoverTheirs: { right: 8 },
  reactions: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 },
  react: { height: 22, paddingHorizontal: 8, borderRadius: 11, justifyContent: "center", backgroundColor: "var(--sunk)" as string },
  reactText: { fontSize: 12, color: "var(--ink-2)" as string },
  card: { borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 10, backgroundColor: "var(--side)" as string, maxWidth: 520 },
  cardWaiting: { borderColor: "var(--accent)" as string },
  cardHead: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  cardTitle: { fontSize: 13.5, fontWeight: "500", color: "var(--ink)" as string },
  cardSub: { fontSize: 12, color: "var(--ink-3)" as string, paddingHorizontal: 0 },
  cardRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 10, paddingBottom: 10 },
  planSteps: { gap: 4, paddingHorizontal: 12, paddingBottom: 8 },
  planStep: { flexDirection: "row", alignItems: "center", gap: 8 },
  err: { borderRadius: 10, padding: 12, gap: 6, maxWidth: 560, backgroundColor: "var(--sunk)" as string },
  errTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  errMsg: { flexShrink: 1, fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  errCause: { fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string },
  errActions: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  errSteps: { gap: 4, paddingTop: 4 },
  kv: { flexDirection: "row", gap: 12 },
  kvK: { width: 72, fontSize: 12, color: "var(--ink-3)" as string },
  kvV: { flex: 1, fontSize: 12.5, color: "var(--ink-2)" as string },
});
