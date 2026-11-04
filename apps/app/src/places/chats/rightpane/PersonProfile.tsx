// A person's profile pane, the same skeleton as an agent's: the header (face with presence, name, one role line that opens on press, Message and what the shell can do, one "..." menu), tabs only when useful
// (About, Chats, Files, Tasks) and About with what they are responsible for, how they are right now and what they set about themselves (their time, working hours, pronouns). A line the Space has
// no answer for is left out; nothing here is guessed. Reads are the Space's own capabilities: devices.presence, settings.public_of, threads.list, files.shared_with_me and tasks.list.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { LeadIcon } from "./parts.tsx";
import { chatName } from "../../../../../../lib/chat-name.ts";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { ProfileHeader } from "./ProfileHeader.tsx";
import type { HeaderAction, Presence } from "./ProfileHeader.tsx";
import { cityOf, hoursWords, lastActive, localTime, notifyWords, paceWords, personLine, presenceWord, publicLines, responsibleFor } from "./person-model.ts";
import type { PresenceState } from "./person-model.ts";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";

type Call = (cap: string, input: unknown) => Promise<unknown>;
type PublicOut = CapMap["settings.public_of"]["out"];
type PresenceOut = CapMap["devices.presence"]["out"]["people"][number];
type ThreadRow = CapMap["threads.list"]["out"]["threads"][number];
type FileRow = CapMap["files.shared_with_me"]["out"]["files"][number];
type TaskRow = CapMap["tasks.list"]["out"]["tasks"][number];

const ROLE_WORD: Record<string, string> = { lead: "Lead", member: "Member", reviewer: "Reviewer", guest: "Guest" };

export type PersonTab = "about" | "chats" | "files" | "tasks";
export const PERSON_TABS: readonly { key: PersonTab; title: string }[] = [{ key: "about", title: "About" }, { key: "chats", title: "Chats" }, { key: "files", title: "Files" }, { key: "tasks", title: "Tasks" }];

export interface PersonProfileProps {
  id: string; name: string; /** their title or role in this Space, from the directory */ title?: string | undefined; call: Call; now(): number;
  onMessage(): void; onMention(): void;
  /** Copies text to the clipboard; the "..." menu is drawn only where it can do this. */
  copy?: ((text: string) => void) | undefined;
  /** Places a call from the Space's softphone; given only where the Space has telephony. Call is drawn when this is given and the person has set a phone teammates can call. */
  dial?: ((number: string) => void) | undefined;
  /** Opens the Add people and agents sheet on the open chat; without it the third action is Mention. */
  onAdd?: (() => void) | undefined;
  openThread?(threadId: string): void; openFile?(fileId: string): void; openTask?(taskId: string): void;
  /** The directory name of a person or agent, and who the viewer is: a chat in Shared context takes its one name (lib/chat-name.ts). */
  nameOf?: ((id: string) => string) | undefined; meId?: string | undefined;
  /** The chat this profile was opened from: how they hear about it (Notifies) is read for it. */
  threadId?: string | undefined;
  /** Opens a project the two of you can see (Shared context). */
  openProject?(projectId: string): void;
  initialTab?: PersonTab;
}

function useRead<T>(call: Call, cap: string, input: unknown, pick: (o: unknown) => T): T | null {
  const [v, setV] = useState<T | null>(null);
  const key = JSON.stringify(input);
  useEffect(() => {
    let live = true;
    void Promise.resolve(call(cap, JSON.parse(key))).then((o) => { if (live) setV(pick(o)); }, () => undefined);
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call, cap, key]);
  return v;
}

/** What the header offers for a person: Message and Mention always, Call only where the shell gave it (the Space has a number and the person has a phone). */
export function personActions(p: { onMessage(): void; onMention(): void; onAdd?: (() => void) | undefined; onCall?: (() => void) | undefined }, first: string): HeaderAction[] {
  return [
    { key: "message", icon: "chat", label: "Message", hint: `Chat with ${first}`, onPress: p.onMessage },
    ...(p.onCall ? [{ key: "call", icon: "phone" as const, label: "Call", hint: `Call ${first}`, onPress: p.onCall }] : []),
    p.onAdd ? { key: "add", icon: "plus", label: "Add to chat", hint: `Add ${first} to this chat`, onPress: p.onAdd } : { key: "mention", icon: "plus", label: "Mention", hint: `Mention ${first} in this chat`, onPress: p.onMention },
  ];
}

export function PersonProfile(p: PersonProfileProps): ReactElement {
  const [tab, setTab] = useState<PersonTab>(p.initialTab ?? "about");
  const menu = useMenu();
  const first = p.name.split(/\s+/)[0] ?? p.name;
  const presence = useRead<PresenceOut | undefined>(p.call, "devices.presence", { people: [p.id] }, (o) => (o as CapMap["devices.presence"]["out"]).people[0]);
  const pub = useRead<PublicOut>(p.call, "settings.public_of", { personId: p.id }, (o) => o as PublicOut);
  const roles = useRead<{ id: string; project: string; role: string }[]>(p.call, "projects.roles_of", { personId: p.id }, (o) => (o as CapMap["projects.roles_of"]["out"]).roles.map((r) => ({ id: r.projectId, project: r.title, role: ROLE_WORD[r.role] ?? r.role })));
  const shared = useRead<ThreadRow[]>(p.call, "threads.list", { kind: ["chat"], mine: true, order: "latest", limit: 60 }, (o) => (o as CapMap["threads.list"]["out"]).threads.filter((t) => t.members.some((m) => m.kind === "person" && m.id === p.id)));
  const pace = useRead<CapMap["chat.pace_of"]["out"]>(p.call, "chat.pace_of", { personId: p.id, ...(p.threadId ? { threadId: p.threadId } : {}) }, (o) => o as CapMap["chat.pace_of"]["out"]);
  const known = useRead<string[]>(p.call, "memory.profile.get", { personId: p.id }, (o) => publicLines(o as CapMap["memory.profile.get"]["out"]));
  const state = presence?.state as PresenceState | undefined;
  const time = localTime(p.now(), pub?.timezone);
  const dot: Presence | undefined = state === "online" ? "on" : state === "away" ? "away" : state === "offline" ? "asleep" : undefined;
  const phone = pub?.phone;
  const dial = p.dial;
  const actions = personActions({ onMessage: p.onMessage, onMention: p.onMention, onAdd: p.onAdd, onCall: phone && dial ? () => dial(phone) : undefined }, first);
  const copy = p.copy;
  const more = copy ? (x: number, y: number): void => menu.show([{ label: "Copy Name", onSelect: () => copy(p.name) }], x, y, "other") : undefined;
  return (
    <View testID={`profile-${p.id}`} style={st.root}>
      <ProfileHeader name={p.name} seedId={p.id} kind="person" {...(dot ? { presence: dot } : {})} line={personLine(p.title ?? pub?.title, state, time, first)} actions={actions} {...(more ? { onMore: more } : {})} testID="person-header" />
      <View style={st.tabs} accessibilityRole="tablist">
        {/* ui-rows-lint: not a list (the profile's tabs) */}
        {PERSON_TABS.map((t) => (
          <Pressable key={t.key} role="tab" accessibilityRole="tab" aria-selected={tab === t.key} testID={`person-tab-${t.key}`} onPress={() => setTab(t.key)} style={st.tab}>
            <Text style={[st.tabText, tab === t.key && st.tabOn]}>{t.title}</Text>
            {tab === t.key ? <View style={st.under} /> : null}
          </Pressable>
        ))}
      </View>
      <ScrollView style={st.body} contentContainerStyle={st.content}>
        {tab === "about" ? <About {...p} pace={pace} chats={shared ?? []} known={known ?? []} roles={roles ?? []} first={first} state={state} lastSeenAt={presence?.lastSeenAt} pub={pub} time={time} /> : null}
        {tab === "chats" ? <Chats {...p} first={first} /> : null}
        {tab === "files" ? <Files {...p} first={first} /> : null}
        {tab === "tasks" ? <Tasks {...p} first={first} /> : null}
      </ScrollView>
      {menu.element}
    </View>
  );
}

const label = (t: string): ReactElement => <Text key={t} style={st.label}>{t}</Text>;
const kv = (k: string, v: string | undefined): ReactElement | null => (v === undefined || v === "" ? null : <View key={k} style={st.kv}><Text style={st.k}>{k}</Text><Text style={[st.v, st.vEnd]}>{v}</Text></View>);

/** A chat's one name: its title, else who is in it (lib/chat-name.ts), the same as the sidebar and the tabs. */
export function chatLabel(p: PersonProfileProps, t: ThreadRow): string {
  const name = p.nameOf ?? ((id: string): string => id);
  return chatName({ title: t.title, kind: t.kind, agents: t.agents.map((a) => a.agentId), people: t.members.filter((m) => m.kind === "person" && m.id !== p.meId).map((m) => m.id) }, name);
}

function About(p: PersonProfileProps & { pace: CapMap["chat.pace_of"]["out"] | null; chats: readonly ThreadRow[]; known: readonly string[]; roles: readonly { id: string; project: string; role: string }[]; first: string; state: PresenceState | undefined; lastSeenAt: number | undefined; pub: PublicOut | null; time: string | undefined }): ReactElement {
  const roles = p.roles;
  const resp = responsibleFor(p.title ?? p.pub?.title, roles);
  const away = p.state === "away";
  const now = lastActive(p.now(), p.lastSeenAt);
  return (
    <View testID="person-about">
      {label("Responsible for")}<Text testID="person-resp" style={st.body14}>{resp}</Text>
      {p.state !== undefined ? <>{label("Right now")}<View style={st.now}><View style={[st.dot, { backgroundColor: (away ? "var(--warn)" : p.state === "online" ? "var(--ok)" : "var(--ink-4)") as string }]} /><View><Text style={st.v}>{presenceWord(p.state)}</Text>{now ? <Text style={st.sub}>{now}</Text> : null}</View></View></> : null}
      {p.pace !== null || p.pub?.hours || p.pub?.timezone ? <>{label(`How ${p.first} responds here`)}
        {kv("Replies", p.pace !== null ? paceWords(p.pace.replies) : undefined)}
        {kv("Notifies", notifyWords(p.pace?.notifies))}
        {kv("Available", p.pub?.hours ? hoursWords(p.pub.hours) : undefined)}
        {kv("Their time", p.time && p.pub?.timezone ? `${p.time} · ${cityOf(p.pub.timezone)}` : undefined)}</> : null}
      {p.roles.length > 0 || p.chats.length > 0 ? <>{label("Shared context")}
        {p.roles.map((r) => (
          <Row key={r.id} id={`person-project-${r.id}`} title={r.project} note={`Project · ${r.role}`} leading={<LeadIcon name="folder" />} onPress={() => p.openProject?.(r.id)} />
        ))}
        {p.chats.slice(0, 3).map((t) => (
          <Row key={t.threadId} id={`person-shared-chat-${t.threadId}`} title={chatLabel(p, t)} note="Chat · you both" leading={<LeadIcon name="chat" />} onPress={() => p.openThread?.(t.threadId)} />
        ))}</> : null}
      {p.pub?.pronouns || p.known.length > 0 ? label(`About ${p.first}`) : null}
      {kv("Pronouns", p.pub?.pronouns)}
      {/* ui-rows-lint: not a list (the public lines about the person, read-only paragraphs under About) */}
      {p.known.map((line) => <Text key={line} testID="person-known" style={[st.body14, st.fact]}>{line}</Text>)}
    </View>
  );
}

function Chats(p: PersonProfileProps & { first: string }): ReactElement {
  const rows = useRead<ThreadRow[]>(p.call, "threads.list", { kind: ["chat"], mine: true, order: "latest", limit: 60 }, (o) => (o as CapMap["threads.list"]["out"]).threads.filter((t) => t.members.some((m) => m.kind === "person" && m.id === p.id)));
  return (
    <View testID="person-chats">
      {label(`Chats with ${p.first}`)}
      {rows === null ? null : rows.length === 0 ? <Text style={st.sub}>Nothing yet. Press Message to start one.</Text> : rows.map((t) => (
        <Row key={t.threadId} id={`person-chat-${t.threadId}`} title={t.title ?? t.preview ?? "Chat"} leading={<LeadIcon name="chat" />} onPress={() => p.openThread?.(t.threadId)} />
      ))}
    </View>
  );
}

function Files(p: PersonProfileProps & { first: string }): ReactElement {
  const rows = useRead<FileRow[]>(p.call, "files.shared_with_me", { limit: 100 }, (o) => (o as CapMap["files.shared_with_me"]["out"]).files.filter((f) => f.ownerId === p.id));
  return (
    <View testID="person-files">
      {label("Shared with you")}
      {rows === null ? null : rows.length === 0 ? <Text style={st.sub}>{p.first} has not shared a file with you.</Text> : rows.map((f) => (
        <Row key={f.fileId} id={`person-file-${f.fileId}`} title={f.name} leading={<LeadIcon name="file" />} onPress={() => p.openFile?.(f.fileId)} />
      ))}
    </View>
  );
}

function Tasks(p: PersonProfileProps & { first: string }): ReactElement {
  const rows = useRead<TaskRow[]>(p.call, "tasks.list", { scope: "all", assignee: { kind: "person", id: p.id }, states: ["todo", "doing", "in_review", "awaiting_approval"], limit: 50 }, (o) => (o as CapMap["tasks.list"]["out"]).tasks);
  return (
    <View testID="person-tasks">
      {label(`Waiting on ${p.first}`)}
      {rows === null ? null : rows.length === 0 ? <Text style={st.sub}>Nothing is waiting on {p.first}.</Text> : rows.map((t) => (
        <Row key={t.id} id={`person-task-${t.id}`} title={t.title} leading={<LeadIcon name="check" />} onPress={() => p.openTask?.(t.id)} />
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  tabs: { flexDirection: "row", gap: 6, marginTop: 10, paddingTop: 12, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  tab: { height: 34, paddingHorizontal: 8, justifyContent: "center" },
  tabText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  tabOn: { color: "var(--ink)" as string, fontWeight: "500" },
  under: { position: "absolute", left: 6, right: 6, bottom: -1, height: 2, borderRadius: 2, backgroundColor: "var(--ink)" as string },
  body: { flex: 1, minHeight: 0 },
  content: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 36 },
  label: { fontSize: 12, color: "var(--ink-4)" as string, paddingTop: 30, paddingBottom: 10 },
  body14: { fontSize: 14, lineHeight: 21, color: "var(--ink-2)" as string },
  now: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 3 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  kv: { flexDirection: "row", justifyContent: "space-between", gap: 14, paddingVertical: 12, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  k: { flexShrink: 0, fontSize: 13.5, color: "var(--ink-3)" as string },
  vEnd: { flex: 1, textAlign: "right" },
  v: { flexShrink: 1, fontSize: 14, lineHeight: 19, color: "var(--ink)" as string },
  fact: { paddingVertical: 6 },
  sub: { fontSize: 12.5, lineHeight: 17, color: "var(--ink-3)" as string },
  row: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 56, paddingVertical: 10 },
  rowText: { flex: 1, minWidth: 0 },
});
