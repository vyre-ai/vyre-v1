// The first screen is a new chat (no Home): the mark and "What are we working on?", the composer, who it starts with, then what needs you (top 3, "N more in Tasks") and what is running. Start typing or
// answer something without going anywhere. With nothing waiting it shows only the composer and what is running; on a first day the setup checklist takes the list's place. Home's Needs you model and actions are
// reused as they are, so a thing decided here is decided everywhere.
import { useCallback, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Avatar, avatarOf } from "../../../../../../ui/src/Avatar/index.tsx";
import type { ComposerSend } from "../../../../../../ui/src/Composer/index.tsx";
import type { ChatMode } from "../../../../../../ui/src/Composer/brain.ts";
import { DeferredComposer as Composer } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { WorkingMark } from "../../../../../../ui/src/WorkingMark/index.tsx";
import { sq } from "../../../../../../ui/src/SidePane/host.tsx";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useResume } from "../../../onboarding/resume-context.ts";
import { SetupRows } from "../../../onboarding/SetupRows.tsx";
import { needsRow } from "../../home/sections-a/model.ts";
import { useAccounts } from "../conversation/brain.tsx";
import { NewChatBrain, newChatStrip } from "../conversation/new-chat-brain.tsx";
import type { NewChoice } from "../conversation/new-chat-brain.tsx";
import { commandItems } from "../conversation/commands.ts";
import { each } from "../../../shell/sidebar/model.ts";
import { Glyph } from "../sidebar/parts.tsx";
import { useLive } from "../mounts/live.ts";
import { LANDING_NEEDS, moreLine, startInput, workingChats, workingLine } from "./model.ts";
import type { NeedItem, NeedsOut, RecentOut, WithEntry } from "./model.ts";

export interface LandingProps {
  rt: ShellRuntime;
  nameOf(id: string): string;
  kindOf(id: string): "agent" | "person";
  /** Everyone who can be asked into the chat. */
  agents: readonly { id: string; name: string }[];
  people: readonly { id: string; name: string }[];
  openChat(threadId: string): void;
  openTasks(): void;
  openNeed(taskId: string): void;
  openProfile(id: string): void;
  /** A slash command needs a chat: the chat starts and the words wait in its composer. */
  fill(text: string): void;
  newKey(): string;
  say(text: string): void;
}

const isAssistant = (rt: ShellRuntime, id: string): boolean => id === rt.assistant.id;

export function Landing(p: LandingProps): ReactElement {
  const { rt } = p;
  const you: WithEntry = useMemo(() => ({ id: rt.assistant.id, name: "Assistant", kind: "assistant" }), [rt.assistant.id]);
  const [picked, setPicked] = useState<readonly WithEntry[]>([you]);
  const [choice, setChoice] = useState<NewChoice>({ mode: "auto" });
  const needs = useLive<NeedsOut>(rt.screens, "home.needs-you-top3", "items", { limit: LANDING_NEEDS });
  const recent = useLive<RecentOut>(rt.screens, "chats.sidebar", "recent", { filter: "all" });
  const accounts = useAccounts(rt);
  const resume = useResume();
  const menu = useMenu();
  const width = useWindowDimensions().width;
  const data = useMemo(() => ({ call: rt.call as (cap: string, input: unknown) => Promise<unknown> }), [rt.call]);
  const items: readonly NeedItem[] = needs.status === "ready" ? needs.data.items.slice(0, LANDING_NEEDS) : [];
  const total = needs.status === "ready" ? needs.data.total : 0;
  const working = workingChats(recent.status === "ready" ? recent.data : undefined);
  const firstDay = resume !== null && needs.status === "ready" && total === 0 && working.length === 0;

  const start = useCallback((payload: ComposerSend): void => {
    const text = payload.text.trim();
    const slash = text.startsWith("/");
    const who = startInput(picked, rt.assistant.id);
    const words = text.split(/\s+/).slice(0, 6).join(" ");
    void Promise.resolve(rt.call("chat.start", {
      kind: "chat", ...who, ...(slash || text === "" ? {} : { first: text, title: words }), ...(choice.model ? { model: choice.model } : {}), ...(choice.provider ? { provider: choice.provider } : {}), ...(choice.effort ? { effort: choice.effort } : {}), idempotencyKey: p.newKey(),
    })).then(async (out) => {
      const id = (out as CapMap["chat.start"]["out"]).thread.threadId;
      if (choice.mode !== "auto") await rt.call("threads.set_mode", { threadId: id, mode: choice.mode });
      if (slash) p.fill(text);
      p.openChat(id);
    }, () => p.say("Could not start the chat. Try again."));
  }, [picked, choice, rt, p]);

  const withMenu = (x: number, y: number): void => {
    const free = <T extends { id: string }>(l: readonly T[]): T[] => l.filter((a) => !picked.some((w) => w.id === a.id) && a.id !== rt.me.id);
    const add = (w: WithEntry): void => setPicked((cur) => [...cur.filter((c) => c.kind !== "assistant" || w.kind === "person"), w]);
    const entries: MenuEntry[] = [
      { head: "Agents" },
      ...free([{ id: rt.assistant.id, name: "Assistant" }, ...p.agents.filter((a) => !isAssistant(rt, a.id))]).map((a): MenuEntry => ({ label: a.name, onSelect: () => add({ id: a.id, name: a.name, kind: isAssistant(rt, a.id) ? "assistant" : "agent" }) })),
      ...(p.people.length > 0 ? [{ head: "People" } as MenuEntry] : []),
      ...free(p.people).map((a): MenuEntry => ({ label: a.name, onSelect: () => add({ id: a.id, name: a.name, kind: "person" }) })),
    ];
    menu.show(entries, x, y, "other", { label: "Add to this chat" });
  };

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
              <Text numberOfLines={1} style={st.chipText}>{w.name.split(/\s+/)[0]}</Text>
            </Pressable>
          ))}
          <Pressable
            role="button" aria-label="Add someone to this chat" testID="with-add" style={st.add}
            onPress={(e) => { const box = (e as unknown as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } }).currentTarget?.getBoundingClientRect?.(); withMenu(box?.left ?? 0, (box?.bottom ?? 0) + 6); }}
          >
            <Glyph name="plus" size={13} />
          </Pressable>
        </View>
        <View testID="landing-below" style={st.below}>
          {firstDay ? <SetupRows render={(row, open) => <SetupLine key={row.key} title={row.title} sub={row.note} done={row.state === "done"} open={open} />} /> : (
            <>
              {each(items, (n) => <NeedRow key={n.task.id} item={n} {...p} />)}
              {moreLine(total, items.length) ? <Pressable role="button" testID="landing-more" onPress={p.openTasks} style={st.more}><Text style={st.moreText}>{moreLine(total, items.length)}</Text></Pressable> : null}
            </>
          )}
          {each(working, (w) => (
            <Pressable key={w.threadId} role="button" testID={`landing-working-${w.threadId}`} aria-label={workingLine(w)} onPress={() => p.openChat(w.threadId)} style={({ hovered }: { hovered?: boolean }) => [st.work, hovered === true && st.hover]}>
              <View style={st.workFaces}>
                {each(w.agents.slice(0, 5), (id) => <Avatar key={id} name={p.nameOf(id)} seedId={id} kind="agent" size={20} state="working" />)}
              </View>
              <Text numberOfLines={1} style={st.workText}>{workingLine(w)}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {menu.element}
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

function SetupLine({ title, sub, done, open }: { title: string; sub?: string | undefined; done: boolean; open: () => void }): ReactElement {
  return (
    <Pressable role="button" aria-label={title} onPress={open} style={({ hovered }: { hovered?: boolean }) => [st.need, hovered === true && st.hover]}>
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
