// Right pane > Knows: what the agent of this chat knows here, for you. The facts in scope for this chat and this asker, live, grouped Space, Project, Agent and You, each row editable in place
// (a click turns it into an input: Enter saves through memory.fact.correct and the old wording is kept in history, Escape cancels), with its source chip (a press jumps to that line), who and how
// long ago, "Used in the last reply" and "Two answers, waiting for a pick". Hover or focus shows Edit and Forget; right-click gives Edit, Open Page, Open Source and Forget. Proposed facts wait on
// top for Accept or Reject, MAP.md is the index every chat loads, and the filter keeps only your facts or adds the replaced ones. "Show what the agent knew here" on a message pins the tab to that
// reply: facts learned after it are hidden and a line says so, with Back to now. Everything is as much as you could open yourself, never more.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { ageText } from "../../files/memory/know.ts";
import { each } from "../../files/memory/model.ts";
import { Icon } from "../../files/memory/parts.tsx";
import type { PaneDeps } from "../rightpane/actions.ts";
import { MAP_LIMIT, learnedWhen, parseMap } from "../rightpane/model.ts";
import type { MapIndex } from "../rightpane/model.ts";
import { PaneList, Switch, Tool } from "../rightpane/parts.tsx";
import type { Entry } from "../rightpane/parts.tsx";
import { usePaneData, useScreenQuery } from "../rightpane/data.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { correctFact, decideFact, forgetFacts, makeInstruction, setLessonSwitch, shareLesson } from "./actions.ts";
import { useKnowsFocus, useRead } from "./data.tsx";
import type { ChatMemoryData } from "./data.tsx";
import { HOW_TEXT, KNOWS_FOOT, KNOWS_SCOPE, LESSONS_FOOT, LESSONS_HEAD, LESSONS_OFF, LESSONS_SWITCH, SCOPE_TEXT, asOfFilter, groupKnows, isLesson, knowRowKey, usedTimes } from "./model.ts";
import type { ChatFact, KnowsOut, UsedOut } from "./model.ts";
import { ChipLink, LinkButton, ToolButton, glyphOf, sourceLabel, webProps, ownMenuKeys } from "./parts.tsx";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";

type MessagesOut = CapMap["chat.messages.list"]["out"];
const GROUP_LIMIT = 6;
/** Lines of About you shown at the top of the tab; the rest are in Settings > Memory and privacy. */
const ABOUT_LIMIT = 4;
export const ABOUT_PRIVATE = "Only you and your agents are in this chat, so agents here use your public and private profile.";
export const ABOUT_SHARED = "Other people can see this chat, so agents here use only your public profile.";
interface AboutFact { factId: string; text: string; place: "public" | "private"; suggested?: boolean; lineLink?: string; sourceLink?: string }
interface AboutOut { audience: "private" | "shared"; public: AboutFact[]; private: AboutFact[] }
/** How many of the newest agent replies are asked what they used, to find the last one that used memory. */
const LAST_REPLIES = 3;
const lastReplies = (messages: MessagesOut["messages"], n: number): MessagesOut["messages"] => [...messages].filter((m) => m.author.kind === "agent" && m.body !== "").sort((a, b) => b.threadSeq - a.threadSeq).slice(0, n);

/** memory.facts.list rows say `learnedAt`; the chat's rows say `at`. */
type RawFact = Omit<ChatFact, "at"> & { at?: number; learnedAt?: number };
const withAt = (f: ChatFact | RawFact): ChatFact => ({ ...f, at: f.at ?? (f as RawFact).learnedAt ?? 0 });

export interface KnowsFilter { fromMe: boolean; replaced: boolean }
const NO_FILTER: KnowsFilter = { fromMe: false, replaced: false };

export function KnowsTab({ deps, memory, spaceName, window }: { deps: PaneDeps; memory: ChatMemoryData; spaceName: string; window?: VirtualWindow }): ReactElement {
  const data = usePaneData();
  const menu = useMenu();
  const { store } = memory;
  const threadId = data.threadId;
  const agentId = data.agent.agentId;
  const name = data.agent.name;
  const clock = data.clock();
  const focus = useKnowsFocus(store);
  const [filter, setFilter] = useState<KnowsFilter>(NO_FILTER);
  const [all, setAll] = useState<Record<string, boolean>>({});
  const [edit, setEdit] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const knowsQ = useRead<KnowsOut>(store, "memory.knows", { threadId, agentId, ...(focus.asOf !== null ? { asOf: focus.asOf } : {}) });
  // an older server has no memory.knows: the agent's facts and the Space's, from the list that always exists
  const fallbackQ = useRead<{ facts: RawFact[] }>(store, "memory.facts.list", knowsQ.status === "absent" ? { status: ["current"], agentId } : null);
  const proposedQ = useRead<{ facts: RawFact[] }>(store, "memory.facts.list", { status: ["proposed"], layer: "agent", agentId });
  const replacedQ = useRead<{ facts: RawFact[] }>(store, "memory.facts.list", filter.replaced ? { status: ["closed"], layer: "agent", agentId } : null);
  // the lessons the agent kept from your corrections (kind lesson): their own section, with the switch that decides whether any are kept
  const lessonsQ = useRead<{ facts: RawFact[] }>(store, "memory.facts.list", { status: ["current"], agentId, kind: "lesson" });
  const switchQ = useRead<{ row?: { value?: unknown } } | null>(store, "settings.get", { key: "memory.lessons" });
  const mapQ = useRead<{ map?: { body: string; lines: number } | null }>(store, "memory.map.get", { agentId });
  // About you: the person's profile as this chat's audience allows (the private part only where nobody else reads it), the same answer the agent's context gets
  const aboutQ = useRead<AboutOut>(store, "memory.profile.get", { threadId });
  // what the last reply used, or the pinned one
  const messagesQ = useScreenQuery<MessagesOut>("chats.conversation", "messages", { threadId });
  const replies = messagesQ.status === "ready" ? lastReplies(messagesQ.data.messages, LAST_REPLIES) : [];
  const ask = (i: number): { threadId: string; messageId: string } | null => { const id = focus.messageId ?? replies[i]?.messageId; return id && (focus.messageId === null || i === 0) ? { threadId, messageId: id } : null; };
  const usedA = useRead<UsedOut>(store, "memory.used", ask(0));
  const usedB = useRead<UsedOut>(store, "memory.used", ask(1));
  const usedC = useRead<UsedOut>(store, "memory.used", ask(2));
  // the newest reply that used anything (or the pinned one): its facts are marked "Used in the last reply"
  const usedNow = [usedA, usedB, usedC].find((r) => r.status === "ready" && r.data.facts.length > 0);
  const used = new Set(usedNow && usedNow.status === "ready" ? usedNow.data.facts.map((f) => f.factId) : []);

  const say = (text: string, undo?: () => void | Promise<unknown>): void => deps.note(text, undo ? async () => { await undo(); } : undefined);

  const startEdit = (f: ChatFact): void => { setEdit(f.factId); setDraft(f.text); setErr(null); };
  const save = (f: ChatFact): void => {
    const text = draft.trim();
    setEdit(null);
    if (text === "" || text === f.text) return;
    setErr(null);
    void correctFact(memory, f.factId, text).then((r) => {
      if (r.ok) say("Saved. The old wording is kept in history.", () => store.write("memory.fact.correct", { factId: r.fact.factId, text: f.text }));
      else setErr(r.error);
    });
  };
  const forget = (f: ChatFact): void => {
    setErr(null);
    void forgetFacts(memory, [f.factId], (text, undo) => { if (undo) say(text, undo); else setErr(text); }, "Forgotten. It stays in Trash for 60 days.");
  };
  const decide = (f: ChatFact, ok: boolean): void => { setErr(null); void decideFact(memory, f.factId, ok, (text, undo) => { if (undo) say(text, undo); else setErr(text); }); };
  const openSource = (f: ChatFact): void => {
    if (f.sourceLink && f.sourceKind === "chat") memory.nav.openLink(f.sourceLink);
    else memory.nav.openSource(f.sourceKind, f.sourceRef, f.sourceLink);
  };
  const who = (f: ChatFact): string => (f.by ? (f.by === memory.me.id ? "you" : memory.nameOf(f.by)) : "");

  const rowMenu = (f: ChatFact): MenuEntry[] => [
    { label: "Edit", onSelect: () => startEdit(f) },
    ...(f.subject ? [{ label: "Open Page", onSelect: () => memory.nav.openPage(f.subject!.pageId) } as MenuEntry] : []),
    { label: "Open Source", onSelect: () => openSource(f) },
    { separator: true },
    { label: "Forget", danger: true, onSelect: () => forget(f) },
  ];
  const filterMenu = (x: number, y: number): void => {
    menu.show([
      { label: "Only facts from you", checked: filter.fromMe, onSelect: () => setFilter((c) => ({ ...c, fromMe: !c.fromMe })) },
      { label: "Include replaced facts", checked: filter.replaced, onSelect: () => setFilter((c) => ({ ...c, replaced: !c.replaced })) },
      { separator: true },
      { label: "Show current", checked: !filter.fromMe && !filter.replaced, onSelect: () => setFilter(NO_FILTER) },
    ], x, y, "other");
  };

  if (knowsQ.status === "loading" || (knowsQ.status === "absent" && fallbackQ.status === "loading")) {
    return <View testID="knows-loading" accessibilityLabel="Loading" style={st.sk}><View style={st.skBar} /><View style={[st.skBar, { width: "70%" }]} /><View style={st.skBar} /></View>;
  }
  const base: ChatFact[] = knowsQ.status === "ready" ? knowsQ.data.facts : fallbackQ.status === "ready" ? fallbackQ.data.facts.filter((f) => f.layer !== "agent" || f.agentId === agentId || f.agentId === undefined).map(withAt) : [];
  const lessons = lessonsQ.status === "ready" ? lessonsQ.data.facts.map(withAt).filter(isLesson) : [];
  const lessonIds = new Set(lessons.map((l) => l.factId));
  const learning = switchQ.status !== "ready" || switchQ.data?.row?.value !== false;
  const facts = asOfFilter(base, focus.asOf).filter((f) => !isLesson(f) && !lessonIds.has(f.factId)).filter((f) => !filter.fromMe || f.by === memory.me.id);
  const groups = groupKnows(facts);
  const proposed = proposedQ.status === "ready" ? proposedQ.data.facts.map(withAt) : [];
  const replaced = filter.replaced && replacedQ.status === "ready" ? replacedQ.data.facts.map(withAt) : [];
  const map: MapIndex | null = mapQ.status === "ready" && mapQ.data.map ? parseMap(mapQ.data.map.body, mapQ.data.map.lines) : null;
  const pinned = focus.messageId !== null;

  const row = (f: ChatFact, readonly = false): ReactElement => (
    <KnowRow
      key={f.factId} fact={f} editing={edit === f.factId} draft={draft} onDraft={setDraft} readonly={readonly} who={who(f)} age={ageText(f.at, memory.now())} used={used.has(f.factId)} pinned={pinned}
      onEdit={() => startEdit(f)} onSave={() => save(f)} onCancel={() => setEdit(null)} onForget={() => forget(f)} onSource={() => openSource(f)} menu={rowMenu(f)}
    />
  );

  const entries: Entry[] = [];
  if (pinned && focus.asOf !== null) {
    entries.push({
      key: "asof", type: "block",
      node: (
        <View testID="knows-asof" style={st.asof}>
          <Icon name="bulb" size={14} color="var(--ink-3)" />
          <Text style={st.asofText}>{`As of ${learnedWhen(focus.asOf, clock)}, this reply. Newer facts are hidden.`}</Text>
          <LinkButton label="Back to now" testID="knows-now" onPress={() => store.pinKnows(null, null)} />
        </View>
      ),
    });
  }
  const about = aboutQ.status === "ready" && !pinned ? aboutQ.data : null;
  if (about) {
    const priv = about.audience === "private";
    const lines = [...about.public.map((f) => ({ f, place: "Public" })), ...about.private.map((f) => ({ f, place: f.suggested ? "Private, suggested for public" : "Private" }))];
    entries.push({ key: "l-about", type: "label", text: "About you", right: priv ? "Public and private" : "Public only" });
    entries.push({
      key: "about", type: "block",
      node: (
        <View testID="knows-about" style={st.about}>
          <Text testID="knows-about-scope" style={st.hint}>{priv ? ABOUT_PRIVATE : ABOUT_SHARED}</Text>
          {lines.slice(0, ABOUT_LIMIT).map(({ f, place }) => (
            <Row key={f.factId} id={`about-${f.factId}`} title={f.text} note={place} {...(f.lineLink ?? f.sourceLink ? { onPress: () => memory.nav.openLink((f.lineLink ?? f.sourceLink)!) } : {})} />
          ))}
          {lines.length === 0 ? <Text testID="knows-about-empty" style={st.hint}>{priv ? "Nothing about you yet." : "Nothing on your public profile yet."}</Text> : null}
          {memory.nav.openAboutYou ? <LinkButton label={lines.length > ABOUT_LIMIT ? `See all ${lines.length} in Memory and privacy` : "Edit in Memory and privacy"} testID="knows-about-open" onPress={() => memory.nav.openAboutYou?.()} /> : null}
        </View>
      ),
    });
  }
  if (map) {
    entries.push({
      key: "map", type: "block",
      node: (
        <View testID="memory-map" style={st.map}>
          <View style={st.mapHead}>
            <View style={st.mapIcon}><Icon name="note" size={14} /></View>
            <View style={{ flex: 1, minWidth: 0 }}><Text style={st.mapName}>MAP.md</Text><Text style={st.hint}>Loaded in every chat</Text></View>
            <Text testID="map-count" style={st.mapCount}>{`${map.lines} / ${MAP_LIMIT}`}</Text>
          </View>
        </View>
      ),
    });
  }
  if (proposed.length > 0 && !pinned) {
    entries.push({ key: "l-proposed", type: "label", text: `Proposed · ${proposed.length}`, right: "Accept or reject" });
    for (const f of proposed) {
      entries.push({
        key: `p-${f.factId}`, type: "block",
        node: (
          <View style={st.cardOuter}>
            <View testID={`proposed-${f.factId}`} style={st.proposed}>
              <Text style={st.factText}>{f.text}</Text>
              <View style={st.foot}>
                <ChipLink icon={glyphOf(f.sourceKind)} label={sourceLabel(f)} testID={`proposed-source-${f.factId}`} onPress={() => openSource(f)} />
                <View style={{ flex: 1 }} />
                <Tool icon="check" label="Accept" onPress={() => decide(f, true)} testID={`accept-${f.factId}`} />
                <Tool icon="x" label="Reject" onPress={() => decide(f, false)} testID={`reject-${f.factId}`} />
              </View>
            </View>
          </View>
        ),
      });
    }
  }
  if (!pinned && (lessons.length > 0 || !learning)) {
    entries.push({ key: "l-lessons", type: "label", text: LESSONS_HEAD(name), right: String(lessons.length) });
    entries.push({
      key: "lessons-switch", type: "block",
      node: (
        <View style={st.switchRow}>
          <Text style={st.switchText}>{LESSONS_SWITCH}</Text>
          <Switch on={learning} label={LESSONS_SWITCH} onPress={() => void setLessonSwitch(memory, !learning, say)} testID="lessons-switch" />
        </View>
      ),
    });
    if (!learning) entries.push({ key: "lessons-off", type: "block", node: <Text testID="lessons-off" style={st.scope}>{LESSONS_OFF}</Text> });
    else {
      for (const l of lessons) {
        entries.push({
          key: `les-${l.factId}`, type: "block",
          node: (
            <LessonRow
              fact={l} editing={edit === l.factId} draft={draft} onDraft={setDraft} age={ageText(l.at, memory.now())} onEdit={() => startEdit(l)} onSave={() => save(l)} onCancel={() => setEdit(null)}
              onForget={() => forget(l)} onSource={() => openSource(l)} onShare={() => void shareLesson(memory, l.factId, agentId, say)} onMake={() => void makeInstruction(memory, agentId, l.text, say)}
            />
          ),
        });
      }
      entries.push({ key: "lessons-foot", type: "block", node: <Text testID="lessons-foot" style={st.scope}>{LESSONS_FOOT}</Text> });
    }
  }
  entries.push({
    key: "h-known", type: "block",
    node: (
      <View testID="knows-head" style={st.head}>
        <Text accessibilityRole="header" style={st.headText}>{pinned ? `What ${name} knew here` : `What ${name} knows here`}</Text>
        <View style={st.headRight}>
          <Text testID="knows-count" style={st.forYou}>{`for you · ${facts.length}`}</Text>
          <Tool icon="filter" label="Filter" onPress={filterMenu} active={filter.fromMe || filter.replaced} testID="knows-filter" />
        </View>
      </View>
    ),
  });
  entries.push({ key: "scope", type: "block", node: <Text testID="knows-scope" style={st.scope}>{`${KNOWS_SCOPE}`}</Text> });
  if (err) entries.push({ key: "err", type: "block", node: <Text testID="knows-error" accessibilityRole="alert" style={st.err}>{err}</Text> });
  if (groups.length === 0) entries.push({ key: "none", type: "empty", text: `Nothing specific to this chat yet in ${spaceName}.`, testID: "knows-empty" });
  for (const g of groups) {
    entries.push({ key: `l-${g.layer}`, type: "label", text: g.head, right: String(g.facts.length) });
    const shown = all[g.layer] ? g.facts : g.facts.slice(0, GROUP_LIMIT);
    for (const f of shown) entries.push({ key: `f-${f.factId}`, type: "block", node: row(f) });
    if (g.facts.length > shown.length) {
      entries.push({
        key: `more-${g.layer}`, type: "block",
        node: <View style={st.more}><LinkButton label={`Show ${g.facts.length - shown.length} more`} testID={`knows-more-${g.layer}`} onPress={() => setAll((a) => ({ ...a, [g.layer]: true }))} /></View>,
      });
    }
  }
  if (replaced.length > 0) {
    entries.push({ key: "l-replaced", type: "label", text: "Replaced", right: String(replaced.length) });
    for (const f of replaced) entries.push({ key: `r-${f.factId}`, type: "block", node: row(f, true) });
  }
  entries.push({
    key: "foot", type: "block",
    node: (
      <View testID="knows-foot" style={st.footer}>
        <Text style={st.hint}>{KNOWS_FOOT}</Text>
        <LinkButton label="Open Knowledge" testID="knows-open-knowledge" onPress={() => memory.nav.openKnowledge()} />
      </View>
    ),
  });
  return <View style={st.fill}><PaneList plain entries={entries} {...(window ? { window } : {})} testID="knows-list" />{menu.element}</View>;
}

/** One lesson in the Knows tab: its words, how it was caught, when, how often it was used and who may read it, with its own actions in a row of quiet buttons. */
function LessonRow({ fact, editing, draft, onDraft, age, onEdit, onSave, onCancel, onForget, onSource, onShare, onMake }: {
  fact: ChatFact; editing: boolean; draft: string; onDraft: (t: string) => void; age: string;
  onEdit: () => void; onSave: () => void; onCancel: () => void; onForget: () => void; onSource: () => void; onShare: () => void; onMake: () => void;
}): ReactElement {
  const info = fact.lesson;
  return (
    <View style={st.cardOuter}>
      <View testID={`lesson-${fact.factId}`} accessibilityLabel={`Lesson: ${fact.text}`} style={st.lesson}>
        {editing ? (
          <View style={st.editRow}>
            <TextInput
              autoFocus selectTextOnFocus accessibilityLabel="Edit this lesson" testID={`lesson-input-${fact.factId}`} value={draft} onChangeText={onDraft} style={st.input}
              onKeyPress={(e) => {
                const k = (e as unknown as { nativeEvent: { key: string } }).nativeEvent.key;
                if (k === "Escape") onCancel();
                else if (k === "Enter") { (e as unknown as { preventDefault?: () => void }).preventDefault?.(); onSave(); }
              }}
            />
            <LinkButton label="Save" testID={`lesson-save-${fact.factId}`} onPress={onSave} />
            <LinkButton label="Cancel" quiet testID={`lesson-cancel-${fact.factId}`} onPress={onCancel} />
          </View>
        ) : <Text testID={`lesson-text-${fact.factId}`} style={st.factText}>{fact.text}</Text>}
        <View style={st.foot}>
          {info?.how ? <Text style={st.meta}>{HOW_TEXT[info.how]}</Text> : null}
          <Text style={st.meta}>{`· ${age}`}</Text>
          {info ? <Text style={st.meta}>{`· ${usedTimes(info.used)}`}</Text> : null}
          {info ? <Text testID={`lesson-scope-${fact.factId}`} style={st.chip}>{SCOPE_TEXT[info.scope]}</Text> : null}
        </View>
        {editing ? null : (
          <View style={st.lessonActions}>
            <LinkButton label="Edit" testID={`lesson-edit-${fact.factId}`} onPress={onEdit} />
            <LinkButton label="Where it came from" testID={`lesson-from-${fact.factId}`} onPress={onSource} />
            {info?.scope === "you" ? <LinkButton label="Share with the Space" testID={`lesson-share-${fact.factId}`} onPress={onShare} /> : null}
            <LinkButton label="Make it an instruction" testID={`lesson-make-${fact.factId}`} onPress={onMake} />
            <LinkButton label="Forget" quiet testID={`lesson-forget-${fact.factId}`} onPress={onForget} />
          </View>
        )}
      </View>
    </View>
  );
}

function KnowRow({ fact, editing, draft, onDraft, readonly, who, age, used, pinned, onEdit, onSave, onCancel, onForget, onSource, menu }: {
  fact: ChatFact; editing: boolean; draft: string; onDraft: (t: string) => void; readonly: boolean; who: string; age: string; used: boolean; pinned: boolean;
  onEdit: () => void; onSave: () => void; onCancel: () => void; onForget: () => void; onSource: () => void; menu: MenuEntry[];
}): ReactElement {
  const m = useMenu();
  const [lit, setLit] = useState(false);
  const mine = !readonly;
  return (
    <View style={st.cardOuter}>
      <View
        testID={`know-${fact.factId}`} accessibilityLabel={`${fact.subject ? `${fact.subject.title}. ` : ""}${fact.text}`}
        {...webProps({ tabIndex: 0, onMouseEnter: () => setLit(true), onMouseLeave: () => setLit(false), onFocus: () => setLit(true), onBlur: () => setLit(false) })}
        {...(mine ? ownMenuKeys((x, y) => m.show(menu, x, y, "context", { label: fact.text }), (e) => { if (e.target === e.currentTarget && knowRowKey(e.key) === "edit") { e.preventDefault?.(); onEdit(); } }) : {})}
        style={[st.row, lit && st.rowLit]}
      >
        {editing ? (
          <View style={st.editRow}>
            <TextInput
              autoFocus selectTextOnFocus accessibilityLabel="Edit this fact" testID={`know-input-${fact.factId}`} value={draft} onChangeText={onDraft} style={st.input}
              onKeyPress={(e) => {
                const k = (e as unknown as { nativeEvent: { key: string } }).nativeEvent.key;
                if (k === "Escape") onCancel();
                else if (k === "Enter") { (e as unknown as { preventDefault?: () => void }).preventDefault?.(); onSave(); }
              }}
            />
            <LinkButton label="Save" testID={`know-save-${fact.factId}`} onPress={onSave} />
            <LinkButton label="Cancel" quiet testID={`know-cancel-${fact.factId}`} onPress={onCancel} />
          </View>
        ) : (
          <Text
            testID={`know-text-${fact.factId}`} accessibilityRole={mine ? "button" : "text"} accessibilityLabel={mine ? `Edit: ${fact.text}` : fact.text}
            {...(mine ? { onPress: onEdit } : {})} style={st.factText}
          >
            {fact.subject ? <Text style={st.bold}>{`${fact.subject.title} `}</Text> : null}{fact.text}
          </Text>
        )}
        <View style={st.foot}>
          <ChipLink icon={glyphOf(fact.sourceKind)} label={sourceLabel(fact)} testID={`know-src-${fact.factId}`} onPress={onSource} />
          <Text style={st.meta}>{`${who ? `${who} · ` : ""}${age}`}</Text>
          {used ? <Text testID={`know-used-${fact.factId}`} style={st.used}>{pinned ? "Used in this reply" : "Used in the last reply"}</Text> : null}
          {fact.conflict ? <Text style={st.warn}>Two answers, waiting for a pick</Text> : null}
          {readonly ? <Text style={st.meta}>Replaced. It no longer shapes answers.</Text> : null}
        </View>
        {mine && !editing ? (
          <View style={[st.actions, { opacity: lit ? 1 : 0 }]}>
            <ToolButton icon="edit" label="Edit" testID={`know-edit-${fact.factId}`} onPress={onEdit} />
            <ToolButton icon="trash" label="Forget" testID={`know-forget-${fact.factId}`} onPress={onForget} />
          </View>
        ) : null}
        {m.element}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
  sk: { padding: 8, gap: 12 },
  skBar: { height: 12, borderRadius: 6, backgroundColor: "var(--sunk)" as string },
  head: { minHeight: 34, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 8, paddingTop: 12, paddingBottom: 2 },
  headText: { flexShrink: 1, fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  headRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  forYou: { fontSize: 11.5, color: "var(--ink-3)" as string },
  scope: { paddingHorizontal: 8, paddingBottom: 8, fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
  err: { paddingHorizontal: 8, paddingBottom: 6, fontSize: 12, color: "var(--danger)" as string },
  hint: { fontSize: 11.5, lineHeight: 16, color: "var(--ink-3)" as string },
  asof: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 8, marginTop: 8, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9, backgroundColor: "var(--sunk)" as string, boxShadow: "inset 0 0 0 1px var(--line)" } as object,
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 6 },
  switchText: { fontSize: 13, color: "var(--ink)" as string },
  lesson: { paddingVertical: 8, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  lessonActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 10, rowGap: 2, marginTop: 5 },
  chip: { fontSize: 11.5, color: "var(--ink-3)" as string, paddingHorizontal: 7, paddingVertical: 1, borderRadius: 7, backgroundColor: "var(--sunk)" as string, overflow: "hidden" },
  asofText: { flex: 1, fontSize: 12, color: "var(--ink-2)" as string },
  map: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 4, gap: 8 },
  about: { paddingHorizontal: 8, paddingBottom: 6, gap: 2 },
  mapHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  mapIcon: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: "var(--line)" as string, alignItems: "center", justifyContent: "center", backgroundColor: "var(--raised)" as string },
  mapName: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  mapCount: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  cardOuter: { paddingHorizontal: 8, paddingVertical: 3 },
  proposed: { padding: 10, gap: 6, borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string },
  row: { position: "relative", paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-1), inset 0 0 0 1px var(--line)", outlineStyle: "none" } as object,
  rowLit: { boxShadow: "var(--sh-1), inset 0 0 0 1px var(--line-2)" } as object,
  factText: { fontSize: 13, lineHeight: 19, color: "var(--ink)" as string, paddingRight: 44 },
  bold: { fontWeight: "600" },
  foot: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 5 },
  meta: { fontSize: 11.5, color: "var(--ink-3)" as string },
  used: { fontSize: 11.5, fontWeight: "500", color: "var(--accent)" as string },
  warn: { fontSize: 11.5, fontWeight: "500", color: "var(--warn)" as string },
  actions: { position: "absolute", right: 6, top: 6, flexDirection: "row" },
  editRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  input: { flex: 1, minWidth: 0, height: 28, paddingHorizontal: 9, borderRadius: 7, backgroundColor: "var(--field)" as string, color: "var(--ink)" as string, fontSize: 12.5, boxShadow: "inset 0 0 0 1px var(--line-2)", outlineStyle: "none" } as object,
  more: { paddingHorizontal: 8, paddingVertical: 2, alignItems: "flex-start" },
  footer: { paddingHorizontal: 8, paddingTop: 12, paddingBottom: 10, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 },
});
