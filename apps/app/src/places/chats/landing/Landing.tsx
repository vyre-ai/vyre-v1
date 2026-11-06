// The first screen is a new chat (no Home): the mark and "What are we working on?", the composer, who it starts with, then what needs you (top 3, "N more in Tasks") and what is running. Start typing or
// answer something without going anywhere. With nothing waiting it shows only the composer and what is running; on a first day the setup checklist takes the list's place. Home's Needs you model and actions are
// reused as they are, so a thing decided here is decided everywhere. Until mail, a calendar or a number flows in, the checklist carries an Email and calendar row that opens where they connect.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Avatar, avatarOf } from "../../../../../../ui/src/Avatar/index.tsx";
import { GoalsNow } from "../goals/GoalsList.tsx";
import type { ComposerSend } from "../../../../../../ui/src/Composer/index.tsx";
import type { ChatMode } from "../../../../../../ui/src/Composer/brain.ts";
import { DeferredComposer as Composer } from "../../../../../../ui/src/Composer/Deferred.tsx";
import type { AccessPick } from "../../../../../../ui/src/AccessSheet/index.tsx";
import { WorkingMark } from "../../../../../../ui/src/WorkingMark/index.tsx";
import { sq } from "../../../../../../ui/src/SidePane/host.tsx";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useResume } from "../../../onboarding/resume-context.ts";
import { SetupRows, setupNote } from "../../../onboarding/SetupRows.tsx";
import { useInboxSources } from "../../../shell/rail/inbox-sources.ts";
import { needsRow } from "./needs-row.ts";
import { useAddSheet, runAfterStart } from "../addsheet/index.ts";
import { prettyModel, useAccounts } from "../conversation/brain.tsx";
import { NewChatBrain, newChatStrip } from "../conversation/new-chat-brain.tsx";
import type { NewChoice } from "../conversation/new-chat-brain.tsx";
import { commandItems } from "../conversation/commands.ts";
import { postWithFiles, uploadDeps } from "../conversation/actions.ts";
import { each } from "../../../shell/sidebar/model.ts";
import { Glyph } from "../sidebar/parts.tsx";
import { useLive } from "../mounts/live.ts";
import { LANDING_NEEDS, moreLine, realAssistant, startFailure, startInput, workingChats, workingLine } from "./model.ts";
import type { NeedItem, NeedsOut, RecentOut, WithEntry } from "./model.ts";

export interface LandingProps {
  rt: ShellRuntime;
  nameOf(id: string): string;
  kindOf(id: string): "agent" | "person";
  openChat(threadId: string): void;
  openTasks(): void;
  openNeed(taskId: string): void;
  openProfile(id: string): void;
  /** A slash command needs a chat: the chat starts and the words wait in its composer. */
  fill(text: string): void;
  newKey(): string;
  say(text: string): void;
  /** The phone has no sidebar sheet: its list of chats sits under the first screen. */
  list?: ReactNode;
}

const isAssistant = (rt: ShellRuntime, id: string): boolean => id === rt.assistant.id;

export function Landing(p: LandingProps): ReactElement {
  const { rt } = p;
  const you: WithEntry = useMemo(() => ({ id: rt.assistant.id, name: rt.assistant.name, kind: "assistant" }), [rt.assistant.id, rt.assistant.name]);
  const [picked, setPicked] = useState<readonly WithEntry[]>([you]);
  // the Assistant is made a moment after the account: when the real one arrives, the one picked is it, not the placeholder the page mounted with
  useEffect(() => { setPicked((cur) => (cur.some((c) => c.kind === "assistant" && (c.id !== you.id || c.name !== you.name)) ? cur.map((c) => (c.kind === "assistant" ? you : c)) : cur)); }, [you]);
  const [choice, setChoice] = useState<NewChoice>({ mode: "auto" });
  // the model, provider and effort this person picked last, anywhere, are what a new chat shows and starts on (owner, 6 Nov): nothing to pick again. A pick made here first is never replaced.
  useEffect(() => {
    let live = true;
    void Promise.resolve((rt.call as (cap: string, input: unknown) => Promise<unknown>)("engine.last_pick.get", {})).then((out) => {
      const last = out as { model?: string; provider?: string; effort?: string } | null | undefined;
      if (!live || !last?.model) return;
      setChoice((c) => (c.model || c.provider || c.accountRef ? c : { ...c, model: last.model!, modelTitle: prettyModel(last.model), ...(last.provider ? { provider: last.provider } : {}), ...(last.effort ? { effort: last.effort as NonNullable<NewChoice["effort"]> } : {}) }));
    }, () => undefined);
    return () => { live = false; };
  }, [rt]);
  const needs = useLive<NeedsOut>(rt.screens, "tasks.my-work", "needs", { limit: LANDING_NEEDS });
  const recent = useLive<RecentOut>(rt.screens, "chats.sidebar", "recent", { filter: "all" });
  const accounts = useAccounts(rt);
  const resume = useResume();
  // who it starts with is the one Add people and agents sheet; a chat that does not exist yet takes the picks, and the ones chat.start cannot take are applied once it does
  const [held, setHeld] = useState<readonly AccessPick[]>([]);
  const sheetDeps = useMemo(() => ({ call: rt.call as (cap: string, input: unknown) => Promise<unknown>, me: { id: rt.me.id, name: rt.me.name }, nameOf: p.nameOf, newKey: p.newKey, toast: p.say }), [rt.call, rt.me.id, rt.me.name, p.nameOf, p.newKey, p.say]);
  const sheet = useAddSheet(sheetDeps);
  const width = useWindowDimensions().width;
  const data = useMemo(() => ({ call: rt.call as (cap: string, input: unknown) => Promise<unknown> }), [rt.call]);
  const items: readonly NeedItem[] = needs.status === "ready" ? needs.data.items.slice(0, LANDING_NEEDS) : [];
  const total = needs.status === "ready" ? needs.data.total : 0;
  const working = workingChats(recent.status === "ready" ? recent.data : undefined);
  const firstDay = resume !== null && needs.status === "ready" && total === 0 && working.length === 0;
  const hasInbox = useInboxSources(rt.screens, rt.me.id);
  const mailRow = hasInbox === false ? <SetupLine key="mail" testID="landing-setup-mail" title="Email and calendar" sub="Gmail, Outlook or a number" done={false} open={() => rt.open({ screen: "settings.page", args: { page: "mail" } })} /> : null;

  const start = useCallback((payload: ComposerSend): Promise<void> => {
    const text = payload.text.trim();
    // files dropped, pasted or picked here go with the first message, the way the chat's own composer sends them
    const files = payload.files;
    const slash = text.startsWith("/") && files.length === 0;
    const words = (text || files[0]?.name || "").split(/\s+/).slice(0, 6).join(" ");
    return realAssistant(rt.assistant.id, (cap, input) => rt.call(cap as never, input as never)).then((assistantId) => {
      if (assistantId === null) throw new Error("no assistant yet");
      return rt.call("chat.start", {
      kind: "chat", ...startInput(picked, assistantId), ...(slash || words === "" ? {} : files.length > 0 ? { title: words } : { first: text, title: words }), ...(choice.model ? { model: choice.model } : {}), ...(choice.provider ? { provider: choice.provider } : {}), ...(choice.effort ? { effort: choice.effort } : {}), idempotencyKey: p.newKey(),
      });
    }).then(async (out) => {
      const id = (out as CapMap["chat.start"]["out"]).thread.threadId;
      if (choice.mode !== "auto") await rt.call("threads.set_mode", { threadId: id, mode: choice.mode });
      if (files.length > 0) await postWithFiles(uploadDeps(rt), id, text, files, `landing:${id}`).catch((e: unknown) => p.say(e instanceof Error && /too large|cannot be read|could not be saved/.test(e.message) ? e.message : "The chat started, but the files did not go. Add them in the chat."));
      const kept = held.filter((h) => (h.kind === "outside" || h.kind === "new" || h.kind === "guest") || picked.some((w) => w.id === h.id));
      if (kept.length > 0) await runAfterStart(sheetDeps, id, kept);
      if (slash) p.fill(text);
      p.openChat(id);
    }).catch((e: unknown) => { throw new Error(startFailure(e)); });
  }, [picked, choice, rt, p, held, sheetDeps]);

  const withSheet = (): void => sheet.pick({
    name: "this new chat",
    onPicks: (picks) => {
      setHeld((cur) => [...cur.filter((c) => !picks.some((n) => n.key === c.key)), ...picks]);
      const entries = picks.flatMap((q): WithEntry[] => (q.kind === "agent" ? [{ id: q.id, name: q.name, kind: q.assistant === true || isAssistant(rt, q.id) ? "assistant" : "agent" }] : q.kind === "person" ? [{ id: q.id, name: q.name, kind: "person" }] : []));
      if (entries.length > 0) setPicked((cur) => [...cur.filter((c) => (c.kind !== "assistant" || entries.some((e) => e.kind === "person")) && !entries.some((e) => e.id === c.id)), ...entries]);
    },
  });
  const extras = held.filter((h) => h.kind === "outside" || h.kind === "new" || h.kind === "guest");

  const lead = picked.find((w) => w.kind !== "person") ?? you;
  const strip = newChatStrip(lead, choice, accounts ?? []);

  return (
    <ScrollView testID="chats-landing" style={st.root} contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
      <View style={[st.column, width < 720 ? st.columnNarrow : null]}>
        <View style={st.hero}>
          <WorkingMark state="thinking" size={44} testID="landing-mark" />
          <Text accessibilityRole="header" aria-level={1} testID="landing-title" style={st.title}>What are we working on?</Text>
        </View>
        <View style={st.composer}><Composer
          testID="composer" label="Start a new chat" whoWillAnswer={`${lead.name} will answer`} placeholder="Describe it, or type /"
          agents={[strip]} lead={lead.name} mode={choice.mode} onMode={(mode: ChatMode) => setChoice((c) => ({ ...c, mode }))}
          lists={{ commands: commandItems(undefined) }} agentChat
          renderPanel={(agent, close, narrow) => <NewChatBrain data={data} agent={agent} accounts={accounts} choice={choice} onChoice={setChoice} close={close} narrow={narrow} />}
          panelBelow onSubmit={start} onInterrupt={start}
        /></View>
        <View testID="landing-with" style={st.with}>
          <Text style={st.withWord}>With</Text>
          {each(picked, (w) => (
            <Pressable key={w.id} role="button" aria-label={`Remove ${w.name}`} testID={`with-${w.id}`} onPress={() => setPicked((cur) => (cur.length === 1 ? [you] : cur.filter((c) => c.id !== w.id)))} style={st.chip}>
              <Avatar {...avatarOf({ id: w.id, name: w.name, kind: w.kind })} size={18} />
              <Text numberOfLines={1} style={st.chipText}>{w.kind === "person" ? w.name.split(/\s+/)[0] : w.name}</Text>
            </Pressable>
          ))}
          {each(extras, (h) => (
            <Pressable key={h.key} role="button" aria-label={`Remove ${h.name}`} testID={`with-${h.key}`} onPress={() => setHeld((cur) => cur.filter((c) => c.key !== h.key))} style={st.chip}>
              <Avatar name={h.name} seedId={h.id} kind={h.kind === "guest" ? "person" : "agent"} size={18} />
              <Text numberOfLines={1} style={st.chipText}>{h.kind === "guest" ? h.name : h.name.split(/\s+/)[0]}</Text>
            </Pressable>
          ))}
          <Pressable role="button" aria-label="Add people and agents" testID="with-add" style={st.add} onPress={withSheet}>
            <Glyph name="plus" size={13} />
          </Pressable>
        </View>
        <View testID="landing-below" style={st.below}>
          {firstDay ? <SetupRows extra={mailRow} render={(row, open) => <SetupLine key={row.key} testID={`landing-setup-${row.key}`} title={row.title} sub={setupNote(row)} done={row.state === "done"} open={open} />} more={(count, open) => <Pressable key="more" role="button" testID="landing-setup-more" onPress={open} style={st.more}><Text style={st.moreText}>{`${count} more to set up`}</Text></Pressable>} /> : (
            <>
              {each(items, (n) => <NeedRow key={n.task.id} item={n} {...p} />)}
              {moreLine(total, items.length) ? <Pressable role="button" testID="landing-more" onPress={p.openTasks} style={st.more}><Text style={st.moreText}>{moreLine(total, items.length)}</Text></Pressable> : null}
            </>
          )}
          {firstDay ? null : <GoalsNow call={rt.call as (cap: string, input: unknown) => Promise<unknown>} changes={rt.changes} now={rt.clock().now} offsetMin={rt.clock().offsetMin} me={rt.me.id} nameOf={p.nameOf} openGoal={(id) => rt.open({ subject: { type: "goal", id } })} testID="landing-goals" />}
          {each(working, (w) => (
            <Pressable key={w.threadId} role="button" testID={`landing-working-${w.threadId}`} aria-label={workingLine(w)} onPress={() => p.openChat(w.threadId)} style={({ hovered }: { hovered?: boolean }) => [st.work, hovered === true && st.hover]}>
              <View style={st.workFaces}>
                {each(w.agents.slice(0, 5), (id) => <Avatar key={id} name={p.nameOf(id)} seedId={id} kind="agent" size={20} state="working" />)}
              </View>
              <Text numberOfLines={1} style={st.workText}>{workingLine(w)}</Text>
            </Pressable>
          ))}
        </View>
        {p.list ? <View testID="landing-list" style={st.list}>{p.list}</View> : null}
      </View>
      {sheet.element}
    </ScrollView>
  );
}

/** One thing that needs you: who asks, what, and the one action. Open waits on hover. */
function NeedRow({ item, rt, nameOf, kindOf, openNeed, openProfile, say }: { item: NeedItem } & LandingProps): ReactElement {
  const row = needsRow(item, nameOf);
  const [over, setOver] = useState(false);
  const act = (): void => {
    if (!row.inline) { openNeed(row.id); return; }
    void Promise.resolve(rt.call("tasks.act", { taskId: row.id, action: row.actionKey })).then(() => say(`${row.actionLabel} · ${row.title}`), () => say("Could not do that. Try again."));
  };
  const kind = kindOf(row.requester);
  return (
    <View testID={`landing-need-${row.id}`} style={[st.need, over && st.hover]} {...sq("row")} {...{ onMouseEnter: () => setOver(true), onMouseLeave: () => setOver(false) }}>
      <Pressable role="button" aria-label={`${nameOf(row.requester)}'s profile`} testID={`landing-face-${row.id}`} onPress={() => openProfile(row.requester)}>
        <Avatar {...avatarOf({ id: row.requester, name: nameOf(row.requester), kind })} size={28} state="waiting" />
      </Pressable>
      <Pressable role="button" aria-label={row.title} onPress={() => openNeed(row.id)} style={st.needText}>
        <Text numberOfLines={1} style={st.needTitle}>{row.title}</Text>
        <Text numberOfLines={1} style={st.needSub}>{[row.kind, nameOf(row.requester), row.sub].filter(Boolean).join(" · ")}</Text>
      </Pressable>
      <View style={st.needActs}>
        {over ? <Pressable role="button" testID={`landing-open-${row.id}`} onPress={() => openNeed(row.id)} style={st.quietBtn} {...sq("row")}><Text style={st.quietText}>Open</Text></Pressable> : null}
        <Pressable role="button" testID={`landing-act-${row.id}`} onPress={act} style={st.primary} {...sq("row")}><Text style={st.primaryText}>{row.actionLabel}</Text></Pressable>
      </View>
    </View>
  );
}

function SetupLine({ title, sub, done, open, testID }: { title: string; sub?: string | undefined; done: boolean; open: () => void; testID?: string }): ReactElement {
  return (
    <Pressable role="button" aria-label={title} {...(testID ? { testID } : {})} onPress={open} style={({ hovered }: { hovered?: boolean }) => [st.need, hovered === true && st.hover]}>
      <View style={[st.check, done && st.checkOn]}>{done ? <Glyph name="check" size={11} color="var(--accent-ink)" /> : null}</View>
      <View style={st.needText}>
        <Text numberOfLines={1} style={st.needTitle}>{title}</Text>
        {sub ? <Text numberOfLines={1} style={st.needSub}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  content: { flexGrow: 1, alignItems: "center", paddingTop: 64, paddingBottom: 40, paddingHorizontal: 16 },
  column: { width: "100%", maxWidth: 620 },
  columnNarrow: { maxWidth: 560 },
  hero: { alignItems: "center", marginBottom: 34 },
  title: { marginTop: 18, fontSize: 25, lineHeight: 32, fontWeight: "600", letterSpacing: -0.4, color: "var(--ink)" as string, textAlign: "center" },
  composer: { zIndex: 10 },
  list: { height: 520, marginTop: 18, marginHorizontal: -8 },
  with: { flexDirection: "row", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 6, marginTop: 12 },
  withWord: { fontSize: 13, color: "var(--ink-3)" as string, marginRight: 2 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 30, paddingLeft: 6, paddingRight: 10, borderRadius: 15, backgroundColor: "var(--sunk)" as string, maxWidth: 160 },
  chipText: { fontSize: 13, color: "var(--ink-2)" as string, flexShrink: 1 },
  add: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", boxShadow: "inset 0 0 0 1.2px var(--line-2)" } as object,
  below: { marginTop: 22 },
  need: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 50, paddingVertical: 8, paddingHorizontal: 10, marginHorizontal: -10, borderRadius: 13 },
  hover: { backgroundColor: "var(--hover)" as string },
  needText: { flex: 1, minWidth: 0, gap: 1 },
  needTitle: { fontSize: 14.5, lineHeight: 20, color: "var(--ink)" as string },
  needSub: { fontSize: 12.5, lineHeight: 17, color: "var(--ink-3)" as string },
  needActs: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 },
  primary: { height: 30, paddingHorizontal: 13, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "var(--accent)" as string },
  primaryText: { fontSize: 13, fontWeight: "600", color: "var(--accent-ink)" as string },
  quietBtn: { height: 30, paddingHorizontal: 9, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  quietText: { fontSize: 13, fontWeight: "500", color: "var(--ink-3)" as string },
  more: { paddingVertical: 8 },
  moreText: { fontSize: 12, color: "var(--ink-3)" as string },
  work: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, paddingVertical: 6, paddingHorizontal: 10, marginHorizontal: -10, borderRadius: 12 },
  workFaces: { flexDirection: "row", gap: 5 },
  workText: { flexShrink: 1, fontSize: 13, color: "var(--ink-3)" as string },
  check: { width: 20, height: 20, marginHorizontal: 4, borderRadius: 10, alignItems: "center", justifyContent: "center", boxShadow: "inset 0 0 0 1.5px var(--line-2)" } as object,
  checkOn: { backgroundColor: "var(--accent)" as string, boxShadow: "none" } as object,
});
