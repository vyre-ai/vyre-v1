// Right pane > Hooks (lane l-hooks, the approved prototype p-crew): the rules in this chat, grouped by where they come from (this chat, this run and its helpers, the agent everywhere, yours, the Space).
// Each card says when, what it does, who made it and when it last ran, with Pause, Edit (Run a script, Ask a quick check, Do an action) and Remove, which Undo takes back. A Space hook is removed by an admin only.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { PaneDeps } from "./actions.ts";
import { hookPause, hookRemove, hookSave } from "./actions.ts";
import { PANE_SCREEN } from "./ThreadsTab.tsx";
import { agoLabel } from "./model.ts";
import { usePaneData, useScreenQuery } from "./data.tsx";
import { EVENT_ORDER, EVENT_WORDS, KIND_ORDER, KIND_WORDS, canRemoveNote, countLine, draftOf, grouped, kindWord, lastRan, madeBy, restoreInput, setInput, whatOf } from "./hooks-model.ts";
import type { Draft, Hook, HookKind, HookRun } from "./hooks-model.ts";
import { PaneList, TextButton } from "./parts.tsx";
import type { Entry } from "./parts.tsx";

type HooksOut = CapMap["hooks.list"]["out"];
type RunsOut = { runs: HookRun[] };

export function HookCard({ h, threadId, deps, selected, nameOf, ran, startEditing = false, onSaved }: { h: Hook; threadId: string; deps: PaneDeps; selected: boolean; nameOf: (id: string) => string; /** The line "Ran 2 min ago · stopped files_tree" */ ran: string; startEditing?: boolean; onSaved?: () => void }): ReactElement {
  const [edit, setEdit] = useState(startEditing);
  const [draft, setDraft] = useState<Draft>(() => draftOf(h));
  const save = (): void => {
    const input = setInput(h, draft, threadId);
    if (!input) { deps.note("Say what the hook does first."); return; }
    void hookSave(deps, input).then((ok) => { if (ok) { setEdit(false); onSaved?.(); } });
  };
  return (
    <View testID={`hook-${h.id}`} style={[s.card, h.paused && s.off, selected && s.sel]}>
      <Text style={s.when}>{EVENT_WORDS[h.event] ?? h.event}{h.matcher && h.matcher !== "*" ? ` ${h.matcher}` : ""}</Text>
      {edit ? (
        <View testID={`hook-form-${h.id}`} style={s.form}>
          <Text style={s.label}>When</Text>
          {/* ui-rows-lint: not a list (a chip choice of when the hook runs) */}
          <View style={s.chips}>{EVENT_ORDER.map((e) => <Chip key={e} text={EVENT_WORDS[e]!} on={draft.event === e} id={`hook-event-${h.id}-${e}`} onPress={() => setDraft({ ...draft, event: e })} />)}</View>
          <Text style={s.label}>What it does</Text>
          {/* ui-rows-lint: not a list (a chip choice of what the hook does) */}
          <View style={s.chips}>{KIND_ORDER.map((k) => <Chip key={k} text={KIND_WORDS[k]} on={draft.kind === k} id={`hook-kind-${h.id}-${k}`} onPress={() => setDraft({ ...draft, kind: k as HookKind })} />)}</View>
          <TextInput testID={`hook-what-${h.id}`} accessibilityLabel="What it does" value={draft.what} onChangeText={(what) => setDraft({ ...draft, what })} style={s.input} multiline />
          <View style={s.acts}>
            <TextButton label="Save" primary onPress={save} testID={`hook-save-${h.id}`} />
            <TextButton label="Cancel" onPress={() => { setDraft(draftOf(h)); setEdit(false); }} testID={`hook-cancel-${h.id}`} />
          </View>
        </View>
      ) : (
        <>
          <Text style={s.what}><Text style={s.kind}>{kindWord(h)}</Text>{"  "}{whatOf(h)}</Text>
          <Text testID={`hook-meta-${h.id}`} style={s.meta}>Made by {madeBy(h, nameOf)} · <Text testID={`hook-ran-${h.id}`}>{ran}</Text>{h.paused ? " · Paused" : ""}</Text>
          <View style={s.acts}>
            <TextButton label={h.paused ? "Resume" : "Pause"} onPress={() => { void hookPause(deps, h.id, threadId, !h.paused); }} testID={`hook-pause-${h.id}`} />
            {h.canChange ? <TextButton label="Edit" onPress={() => setEdit(true)} testID={`hook-edit-${h.id}`} /> : null}
            {h.canChange ? <TextButton label="Remove" onPress={() => { void hookRemove(deps, h.id, threadId, restoreInput(h, threadId)); }} testID={`hook-remove-${h.id}`} /> : <Text testID={`hook-locked-${h.id}`} style={s.locked}>{canRemoveNote}</Text>}
          </View>
        </>
      )}
    </View>
  );
}

function Chip({ text, on, id, onPress }: { text: string; on: boolean; id: string; onPress: () => void }): ReactElement {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} testID={id} onPress={onPress} style={[s.chip, on && s.chipOn]}><Text style={[s.chipText, on && s.chipTextOn]}>{text}</Text></Pressable>;
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
  const entries: Entry[] = [{ key: "count", type: "label", text: "Hooks", right: countLine(hooks) }];
  if (hooks.length === 0) entries.push({ key: "none", type: "empty", text: `No hooks here. ${data.agent.name} can add its own when you ask.`, testID: "hooks-empty" });
  for (const g of grouped(hooks, data.agent.name)) {
    entries.push({ key: `l-${g.key}`, type: "label", text: g.title, right: String(g.hooks.length) });
    for (const h of g.hooks) entries.push({ key: h.id, type: "block", node: <HookCard key={h.id} h={h} threadId={data.threadId} deps={deps} selected={selected === h.id} nameOf={nameOf} ran={lastRan(h.id, runs, (ts) => agoLabel(ts, clock))} /> });
  }
  entries.push({ key: "foot", type: "block", node: <Text key="foot" testID="hooks-foot" style={s.foot}>{agentsOn ? `${data.agent.name} can add its own hooks. A Space admin turns that on or off in Console, Agents, Hooks.` : "Hooks made by agents are off in this Space. A Space admin can turn them on in Console, Agents, Hooks."}</Text> });
  return <PaneList entries={entries} plain {...(window ? { window } : {})} testID="hooks-list" />;
}

const s = StyleSheet.create({
  card: { marginHorizontal: 10, marginBottom: 8, padding: 11, borderRadius: 12, backgroundColor: "var(--raised)" as string, boxShadow: "inset 0 0 0 1px var(--line)" } as object,
  off: { opacity: 0.6 },
  sel: { boxShadow: "inset 0 0 0 2px var(--accent)" } as object,
  when: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  what: { marginTop: 4, fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string },
  kind: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  meta: { marginTop: 4, fontSize: 12, color: "var(--ink-3)" as string },
  acts: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 8 },
  locked: { fontSize: 12, color: "var(--ink-3)" as string },
  form: { marginTop: 6 },
  label: { marginTop: 6, fontSize: 11.5, color: "var(--ink-3)" as string },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  chip: { paddingHorizontal: 10, height: 26, justifyContent: "center", borderRadius: 13, boxShadow: "inset 0 0 0 1px var(--line)" } as object,
  chipOn: { backgroundColor: "var(--accent)" as string },
  chipText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  chipTextOn: { color: "var(--accent-ink)" as string },
  input: { marginTop: 6, minHeight: 36, padding: 8, borderRadius: 9, fontSize: 13.5, color: "var(--ink)" as string, backgroundColor: "var(--sunk)" as string },
  foot: { margin: 12, fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
});
