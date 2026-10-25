// One entry of the conversation. Yours is a bubble on the right; anyone else's has a header (face, name, time) when the author changes; an agent's work folds into one line; native
// cards (question, plan, terminal, changeset, file) sit under the text; an error is one inline row (what, why, next). Hover shows Copy and Edit and the rest; right-click opens the same
// list; the keyboard reaches both. Every row is memoised on its item, so a streaming message re-renders alone.
import { memo, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { menuTrigger } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { MarkdownBlocks, StreamText } from "../../../../../../ui/src/stream/index.ts";
import type { StreamStore } from "../../../../../../ui/src/stream/index.ts";
import { BlockViewA, isPartOneType } from "../../../../../../ui/src/blocks/impl-a/index.tsx";
import type { BlockHost } from "../../../../../../ui/src/blocks/impl-a/index.tsx";
import { Face } from "../needsyou/parts.tsx";
import { AgentFileProposal, PlanFileCard, isPlanFile, isProposal } from "./proposal.tsx";
import { Fold, Glyph, IconButton, TextButton } from "./parts.tsx";
import type { GlyphName } from "./parts.tsx";
import { bodyBlocks, cardLine, collect, errorRow, isCard, isErrorBlock, planSteps, questionOptions, workOf } from "./model.ts";
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
  errorNext(key: string): void;
  retrySend(messageId: string): void;
  discardSend(messageId: string): void;
  showMenu(items: readonly MenuEntry[], x: number, y: number, label: string): void;
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

export const MessageView = memo(function MessageView(props: MessageViewProps): ReactElement | null {
  const { item } = props;
  if (item.kind === "day") return <Text testID={`day-${item.key}`} accessibilityRole="header" style={st.day}>{item.label}</Text>;
  if (item.kind === "event") {
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

function menuFor(m: Message, mine: boolean, a: MessageActions, onEdit: () => void): MenuEntry[] {
  const items: MenuEntry[] = [{ label: "Copy", onSelect: () => a.copy(m.body) }];
  if (mine && m.kind === "text") items.push({ label: "Edit", onSelect: onEdit });
  items.push({ label: "Reply in Thread", onSelect: () => a.openThread(m.messageId) });
  items.push({ label: m.pinned ? "Unpin Message" : "Pin Message", onSelect: () => a.setPinned(m.messageId, !m.pinned) });
  items.push({ label: "Add Reaction", onSelect: () => a.react(m.messageId, "👍", false) });
  if (mine) items.push({ separator: true }, { label: "Delete", danger: true, onSelect: () => a.remove(m.messageId) });
  return items;
}

function HoverBar({ m, mine, a, onEdit, visible }: { m: Message; mine: boolean; a: MessageActions; onEdit: () => void; visible: boolean }): ReactElement {
  const bar: { icon: GlyphName; label: string; run: () => void }[] = [{ icon: "copy", label: "Copy", run: () => a.copy(m.body) }];
  if (mine && m.kind === "text") bar.push({ icon: "edit", label: "Edit", run: onEdit });
  bar.push({ icon: "reply", label: "Reply in thread", run: () => a.openThread(m.messageId) });
  return (
    <View testID={`hover-${m.messageId}`} accessibilityRole="toolbar" accessibilityLabel="Message actions" style={[st.hover, mine ? st.hoverMine : st.hoverTheirs, { opacity: visible ? 1 : 0 }]}>
      {collect(bar, (b) => <IconButton key={b.label} icon={b.icon} label={b.label} size={24} testID={`act-${b.label.split(" ")[0]?.toLowerCase()}-${m.messageId}`} onPress={() => b.run()} />)}
      <IconButton icon="more" label="More" size={24} testID={`act-more-${m.messageId}`} onPress={(x, y) => a.showMenu(menuFor(m, mine, a, onEdit), x, y, "Message")} />
    </View>
  );
}

function useHover(): { over: boolean; focus: boolean; props: Record<string, unknown> } {
  const [over, setOver] = useState(false);
  const [focus, setFocus] = useState(false);
  return { over, focus, props: webProps({ onMouseEnter: () => setOver(true), onMouseLeave: () => setOver(false), onFocus: () => setFocus(true), onBlur: () => setFocus(false) }) };
}

/* ---------- yours ---------- */

function Mine({ item, actions, sending, mark }: MessageViewProps & { item: Extract<Item, { kind: "me" }> }): ReactElement {
  const m = item.message;
  const h = useHover();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body);
  const startEdit = (): void => { setDraft(m.body); setEditing(true); };
  const save = (): void => {
    const body = draft.trim();
    setEditing(false);
    if (body !== "" && body !== m.body) actions.edit(m.messageId, body);
  };
  return (
    <View testID={`msg-${m.messageId}`} accessibilityLabel={`You, ${item.time}`} {...h.props} {...menuTrigger((x, y) => actions.showMenu(menuFor(m, true, actions, startEdit), x, y, "Message"))} style={[st.me, item.newgroup && st.gapTop, mark === "match" && st.found, mark === "active" && st.foundActive]}>
      <HoverBar m={m} mine a={actions} onEdit={startEdit} visible={h.over || h.focus} />
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
      ) : (
        <View style={[st.bubble, sending === "sending" && { opacity: 0.7 }]}>
          <Text selectable style={st.bubbleText}>{m.body}</Text>
        </View>
      )}
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
    </View>
  );
}

/* ---------- anyone else's ---------- */

function Theirs({ item, actions, stream, openWork, mark }: MessageViewProps & { item: Extract<Item, { kind: "other" }> }): ReactElement {
  const m = item.message;
  const h = useHover();
  const work = workOf(m);
  const [workOpen, setWorkOpen] = useState(openWork === true);
  const cards = m.blocks.filter(isCard);
  const errors = m.blocks.filter(isErrorBlock);
  const person = item.who.kind === "person";
  const blocks = stream ? null : bodyBlocks(m.messageId, m.body);
  return (
    <View testID={`msg-${m.messageId}`} accessibilityLabel={`${item.who.name}, ${item.time}`} {...h.props} {...menuTrigger((x, y) => actions.showMenu(menuFor(m, false, actions, () => undefined), x, y, "Message"))} style={[st.msg, item.newgroup && st.gapTop, mark === "match" && st.found, mark === "active" && st.foundActive]}>
      <HoverBar m={m} mine={false} a={actions} onEdit={() => undefined} visible={h.over || h.focus} />
      {item.newgroup ? (
        <View style={st.by}>
          <Face name={item.who.name} kind={person ? "person" : "agent"} size={20} />
          <Pressable accessibilityRole="link" accessibilityLabel={`Open ${item.who.name}`} testID={`who-${m.messageId}`} disabled={person} onPress={() => actions.openAgent(item.who.id)}>
            <Text style={st.who}>{item.who.name}</Text>
          </Pressable>
          <Text style={st.time}>{item.time}</Text>
        </View>
      ) : <Text style={st.whenLeft}>{item.time}</Text>}
      {m.via ? <Text testID={`via-${m.messageId}`} style={st.via}>{`Sent by ${item.who.name} on a routine ${m.via.routineOwner} set`}</Text> : null}
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
      {stream ? <View testID={`body-${m.messageId}`} style={st.body}><StreamText store={stream} /></View> : m.body ? <View testID={`body-${m.messageId}`} style={st.body}><MarkdownBlocks blocks={blocks ?? []} /></View> : null}
      {collect(cards, (b) => {
        if (isProposal(b)) return <AgentFileProposal key={b.id} block={b} host={actions.host} />;
        if (isPlanFile(b)) return <PlanFileCard key={b.id} block={b} onOpen={(id) => actions.openBeside("file", id)} />;
        if (isPartOneType(b.type)) return <BlockViewA key={b.id} block={b} host={actions.host} />;
        return <Card key={b.id} line={cardLine(b)} actions={actions} />;
      })}
      {collect(errors, (b) => <ErrorRowView key={b.id} block={b} actions={actions} />)}
      <Reactions m={m} a={actions} mine={false} />
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

const CARD_ICON: Record<string, GlyphName> = { terminal: "term", plan: "plan", file: "file", changeset: "file", diff: "file", screenshot: "file", record_card: "file", question: "spark" };
const OPENS = new Set(["terminal", "changeset", "diff", "file", "record_card", "tab_opened", "screenshot", "deploy", "mount"]);

function Card({ line, actions }: { line: CardLine; actions: MessageActions }): ReactElement {
  const icon: GlyphName = CARD_ICON[line.type] ?? "spark";
  const waiting = line.state === "waiting";
  const opens = OPENS.has(line.type);
  const openId = typeof line.data.id === "string" ? line.data.id : line.id;
  const options = line.type === "question" ? questionOptions(line.data) : [];
  const answered = line.type === "question" && line.data.answer !== undefined ? String(line.data.answer) : "";
  const steps = line.type === "plan" ? planSteps(line.data) : [];
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
      {line.type === "question" && waiting && options.length > 0 ? (
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
  return (
    <View testID={`error-${block.id}`} accessibilityRole="alert" style={st.err}>
      <View style={st.errTop}><Glyph name="alert" size={15} color="var(--danger)" /><Text style={st.errMsg}>{e.message}</Text></View>
      {e.cause ? <Text style={st.errCause}>{e.cause}</Text> : null}
      <View style={st.errActions}>
        {collect(e.next, (n) => <TextButton key={n.key} label={n.label} testID={`err-next-${n.key}`} onPress={() => actions.errorNext(n.key)} />)}
        {e.retryable && e.turnId ? <TextButton label="Retry" testID="err-retry" onPress={() => actions.retryTurn(e.turnId)} /> : null}
        <TextButton label="What happened?" testID="err-what" onPress={() => setOpen((o) => !o)} />
        <TextButton label="Copy trace id" testID="err-trace" onPress={() => actions.copy(e.traceId)} />
      </View>
      {open ? (
        <View testID="err-steps" style={st.errSteps}>
          {collect(e.steps, ([k, v]) => <View key={k} style={st.kv}><Text style={st.kvK}>{k}</Text><Text style={st.kvV}>{v}</Text></View>)}
        </View>
      ) : null}
    </View>
  );
}

export const st = StyleSheet.create({
  day: { alignSelf: "center", fontSize: 12, color: "var(--ink-3)" as string, marginTop: 18, marginBottom: 6 },
  event: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, marginBottom: 2 },
  eventDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "var(--ink-4)" as string },
  eventText: { flexShrink: 1, fontSize: 12.5, color: "var(--ink-3)" as string },
  eventTime: { fontSize: 11.5, color: "var(--ink-4)" as string },
  gapTop: { marginTop: 18 },
  found: { backgroundColor: "var(--accent-wash)" as string, borderRadius: 8 },
  foundActive: { backgroundColor: "var(--accent-wash)" as string, borderRadius: 8, boxShadow: "inset 0 0 0 1px var(--accent)" } as object,
  me: { alignItems: "flex-end", paddingVertical: 2, marginTop: 4, position: "relative" },
  when: { position: "absolute", left: 0, top: 10, fontSize: 11, color: "var(--ink-4)" as string, opacity: 0 },
  whenLeft: { position: "absolute", left: -44, top: 4, fontSize: 11, color: "var(--ink-4)" as string, opacity: 0 },
  bubble: { maxWidth: "85%", backgroundColor: "var(--me)" as string, borderRadius: 18, paddingHorizontal: 15, paddingVertical: 9 },
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
  err: { borderWidth: 1, borderColor: "var(--danger)" as string, borderRadius: 10, padding: 12, gap: 6, maxWidth: 560 },
  errTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  errMsg: { flexShrink: 1, fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  errCause: { fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string },
  errActions: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  errSteps: { gap: 4, paddingTop: 4 },
  kv: { flexDirection: "row", gap: 12 },
  kvK: { width: 72, fontSize: 12, color: "var(--ink-3)" as string },
  kvV: { flex: 1, fontSize: 12.5, color: "var(--ink-2)" as string },
});
