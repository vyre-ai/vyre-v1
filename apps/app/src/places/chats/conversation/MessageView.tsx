// One entry of the conversation. Yours is a bubble on the right; anyone else's has a header (face, name, time) when the author changes; an agent's work folds into one line; native
// cards (question, plan, terminal, changeset, file) sit under the text; an error is one inline row (what, why, next). Hover shows Copy and Edit and the rest; right-click opens the same
// list; the keyboard reaches both. Every row is memoised on its item, so a streaming message re-renders alone.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { menuTrigger, reportProblem } from "../../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Sheet } from "../../../mobile/sheets/Sheet.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { isItem } from "../../../../../../ui/src/Menu/props.ts";
import { ActivityLine } from "./ActivityLine.tsx";
import { MarkdownBlocks, StreamText } from "../../../../../../ui/src/stream/index.ts";
import type { StreamStore } from "../../../../../../ui/src/stream/index.ts";
import { LinkCard } from "../../../../../../ui/src/blocks/link-card/LinkCard.tsx";
import { linkCardOf } from "../../../../../../ui/src/blocks/link-card/model.ts";
import type { LinkCardData } from "../../../../../../ui/src/blocks/link-card/model.ts";
import { probeOf, stateOf } from "../../../../../../ui/src/blocks/link-card/state.ts";
import type { CardState } from "../../../../../../ui/src/blocks/link-card/state.ts";
import { useThreadMemory } from "../memory/thread.tsx";
import { rememberMessage } from "../memory/actions.ts";
import { BlockViewA, isPartOneType } from "../../../../../../ui/src/blocks/impl-a/index.tsx";
import type { BlockHost } from "../../../../../../ui/src/blocks/impl-a/index.tsx";
import { Face } from "../needsyou/parts.tsx";
import { LearnedLines } from "../memory/Learned.tsx";
import type { MenuMessage, ShowMenu } from "../memory/menu.tsx";
import { SubjectText, useSubjectBlocks } from "../memory/Subjects.tsx";
import { ReplyMemory } from "../memory/Used.tsx";
import { AgentFileProposal, PlanFileCard, isPlanFile, isProposal } from "./proposal.tsx";
import { Fold, Glyph, IconButton, TextButton } from "./parts.tsx";
import { ApprovalCard } from "./approval.tsx";
import { CrewResultCard, isCrewResult } from "./crew-card.tsx";
import { KeyRequestCard, isKeyRequest } from "./keyrequest.tsx";
import { AccessRequestCard, isAccessRequest } from "./accessrequest.tsx";
import { ChecklistCard, isChecklist } from "./checklist.tsx";
import { MountCard } from "./mountcard.tsx";
import { TerminalCard } from "./TerminalCard.tsx";
import { RunCode } from "./RunCode.tsx";
import { LiveCard } from "./LiveCard.tsx";
import type { LiveCardConfig } from "./LiveCard.tsx";
import type { RunCodeConfig } from "./RunCode.tsx";
import { commandOf } from "../terminal/runthis.ts";
import { mountOffers } from "./mountcard.ts";
import { AttachmentChips, LinkedText, MountRefs, refsOf } from "./attachments.tsx";
import { unnamed } from "../names.ts";
import type { ConversationData } from "./data.tsx";
import type { GlyphName } from "./parts.tsx";
import { reportLabel, bodyBlocks, cardLine, collect, errorRow, isCard, isErrorBlock, isTurnStatus, planSteps, questionOptions, statusView, terminalAskOf, workOf } from "./model.ts";
import type { CardLine, Item, Message } from "./model.ts";

export interface MessageActions {
  copy(text: string): void;
  edit(messageId: string, body: string): void;
  setPinned(messageId: string, pinned: boolean): void;
  react(messageId: string, emoji: string, remove: boolean): void;
  openThread(messageId: string): void;
  remove(messageId: string): void;
  openAgent(agentId: string): void;
  openBeside(kind: string, id: string): void;
  answer(blockId: string, answer: unknown): void;
  approvePlan(planId: string): void;
  retryTurn(turnId: string): void;
  errorNext(key: string, turnId?: string): void;
  /** True once the person has a working AI account (read after "Connect your AI"). Left out where the chat cannot tell. */
  accountReady?(): Promise<boolean>;
  retrySend(messageId: string): void;
  discardSend(messageId: string): void;
  showMenu(items: readonly MenuEntry[], x: number, y: number, label: string): void;
  /** The memory items of the message menu (Remember This, Add to a Page, Show What the Agent Knew Here, Forget This); absent where the chat has no memory. */
  memoryEntries?: (m: MenuMessage, x: number, y: number, show: ShowMenu) => MenuEntry[];
  /** Branch the chat into a new one at this message. */
  fork?(messageId: string): void;
  /** Make a task from this message, linked back to it. */
  makeTask?(messageId: string): void;
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
  /** What files and links in a message need: lookups, opening beside the chat, copying. Left out in a place that cannot open them. */
  files?: Pick<ConversationData, "call" | "nav" | "copy">;
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
  mark?: "match" | "active" | undefined;
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
    if (link) {
      const b = item.message.blocks.find((x) => x.type === "link_card")!;
      return (
        <View testID={`event-${item.key}`} style={st.event}>
          <View style={st.eventCard}><LinkCardView id={String(b.id)} data={link} actions={props.actions} size={13} trusted={item.message.kind === "system"} /></View>
          <Text style={st.eventTime}>{item.time}</Text>
        </View>
      );
    }
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
          <Text style={st.eventTime}>{item.time}</Text>
        </View>
      );
    }
    return (
      <View testID={`event-${item.key}`} accessibilityRole="text" style={st.event}>
        <View style={st.eventDot} />
        <Text style={st.eventText}>{item.text}</Text>
        <Text style={st.eventTime}>{item.time}</Text>
      </View>
    );
  }
  return item.kind === "me" ? <Mine {...props} item={item} /> : <Theirs {...props} item={item} />;
});

/* ---------- the hover bar and the menu: the same list in both ---------- */

export function menuFor(m: Message, mine: boolean, a: MessageActions, onEdit: () => void, at: { x: number; y: number } = { x: 0, y: 0 }): MenuEntry[] {
  const items: MenuEntry[] = [{ label: "Copy", onSelect: () => a.copy(m.body) }];
  if (mine && m.kind === "text") items.push({ label: "Edit", onSelect: onEdit });
  items.push({ label: "Reply in Thread", onSelect: () => a.openThread(m.messageId) });
  if (a.makeTask && m.kind !== "system" && m.kind !== "quiet") items.push({ label: "Make a Task", onSelect: () => a.makeTask!(m.messageId) });
  if (a.share && m.kind !== "system" && m.kind !== "quiet") items.push({ label: "Share to...", onSelect: () => a.share!(m.messageId, at.x, at.y) });
  if (a.fork && m.kind !== "system" && m.kind !== "quiet") items.push({ label: "Fork From Here", onSelect: () => a.fork!(m.messageId) });
  items.push({ label: m.pinned ? "Unpin Message" : "Pin Message", onSelect: () => a.setPinned(m.messageId, !m.pinned) });
  items.push({ label: "Add Reaction", onSelect: () => a.react(m.messageId, "👍", false) });
  if (m.kind !== "quiet" && a.memoryEntries) items.push(...a.memoryEntries({ messageId: m.messageId, body: m.body, createdAt: m.createdAt }, at.x, at.y, a.showMenu));
  if (mine) items.push({ separator: true }, { label: "Delete", danger: true, onSelect: () => a.remove(m.messageId) });
  return items;
}

/** The bar is drawn only while the row is hovered or has focus: fifty rows that each hold a hidden bar of buttons were most of what the first frame cost. The empty toolbar stays, so the row's size and test hook never change. */
export function HoverBar({ m, mine, a, onEdit, visible }: { m: Message; mine: boolean; a: MessageActions; onEdit: () => void; visible: boolean }): ReactElement {
  const bar: { icon: GlyphName; label: string; run: () => void }[] = [{ icon: "copy", label: "Copy", run: () => a.copy(m.body) }];
  if (mine && m.kind === "text") bar.push({ icon: "edit", label: "Edit", run: onEdit });
  bar.push({ icon: "reply", label: "Reply in thread", run: () => a.openThread(m.messageId) });
  if (a.makeTask && m.kind !== "system" && m.kind !== "quiet") bar.push({ icon: "task", label: "Make a task", run: () => a.makeTask!(m.messageId) });
  if (a.fork && m.kind !== "system" && m.kind !== "quiet") bar.push({ icon: "fork", label: "Fork from here", run: () => a.fork!(m.messageId) });
  return (
    <View testID={`hover-${m.messageId}`} accessibilityRole="toolbar" accessibilityLabel="Message actions" style={[st.hover, mine ? st.hoverMine : st.hoverTheirs, { opacity: visible ? 1 : 0 }, !visible && { width: 0, borderWidth: 0 }]}>
      {visible ? collect(bar, (b) => <IconButton key={b.label} icon={b.icon} label={b.label} size={24} testID={`act-${b.label.split(" ")[0]?.toLowerCase()}-${m.messageId}`} onPress={() => b.run()} />) : null}
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

function Mine({ item, actions, sending, mark }: MessageViewProps & { item: Extract<Item, { kind: "me" }> }): ReactElement {
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
    <View testID={`msg-${m.messageId}`} accessibilityLabel={`You, ${item.time}`} {...h.props} {...menuTrigger((x, y) => actions.showMenu(menuFor(m, true, actions, startEdit, { x, y }), x, y, "Message"))} style={[st.me, item.newgroup && st.gapTop, mark === "match" && st.found, mark === "active" && st.foundActive]}>
      {h.phone ? <ActionSheet open={sheet} entries={menuFor(m, true, actions, startEdit)} onClose={() => setSheet(false)} /> : <HoverBar m={m} mine a={actions} onEdit={startEdit} visible={h.over || h.focus} />}
      <Text style={st.when}>{item.time}</Text>
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
      <Reactions m={m} a={actions} mine />
      <LearnedLines messageId={m.messageId} />
    </View>
  );
}

/* ---------- anyone else's ---------- */

function Theirs({ item, actions, stream, openWork, mark, meId }: MessageViewProps & { item: Extract<Item, { kind: "other" }> }): ReactElement {
  const m = item.message;
  const [sheet, setSheet] = useState(false);
  const h = useHover(() => setSheet(true));
  const work = workOf(m);
  const [workOpen, setWorkOpen] = useState(openWork === true);
  const cards = m.blocks.filter(isCard);
  const statuses = m.blocks.filter(isTurnStatus).map(statusView);
  const errors = [...m.blocks.filter(isErrorBlock), ...statuses.flatMap((x) => (x.kind === "error" ? [x.block] : []))];
  const person = item.who.kind === "person";
  // a crew result card says it all (who, what changed, the teammate's words): the message's own text is for the lead agent that wakes on it, so the card stands alone
  const crewCard = m.blocks.some(isCrewResult);
  const blocks = stream || crewCard ? null : bodyBlocks(m.messageId, m.body);
  const runCfg = actions.runCode;
  const renderCode = useMemo(() => (runCfg ? (b: { lang: string; text: string; closed: boolean }) => { const c = commandOf(b.lang, b.text, b.closed); return c ? <RunCode command={c} cfg={runCfg} /> : null; } : undefined), [runCfg]);
  const subjects = useSubjectBlocks(blocks);
  return (
    <View testID={`msg-${m.messageId}`} accessibilityLabel={`${item.who.name}, ${item.time}`} {...h.props} {...menuTrigger((x, y) => actions.showMenu(menuFor(m, false, actions, () => undefined, { x, y }), x, y, "Message"))} style={[st.msg, item.newgroup && st.gapTop, mark === "match" && st.found, mark === "active" && st.foundActive]}>
      {h.phone ? <ActionSheet open={sheet} entries={menuFor(m, false, actions, () => undefined)} onClose={() => setSheet(false)} /> : <HoverBar m={m} mine={false} a={actions} onEdit={() => undefined} visible={h.over || h.focus} />}
      {item.newgroup ? (
        <View style={st.by}>
          <Face name={item.who.name} seedId={item.who.id} kind={person ? "person" : "agent"} size={20} />
          <Pressable accessibilityRole="link" accessibilityLabel={`Open ${item.who.name}`} testID={`who-${m.messageId}`} disabled={person} onPress={() => actions.openAgent(item.who.id)}>
            <Text style={st.who}>{item.who.name}</Text>
          </Pressable>
          <Text style={st.time}>{item.time}</Text>
        </View>
      ) : <Text style={st.whenLeft}>{item.time}</Text>}
      {m.via ? <Text testID={`via-${m.messageId}`} style={st.via}>{`Sent by ${item.who.name} on a routine ${m.via.routineOwner === meId ? "you" : actions.nameOf ? actions.nameOf(m.via.routineOwner) : unnamed(m.via.routineOwner)} set`}</Text> : null}
      {work ? (
        <Fold testID={`work-${m.messageId}`} label={work.live ? `Working${work.now ? ` · ${work.now}` : ""}` : work.summary} open={work.live || workOpen} live={work.live} onToggle={() => setWorkOpen((o) => !o)}>
          {collect(work.steps, (l) => (
            <View key={l.id} testID={`step-${l.id}`} style={st.step}>
              <View style={[st.stepDot, l.state === "live" && st.stepLive, l.state === "error" && st.stepError]} />
              <Text style={st.stepTitle}>{l.title}</Text>
              {l.sub ? <Text numberOfLines={1} style={st.stepSub}>{l.sub}</Text> : null}
            </View>
          ))}
        </Fold>
      ) : null}
      {stream ? <View testID={`body-${m.messageId}`} style={st.body}><StreamText store={stream} /></View> : m.body && !crewCard ? <View testID={`body-${m.messageId}`} style={st.body}><MarkdownBlocks blocks={subjects.blocks} {...(subjects.renderLink ? { renderLink: subjects.renderLink } : {})} {...(renderCode ? { renderCode } : {})} /></View> : null}
      {stream && !stream.getSnapshot().done && actions.activityOf?.(m.messageId) ? <ActivityLine store={actions.activityOf(m.messageId)!} /> : null}
      {person || stream || m.body === "" ? null : <ReplyMemory messageId={m.messageId} threadId={m.threadId} />}
      {actions.files && refsOf(m).length > 0 ? <MountRefs refs={refsOf(m)} data={actions.files} /> : null}
      {actions.files && m.attachments.length > 0 ? <AttachmentChips ids={m.attachments} data={actions.files} menu={(items, x, y, label) => actions.showMenu(items, x, y, label)} /> : null}
      {collect(cards, (b) => {
        if (isCrewResult(b) && actions.files) return <CrewResultCard key={b.id} block={b} leadThreadId={m.threadId} data={actions.files} />;
        if (isProposal(b)) return <AgentFileProposal key={b.id} block={b} host={actions.host} />;
        if (isPlanFile(b)) return <PlanFileCard key={b.id} block={b} onOpen={(id) => actions.openBeside("file", id)} />;
        const lc = linkCardOf(b);
        if (lc) return <LinkCardView key={b.id} id={b.id} data={lc} actions={actions} size={14} trusted={m.kind === "system"} />;
        if (isAccessRequest(b.type) && actions.files) return <AccessRequestCard key={b.id} block={b.data as never} data={actions.files} />;
        if (isKeyRequest(b.type) && actions.files) return <KeyRequestCard key={b.id} requestId={String((b.data as { requestId?: unknown }).requestId ?? "")} agent={item.who.name} agentId={item.who.id} data={actions.files} />;
        if (isChecklist(b.type)) return <ChecklistCard key={b.id} id={b.id} data={b.data} />;
        if (isPartOneType(b.type)) return <BlockViewA key={b.id} block={b} host={actions.host} />;
        return <Card key={b.id} line={cardLine(b)} actions={actions} />;
      })}
      {collect(errors, (b) => <ErrorRowView key={b.id} block={b} actions={actions} />)}
      {collect(statuses, (x) => (x.kind === "note" ? <Text key={x.id} testID={`status-${x.id}`} style={st.edited}>{x.text}</Text> : x.kind === "approval" && actions.files ? <ApprovalCard key={x.id} taskId={x.taskId} agent={item.who.name} agentId={item.who.id} data={actions.files} /> : null))}
      {item.who.kind === "agent" && actions.withPeople === true && !stream && m.body.trim() !== "" ? <ReplyActions m={m} actions={actions} /> : null}
      <Reactions m={m} a={actions} mine={false} />
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

/** Under an agent's answer in a chat of people: Make task and Remember, one tap each, so an answer both people read can become work without a form. They are the message menu's own actions. */
function ReplyActions({ m, actions }: { m: Message; actions: MessageActions }): ReactElement {
  const memory = useThreadMemory();
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const mark = (k: string): void => setDone((d) => new Set(d).add(k));
  return (
    <View testID={`reply-actions-${m.messageId}`} style={st.replyActs}>
      {actions.makeTask ? <TextButton label={done.has("task") ? "Task made" : "Make task"} testID={`reply-task-${m.messageId}`} onPress={() => { if (!done.has("task")) { actions.makeTask!(m.messageId); mark("task"); } }} /> : null}
      {memory ? <TextButton label={done.has("remember") ? "Remembered" : "Remember"} testID={`reply-remember-${m.messageId}`} onPress={() => { if (!done.has("remember")) { void rememberMessage(memory.memory, memory.threadId, { messageId: m.messageId, body: m.body }, memory.flash); mark("remember"); } }} /> : null}
    </View>
  );
}

/** A link card in the conversation: names by the chat's own lookup, a fact opens the Knows tab of the pane (where the chat has memory), anything else opens beside the chat. */
function LinkCardView({ id, data, actions, size, trusted }: { id: string; data: LinkCardData; actions: MessageActions; size: number; trusted: boolean }): ReactElement {
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
  const open = (t: NonNullable<LinkCardData["target"]>): void => { if (t.type === "thread" && actions.openMessage) actions.openMessage(t.id, ""); else if (t.type === "fact" && memory?.memory.showKnows) memory.memory.showKnows(); else actions.openBeside(t.type, t.id); };
  return <LinkCard id={id} data={data} nameOf={actions.nameOf ?? ((x) => x)} icon={<Glyph name={linkGlyph(data.icon)} size={size} color="var(--ink-3)" />} onOpen={open} onAction={act} done={done} state={seen.state} hidden={seen.hidden} />;
}

/** What a work card says now, read as this reader: its state while it is live (read again every few seconds), and whether they may open it at all. */
function useCardState(data: LinkCardData, actions: MessageActions): { state: CardState | null; hidden: boolean } {
  const [seen, setSeen] = useState<{ state: CardState | null; hidden: boolean }>({ state: null, hidden: false });
  const probe = probeOf(data);
  const key = probe ? `${probe.cap}:${JSON.stringify(probe.input)}` : "";
  useEffect(() => {
    if (!probe) return;
    let live = true, timer: ReturnType<typeof setTimeout> | undefined, tries = 0;
    const read = (): void => {
      Promise.resolve(actions.host.invoke(probe.cap, probe.input)).then((out) => {
        if (!live) return;
        const state = stateOf(data, out);
        setSeen({ state, hidden: false });
        if (state?.live && ++tries < 60) timer = setTimeout(read, 4000);
      }, () => { if (live) setSeen({ state: null, hidden: true }); });
    };
    read();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps -- one read loop per card
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
      {line.type === "plan" && waiting ? <View style={st.cardRow}><TextButton label="Approve plan" primary testID={`plan-approve-${line.id}`} onPress={() => actions.approvePlan(typeof line.data.planId === "string" ? line.data.planId : line.id)} /></View> : null}
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
    <View testID={`error-${block.id}`} accessibilityRole="alert" {...menuTrigger((x, y) => actions.showMenu([{ label: "Copy Trace Id", onSelect: () => actions.copy(e.traceId) }, { label: "What Happened?", onSelect: () => setOpen((o) => !o) }], x, y, "Error"))} style={st.err}>
      <View style={st.errTop}><Glyph name="alert" size={15} color="var(--warn)" /><Text style={st.errMsg}>{e.message}</Text></View>
      {e.cause ? <Text style={st.errCause}>{e.cause}</Text> : null}
      <View style={st.errActions}>
        {collect(e.next, (n) => <TextButton link key={n.key} label={n.label} testID={`err-next-${n.key}`} onPress={() => { if (n.key === "connect_ai") setAsked(true); actions.errorNext(n.key, e.turnId); }} />)}
        {e.retryable && e.turnId ? <TextButton link label="Retry" testID="err-retry" onPress={() => actions.retryTurn(e.turnId)} /> : null}
        <TextButton link label="Details" testID="err-what" onPress={() => setOpen((o) => !o)} />
        <TextButton link label="Copy id" testID="err-trace" onPress={() => actions.copy(e.traceId)} />
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
          {collect(e.steps, ([k, v]) => <View key={k} style={st.kv}><Text style={st.kvK}>{k}</Text><Text style={st.kvV}>{v}</Text></View>)}
        </View>
      ) : null}
    </View>
  );
}

export const st = StyleSheet.create({
  replyActs: { flexDirection: "row", gap: 4, marginTop: 4, marginLeft: -6 },
  day: { alignSelf: "center", fontSize: 12, color: "var(--ink-3)" as string, marginTop: 18, marginBottom: 6 },
  eventCard: { flexShrink: 1, minWidth: 0 },
  event: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, marginBottom: 2 },
  eventDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "var(--ink-4)" as string },
  eventText: { flexShrink: 1, fontSize: 12.5, color: "var(--ink-3)" as string },
  eventLink: { color: "var(--accent)" as string, textDecorationLine: "underline", cursor: "pointer" } as object,
  eventTime: { fontSize: 11.5, color: "var(--ink-4)" as string },
  gapTop: { marginTop: 18 },
  found: { backgroundColor: "var(--accent-wash)" as string, borderRadius: 8 },
  foundActive: { backgroundColor: "var(--accent-wash)" as string, borderRadius: 8, boxShadow: "inset 0 0 0 1px var(--accent)" } as object,
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
  failed: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  failedText: { fontSize: 12.5, color: "var(--danger)" as string },
  msg: { paddingVertical: 2, position: "relative", gap: 6 },
  by: { flexDirection: "row", alignItems: "center", gap: 8, height: 26 },
  who: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  time: { fontSize: 11.5, color: "var(--ink-3)" as string },
  via: { fontSize: 12, color: "var(--ink-3)" as string },
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
