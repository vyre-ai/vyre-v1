// Right pane > Routines (spec 3.2, 2.6): each routine with its schedule, its next run or Paused, and an on/off switch. Click opens it: what it does, when, where results go,
// the last run. Change by Asking fills the chat composer (routines are made by asking the agent); Edit Instructions saves a new version; Rename, Duplicate (paused) and Delete
// with an inline confirm and Undo. Three sentence starters begin a new one. The row's menu and the ... button give the same entries.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { addMenu } from "../../../../../../ui/src/ShareSheet/index.tsx";
import { delegateRoutine, deleteRoutine, duplicateRoutine, renameRoutine, runNow, saveInstructions, setRoutine } from "./actions.ts";
import type { PaneDeps } from "./actions.ts";
import { usePaneData, useScreenQuery } from "./data.tsx";
import { ROUTINE_STARTS, changeByAsking, cronWords, isWatcher, lastRunLine, nextLabel, routineFile, routineNote, routinesOn, sortRoutines } from "./model.ts";
import type { Routine } from "./model.ts";
import { Face, LeadIcon, PaneList, Switch, TextButton, Tool } from "./parts.tsx";
import type { Entry } from "./parts.tsx";

type RoutinesOut = CapMap["agents.routines.list"]["out"];

export const ROUTINES_SCREEN = "chats.agent-page";

type Mode = "view" | "rename" | "instructions" | "delete" | "delegate";

/** `initial` opens one routine in a given mode (tests and screenshots); the pane starts on the list. */
export function RoutinesTab({ deps, window, initial }: { deps: PaneDeps; window?: VirtualWindow; initial?: { routineId: string; mode?: Mode } }): ReactElement {
  const data = usePaneData();
  const menu = useMenu();
  const [openId, setOpenId] = useState<string | null>(initial?.routineId ?? null);
  const [mode, setMode] = useState<Mode>(initial?.mode ?? "view");
  const [running, setRunning] = useState<readonly string[]>([]);
  const [draft, setDraft] = useState("");
  const agentId = data.agent.agentId;
  const name = data.agent.name;
  const clock = data.clock();
  const q = useScreenQuery<RoutinesOut>(ROUTINES_SCREEN, "routines", { agentId });

  if (q.status === "loading") {
    return <View testID="routines-loading" accessibilityLabel="Loading" style={st.sk}><View style={st.skBar} /><View style={[st.skBar, { width: "65%" }]} /><View style={st.skBar} /></View>;
  }
  const routines = sortRoutines(q.data.routines);
  const current: Routine | undefined = openId === null ? undefined : routines.find((r) => r.routineId === openId);

  const run = (r: Routine): void => {
    if (running.includes(r.routineId)) return;
    setRunning((x) => [...x, r.routineId]);
    void runNow(deps, r).then(() => setRunning((x) => x.filter((id) => id !== r.routineId)));
  };
  const personName = (id: string): string => data.people?.find((p) => p.id === id)?.name ?? id;

  const menuFor = (r: Routine): MenuEntry[] => [
    { label: "Open", onSelect: () => { setOpenId(r.routineId); setMode("view"); } },
    { label: "Open Prompt File", onSelect: () => data.nav.openRoutineFile(agentId, r.title) },
    { label: "Run Now", onSelect: () => run(r) },
    { label: r.enabled ? "Pause" : "Resume", onSelect: () => void setRoutine(deps, r, !r.enabled) },
    { separator: true },
    { label: "Change by Asking…", onSelect: () => data.nav.fillComposer(changeByAsking(r.title)) },
    { label: "Edit Instructions", onSelect: () => { setOpenId(r.routineId); setMode("instructions"); setDraft(r.prompt); } },
    { label: "Rename", onSelect: () => { setOpenId(r.routineId); setMode("rename"); setDraft(r.title); } },
    { label: "Duplicate", onSelect: () => void duplicateRoutine(deps, r) },
    { label: "Delegate…", onSelect: () => { setOpenId(r.routineId); setMode("delegate"); } },
    { separator: true },
    { label: "Delete Routine…", danger: true, onSelect: () => { setOpenId(r.routineId); setMode("delete"); } },
  ];

  if (current) {
    const r = current;
    const entries: Entry[] = [
      { key: "back", type: "row", title: "Routines", leading: <LeadIcon name="back" />, onPress: () => { setOpenId(null); setMode("view"); }, testID: "routine-back" },
      {
        key: "top", type: "block",
        node: (
          <View testID="routine-top" style={st.top}>
            <View style={st.topText}>
              {mode === "rename" ? (
                <View style={st.row}>
                  <TextInput accessibilityLabel="Routine name" value={draft} onChangeText={setDraft} style={st.input} autoFocus />
                  <TextButton label="Save" primary onPress={() => void renameRoutine(deps, r, draft).then((ok) => { if (ok) setMode("view"); })} testID="routine-rename-save" />
                  <TextButton label="Cancel" onPress={() => setMode("view")} />
                </View>
              ) : <Text style={st.title}>{r.title}</Text>}
              <Text style={st.sub}>{routineNote(r, clock)}</Text>
            </View>
            <Switch on={r.enabled} label="Routine on" onPress={() => void setRoutine(deps, r, !r.enabled)} testID="routine-switch" />
          </View>
        ),
      },
      {
        key: "acts", type: "block",
        node: (
          <View style={st.acts}>
            <TextButton label={running.includes(r.routineId) ? "Running…" : "Run Now"} disabled={running.includes(r.routineId)} onPress={() => run(r)} testID="routine-run" />
            <TextButton label="Change by Asking" onPress={() => data.nav.fillComposer(changeByAsking(r.title))} testID="routine-ask" />
            <View style={{ flex: 1 }} />
            <Tool icon="more" label="More" onPress={(x, y) => menu.show(menuFor(r), x, y, "other")} testID="routine-more" />
          </View>
        ),
      },
    ];
    if (mode === "delete") {
      entries.push({
        key: "confirm", type: "block",
        node: (
          <View testID="routine-confirm" style={st.confirm}>
            <Text style={st.confirmHead}>{`Delete “${r.title}”?`}</Text>
            <Text style={st.hint}>It stops running. Its run history stays in the audit log.</Text>
            <View style={st.row}>
              <TextButton label="Delete Routine" primary onPress={() => void deleteRoutine(deps, r).then((ok) => { if (ok) { setOpenId(null); setMode("view"); } })} testID="routine-delete" />
              <TextButton label="Cancel" onPress={() => setMode("view")} testID="routine-delete-cancel" />
            </View>
          </View>
        ),
      });
    }
    if (mode === "delegate") {
      // The shared people picker (ui/ShareSheet's Add menu): People, Groups, Roles, Agents. Only people can own a routine, so only people are offered, and not the owner.
      const others = (data.people ?? []).filter((p) => p.id !== r.ownerId);
      const picks = addMenu({ people: others }, [], (subject, name) => { void delegateRoutine(deps, r, subject.id, name).then((ok) => { if (ok) setMode("view"); }); });
      entries.push({ key: "l-delegate", type: "label", text: "Give this routine to" });
      if (picks.length === 0) entries.push({ key: "no-people", type: "empty", text: data.people === undefined ? "The directory is still loading." : "There is nobody else in this Space.", testID: "delegate-empty" });
      let at = 0;
      for (const m of picks) {
        if (!("label" in m)) continue;
        const who = others[at++];
        entries.push({ key: `who-${who?.id ?? at}`, type: "row", title: m.label, ...(who?.sub ? { note: who.sub } : {}), leading: <Face name={m.label} size={20} />, ...(m.onSelect ? { onPress: m.onSelect } : {}), testID: `delegate-${who?.id ?? at}` });
      }
      entries.push({ key: "delegate-cancel", type: "block", node: <View style={st.acts}><TextButton label="Cancel" onPress={() => setMode("view")} testID="delegate-cancel" /></View> });
    }
    entries.push({ key: "l-does", type: "label", text: "What it does", right: routineFile(r.title) });
    entries.push({
      key: "does", type: "block",
      node: mode === "instructions" ? (
        <View testID="routine-edit" style={st.block}>
          <TextInput accessibilityLabel="Instructions" value={draft} onChangeText={setDraft} multiline style={[st.input, { minHeight: 90 }]} />
          <View style={st.row}>
            <TextButton label="Save" primary onPress={() => void saveInstructions(deps, r, draft).then((ok) => { if (ok) setMode("view"); })} testID="routine-save" />
            <TextButton label="Cancel" onPress={() => setMode("view")} />
            <Text style={st.hint}>Saved as a new version; the old one is kept.</Text>
          </View>
        </View>
      ) : <View style={st.block}><Text testID="routine-prompt" style={st.prompt}>{r.prompt}</Text></View>,
    });
    entries.push({ key: "l-when", type: "label", text: "When" });
    entries.push({
      key: "when", type: "block",
      node: <View style={st.block}><Text style={st.kvVal}>{isWatcher(r) ? "On every new message in the channel" : cronWords(r.cron ?? "")}</Text><Text style={st.hint}>{r.enabled ? (r.nextRunAt !== undefined ? `Next: ${nextLabel(r.nextRunAt, clock)}` : "No run is scheduled") : "Paused. Turn it on to schedule the next run."}</Text></View>,
    });
    entries.push({ key: "l-details", type: "label", text: "Details" });
    entries.push({
      key: "details", type: "block",
      node: (
        <View testID="routine-details" style={st.kv}>
          <Text style={st.kvKey}>Results</Text><Text style={st.kvVal}>{r.channelId ? `Posted to a channel (${r.channelId})` : "In the agent's chat"}</Text>
          <Text style={st.kvKey}>Set by</Text><Text style={st.kvVal} testID="routine-owner">{personName(r.ownerId)}</Text>
          <Text style={st.kvKey}>Last run</Text><Text style={st.kvVal}>{lastRunLine(r, clock)}</Text>
        </View>
      ),
    });
    return <View style={st.fill}><PaneList entries={entries} {...(window ? { window } : {})} testID="routine-detail" />{menu.element}</View>;
  }

  const entries: Entry[] = [{ key: "l-routines", type: "label", text: "Routines", right: routines.length > 0 ? `${routinesOn(routines)} on` : "" }];
  if (routines.length === 0) entries.push({ key: "none", type: "empty", text: `${name} has no routines yet.`, testID: "routines-empty" });
  for (const r of routines) {
    entries.push({
      key: `r-${r.routineId}`, type: "row", title: r.title, note: routineNote(r, clock), leading: <LeadIcon name={isWatcher(r) ? "watch" : "clock"} color={r.enabled ? "var(--ink-3)" : "var(--ink-4)"} />, testID: `routine-${r.routineId}`,
      onPress: () => { setOpenId(r.routineId); setMode("view"); },
      trailing: (over) => (
        <View style={st.row}>
          {over ? <Tool icon="doc" label={`Open ${routineFile(r.title)}`} onPress={() => data.nav.openRoutineFile(agentId, r.title)} testID={`routine-file-${r.routineId}`} /> : null}
          <Switch on={r.enabled} label={`${r.title} on`} onPress={() => void setRoutine(deps, r, !r.enabled)} testID={`routine-switch-${r.routineId}`} />
        </View>
      ),
      menu: menuFor(r),
    });
  }
  entries.push({ key: "l-new", type: "label", text: "New routine" });
  for (const x of ROUTINE_STARTS) entries.push({ key: `s-${x}`, type: "row", title: `${x}…`, leading: <LeadIcon name="plus" />, onPress: () => data.nav.fillComposer(x), testID: `start-${routineSlugKey(x)}` });
  entries.push({ key: "new-note", type: "block", node: <View style={st.note}><Text style={st.hint}>{`Routines are made by asking ${name}. Pick a start and finish the sentence in the chat.`}</Text></View> });
  return <View style={st.fill}><PaneList entries={entries} {...(window ? { window } : {})} testID="routines-list" />{menu.element}</View>;
}

function routineSlugKey(x: string): string {
  return x.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const st = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
  sk: { padding: 8, gap: 12 },
  skBar: { height: 12, borderRadius: 6, backgroundColor: "var(--sunk)" as string },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  top: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, paddingTop: 8, paddingBottom: 4 },
  topText: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 14.5, fontWeight: "600", color: "var(--ink)" as string },
  sub: { fontSize: 12, color: "var(--ink-3)" as string },
  acts: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 4 },
  block: { paddingHorizontal: 8, gap: 6 },
  prompt: { fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string },
  hint: { fontSize: 11.5, lineHeight: 16, color: "var(--ink-3)" as string },
  note: { paddingHorizontal: 8, paddingTop: 6, paddingBottom: 10 },
  input: { flex: 1, minHeight: 30, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--raised)" as string, color: "var(--ink)" as string, fontSize: 13 },
  confirm: { marginHorizontal: 8, marginVertical: 4, padding: 10, gap: 6, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  confirmHead: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  kv: { paddingHorizontal: 8, gap: 2 },
  kvKey: { fontSize: 11.5, color: "var(--ink-3)" as string, marginTop: 6 },
  kvVal: { fontSize: 13, color: "var(--ink)" as string },
});
