// Right pane > Hooks (lane l-hooks, the approved prototype p-crew): the rules in this chat, grouped by where they come from (this chat, this run and its helpers, the agent everywhere, yours, the Space).
// Each card says when, what it does, who made it and when it last ran, with Pause, Edit (Run a script, Ask a quick check, Do an action) and Remove, which Undo takes back. A Space hook is removed by an admin only.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { PaneDeps } from "./actions.ts";
import { hookAllowRemove, hookPause, hookRemove, hookSave } from "./actions.ts";
import { PANE_SCREEN } from "./ThreadsTab.tsx";
import { agoLabel } from "./model.ts";
import { usePaneData, useScreenQuery } from "./data.tsx";
import { ACTION_CHOICES, ACTION_EVENTS, EVENT_ORDER, EVENT_WORDS, KIND_ORDER, KIND_WORDS, canRemoveNote, countLine, doOptions, eventWords, titleOf, draftOf, grouped, kindWord, lastRan, madeBy, restoreInput, setInput, whatOf } from "./hooks-model.ts";
import type { Draft, Hook, HookKind, HookRun } from "./hooks-model.ts";
import { Icon, PaneList, TextButton } from "./parts.tsx";
import type { Entry } from "./parts.tsx";

type HooksOut = CapMap["hooks.list"]["out"];
type RunsOut = { runs: HookRun[] };

export function HookCard({ h, threadId, deps, selected, nameOf, ran, agentName = "the assistant", startEditing = false, onSaved }: { h: Hook; threadId: string; deps: PaneDeps; selected: boolean; nameOf: (id: string) => string; /** The line "Ran 2 min ago · stopped files_tree" */ ran: string; /** For "When <name> finishes replying" */ agentName?: string; startEditing?: boolean; onSaved?: () => void }): ReactElement {
  const [edit, setEdit] = useState(startEditing);
  const [focus, setFocus] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(h));
  const save = (): void => {
    const input = setInput(h, draft, threadId);
    if (!input) { deps.note("Say what the hook does first."); return; }
    void hookSave(deps, input).then((ok) => { if (ok) { setEdit(false); onSaved?.(); } });
  };
  return (
    <View testID={`hook-${h.id}`} style={[s.card, h.paused && s.off, selected && s.sel]}>
      <Text testID={`hook-title-${h.id}`} style={s.when}>{titleOf(h)}</Text>
      {edit ? (
        <View testID={`hook-form-${h.id}`} style={s.form}>
          <Pick label="When" id={`hook-event-${h.id}`} value={draft.event} options={EVENT_ORDER.map((e) => ({ key: e, title: eventWords(e, agentName) }))} onChange={(event) => setDraft({ ...draft, event })} />
          {ACTION_EVENTS.has(draft.event) ? <Pick label="Only for" id={`hook-only-${h.id}`} value={draft.only} options={ACTION_CHOICES.map((c) => ({ key: c.key, title: c.title }))} onChange={(only) => setDraft({ ...draft, only })} /> : null}
          <Pick label="What it does" id={`hook-kind-${h.id}`} value={draft.kind} options={KIND_ORDER.map((k) => ({ key: k, title: KIND_WORDS[k] }))} onChange={(kind) => setDraft({ ...draft, kind: kind as HookKind, ...(kind === "action" && !/^[a-z]+\.[a-z_.]+$/.test(draft.what) ? { what: "chat.post" } : {}), ...(kind !== "action" && /^[a-z]+\.[a-z_.]+$/.test(draft.what) ? { what: "" } : {}) })} />
          {draft.kind === "action" ? <Pick label="Do this" id={`hook-do-${h.id}`} value={draft.what} options={doOptions(draft.what)} onChange={(what) => setDraft({ ...draft, what })} /> : null}
          {draft.kind !== "action" ? <TextInput testID={`hook-what-${h.id}`} accessibilityLabel="What it does" value={draft.what} onChangeText={(what) => setDraft({ ...draft, what })} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} style={[s.input, focus && s.inputFocus]} multiline /> : null}
          <View style={s.formActs}>
            <TextButton label="Save" primary onPress={save} testID={`hook-save-${h.id}`} />
            <TextButton label="Cancel" onPress={() => { setDraft(draftOf(h)); setEdit(false); }} testID={`hook-cancel-${h.id}`} />
          </View>
        </View>
      ) : (
        <>
          <Text style={s.what}><Text style={s.kind}>{kindWord(h)}</Text>{"  "}{whatOf(h)}</Text>
          <Text testID={`hook-meta-${h.id}`} style={s.meta}>Made by {madeBy(h, nameOf)} · <Text testID={`hook-ran-${h.id}`}>{ran}</Text>{h.paused ? " · Paused" : ""}</Text>
          {(h.allowed ?? []).map((r) => (
            <View key={r.id} testID={`hook-allowed-${r.id}`} style={s.allowed}>
              <Text style={s.allowedText}>Always allowed for {r.what}</Text>
              {h.canChange ? <TextButton label="Remove" onPress={() => { void hookAllowRemove(deps, r.id, r.what); }} testID={`hook-allowed-remove-${r.id}`} /> : null}
            </View>
          ))}
          <View style={s.acts}>
            <TextButton label={h.paused ? "Resume" : "Pause"} onPress={() => { void hookPause(deps, h.id, threadId, !h.paused); }} testID={`hook-pause-${h.id}`} />
            {h.canChange ? <TextButton label="Edit" onPress={() => setEdit(true)} testID={`hook-edit-${h.id}`} /> : null}
            {h.canChange ? <TextButton label="Remove" onPress={() => { void hookRemove(deps, h.id, threadId, restoreInput(h, threadId), titleOf(h)); }} testID={`hook-remove-${h.id}`} /> : <Text testID={`hook-locked-${h.id}`} style={s.locked}>{canRemoveNote}</Text>}
          </View>
        </>
      )}
    </View>
  );
}

/** A quiet picker for a short list: the label above, the choice below with a chevron, and a menu that opens under it (the same control as the Console sheet's When). Never a row of pills. */
export function entriesOf(options: ReadonlyArray<{ key: string; title: string }>, value: string, onChange: (key: string) => void): Array<{ label: string; checked: boolean; onSelect: () => void }> {
  return options.map((o) => ({ label: o.title, checked: o.key === value, onSelect: () => onChange(o.key) }));
}
function Pick({ label, id, value, options, onChange }: { label: string; id: string; value: string; options: ReadonlyArray<{ key: string; title: string }>; onChange: (key: string) => void }): ReactElement {
  const menu = useMenu();
  return (
    <View style={s.pick}>
      <Text style={s.label}>{label}</Text>
      <Pressable
        accessibilityRole="button" accessibilityLabel={label} testID={id}
        onPress={(event) => { const r = (event.currentTarget as unknown as { getBoundingClientRect?(): { left: number; bottom: number } })?.getBoundingClientRect?.(); menu.show(entriesOf(options, value, onChange), r?.left ?? 20, r?.bottom ?? 100, "other"); }}
        style={s.pickBtn}
      >
        <Text testID={`${id}-value`} numberOfLines={1} style={s.pickText}>{options.find((o) => o.key === value)?.title ?? "Choose…"}</Text>
        <Icon name="chev" size={11} color="var(--ink-3)" />
      </Pressable>
      {menu.element}
    </View>
  );
}

export function HooksTab({ deps, window, selected }: { deps: PaneDeps; window?: VirtualWindow; selected?: string | null }): ReactElement {
  const data = usePaneData();
  const q = useScreenQuery<HooksOut>(PANE_SCREEN, "hooks", { threadId: data.threadId });
  const runsQ = useScreenQuery<RunsOut>(PANE_SCREEN, "hookRuns", { threadId: data.threadId });
  const runs = runsQ.status === "ready" ? runsQ.data.runs : [];
  const clock = data.clock();
  const hooks = q.status === "ready" ? q.data.hooks : [];
  const agentsOn = q.status === "ready" ? q.data.agentHooks : true;
  // a real name wherever the shell knows it (the Space directory), else the agent's own; never "A person"
  const nameOf = (id: string): string => (id === data.agent.agentId ? data.agent.name : data.nameOf?.(id) ?? data.people?.find((p) => p.id === id)?.name ?? "Someone in this Space");
  const entries: Entry[] = [{ key: "head", type: "block", node: <View key="head" testID="hooks-head" style={s.head}><Text accessibilityRole="header" style={s.title}>Hooks</Text><Text testID="hooks-count" style={s.count}>{countLine(hooks)}</Text></View> }];
  if (hooks.length === 0) entries.push({ key: "none", type: "empty", text: `No hooks here. ${data.agent.name} can add its own when you ask.`, testID: "hooks-empty" });
  for (const g of grouped(hooks, data.agent.name)) {
    entries.push({ key: `l-${g.key}`, type: "label", text: g.title, right: String(g.hooks.length) });
    for (const h of g.hooks) entries.push({ key: h.id, type: "block", node: <HookCard key={h.id} h={h} threadId={data.threadId} deps={deps} selected={selected === h.id} nameOf={nameOf} ran={lastRan(h.id, runs, (ts) => agoLabel(ts, clock))} agentName={data.agent.name} /> });
  }
  entries.push({ key: "foot", type: "block", node: <Text key="foot" testID="hooks-foot" style={s.foot}>{agentsOn ? `${data.agent.name} can add its own hooks. A Space admin turns that on or off in Console, Agents, Hooks.` : "Hooks made by agents are off in this Space. A Space admin can turn them on in Console, Agents, Hooks."}</Text> });
  return <PaneList entries={entries} plain {...(window ? { window } : {})} testID="hooks-list" />;
}

const s = StyleSheet.create({
  card: { marginHorizontal: 10, marginBottom: 8, paddingVertical: 11, paddingHorizontal: 13, borderRadius: 13, backgroundColor: "var(--sunk)" as string },
  off: { opacity: 0.6 },
  sel: { boxShadow: "inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 40%, transparent)" } as object,
  head: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 8 },
  title: { fontSize: 17, fontWeight: "600", color: "var(--ink)" as string },
  count: { marginTop: 2, fontSize: 13, color: "var(--ink-3)" as string },
  when: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  what: { marginTop: 4, fontSize: 13.5, lineHeight: 19, color: "var(--ink-2)" as string },
  kind: { fontSize: 13.5, fontWeight: "500", color: "var(--ink)" as string },
  meta: { marginTop: 4, fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
  acts: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 2, marginTop: 8, marginHorizontal: -9, marginBottom: -4 },
  allowed: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 6 },
  allowedText: { flex: 1, fontSize: 12.5, lineHeight: 17, color: "var(--ink-3)" as string },
  locked: { fontSize: 12, marginLeft: 9, color: "var(--ink-4)" as string },
  form: { marginTop: 6 },
  label: { marginTop: 6, fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
  pick: { marginTop: 6 },
  pickBtn: { marginTop: 4, height: 34, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderRadius: 10, backgroundColor: "var(--raised)" as string, boxShadow: "inset 0 0 0 1px var(--line)" } as object,
  pickText: { flexShrink: 1, fontSize: 13.5, color: "var(--ink)" as string },
  input: { marginTop: 4, minHeight: 34, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 10, fontSize: 13.5, lineHeight: 19, color: "var(--ink)" as string, backgroundColor: "var(--raised)" as string, boxShadow: "inset 0 0 0 1px var(--line)" } as object,
  inputFocus: { boxShadow: "inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 60%, transparent)" } as object,
  formActs: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  foot: { margin: 12, fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
});
