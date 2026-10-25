// Agent page > Settings (spec 2.6): the agent's files with their line counts, changes it suggests to its own instructions, its model and account, limits, access and keys, the
// routines you set (with the label their posts carry), and Pause and Move to Trash. Every change shows what it did and, where it can be taken back, Undo.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { Icon, LeadIcon, PaneList, Switch, TextButton } from "../rightpane/parts.tsx";
import type { Entry } from "../rightpane/parts.tsx";
import { acceptSuggestion, dismissSuggestion, moveToTrash, pause, resume, setRoutine } from "./actions.ts";
import type { PageDeps } from "./actions.ts";
import { useAgentPageData, useScreenQuery } from "./data.tsx";
import { CAPTURE_WORDS, accountLine, instructionsLine, limitRows, lastRun, mineOnly, routineLabel, routineNote, suggestionTitle } from "./model.ts";
import type { AgentRow, Routine, Suggestion } from "./model.ts";

type ConfigOut = CapMap["agents.config.get"]["out"];
type RoutinesOut = CapMap["agents.routines.list"]["out"];
type SuggestionsOut = CapMap["agents.suggestions.list"]["out"];

export function SettingsTab({ agent, deps, window }: { agent: AgentRow; deps: PageDeps; window?: VirtualWindow }): ReactElement {
  const data = useAgentPageData();
  const agentId = data.agent.agentId;
  const config = useScreenQuery<ConfigOut>("config", { agentId });
  const routinesQ = useScreenQuery<RoutinesOut>("routines", { agentId });
  const sugQ = useScreenQuery<SuggestionsOut>("suggestions", { agentId });
  const [trash, setTrash] = useState(false);
  const clock = data.clock();
  const name = data.agent.name;
  const entries: Entry[] = [];

  /* ---- instructions */
  entries.push({ key: "l-files", type: "label", text: "Instructions" });
  const lines = config.status === "ready" ? config.data.lines.agentMd : 0;
  entries.push({ key: "f-agent", type: "row", title: "AGENT.md", note: config.status === "ready" ? instructionsLine(lines) : "Reading…", leading: <LeadIcon name="doc" />, onPress: () => data.nav.openAgentFile(agentId, "AGENT.md"), testID: "setting-agentmd" });
  const err = config.status === "ready" ? config.data.error : undefined;
  entries.push({
    key: "f-toml", type: "row", title: "agent.toml", leading: <LeadIcon name="doc" />, onPress: () => data.nav.openAgentFile(agentId, "agent.toml"), testID: "setting-toml",
    note: err ? `Line ${err.line ?? "?"}: ${err.message}. The last good version is running.` : "Config. The owner writes it; the app checks it.",
  });

  /* ---- what the agent suggests */
  const open: Suggestion[] = sugQ.status === "ready" ? sugQ.data.suggestions.filter((s) => s.state === "open") : [];
  if (open.length > 0) {
    entries.push({ key: "l-sug", type: "label", text: "Suggested changes", right: String(open.length) });
    for (const s of open) {
      entries.push({
        key: `s-${s.suggestionId}`, type: "row", title: suggestionTitle(s), note: s.widening ? "Widens what the agent may do: a Space admin approves it" : s.reason ?? `Proposed by ${data.nameOf(s.proposedBy)}`, leading: <LeadIcon name="edit" color="var(--accent)" />, testID: `suggestion-${s.suggestionId}`,
        trailing: data.canEdit
          ? <View style={st.pair}><TextButton label="Accept" primary testID={`accept-${s.suggestionId}`} onPress={() => void acceptSuggestion(deps, s)} /><TextButton label="Dismiss" testID={`dismiss-${s.suggestionId}`} onPress={() => void dismissSuggestion(deps, s)} /></View>
          : <TextButton label="Suggested" disabled testID={`suggested-${s.suggestionId}`} onPress={() => undefined} />,
      });
    }
  }

  /* ---- model, account, memory, computer */
  entries.push({ key: "l-model", type: "label", text: "Model" });
  entries.push({ key: "m-model", type: "row", title: "Model", note: agent.model ? `${agent.model}${agent.fallbackModel ? `, then ${agent.fallbackModel}` : ""}` : "The Space default", testID: "setting-model" });
  entries.push({ key: "m-account", type: "row", title: "Runs on", note: accountLine(agent), testID: "setting-account" });
  entries.push({ key: "m-memory", type: "row", title: "Memory", note: CAPTURE_WORDS[agent.captureMode], testID: "setting-memory" });
  entries.push({ key: "m-computer", type: "row", title: "Computer", note: agent.hasComputer ? "Has its own computer" : data.space.personal ? "Agent computers need a Team Space" : "None yet", testID: "setting-computer" });

  /* ---- limits, access, keys */
  const limits = limitRows(agent.limits);
  entries.push({ key: "l-limits", type: "label", text: "Limits" });
  if (limits.length === 0) entries.push({ key: "no-limits", type: "empty", text: "No limits set.", testID: "limits-empty" });
  for (const l of limits) entries.push({ key: `lim-${l.key}`, type: "row", title: l.label, note: l.value, testID: `limit-${l.key}` });
  entries.push({ key: "l-access", type: "label", text: "Access and keys" });
  entries.push({ key: "a-allowed", type: "row", title: "Tools allowed", note: agent.toolsAllowed.length > 0 ? agent.toolsAllowed.join(", ") : "None named", testID: "setting-allowed" });
  if (agent.toolsDenied.length > 0) entries.push({ key: "a-denied", type: "row", title: "Tools denied", note: agent.toolsDenied.join(", "), testID: "setting-denied" });
  entries.push({ key: "a-keys", type: "row", title: "Keys", leading: <LeadIcon name="lock" />, note: agent.vaultKeys.length > 0 ? `${agent.vaultKeys.join(", ")} (names only)` : "No keys", testID: "setting-keys" });

  /* ---- routines you set */
  const mine: Routine[] = routinesQ.status === "ready" ? mineOnly(routinesQ.data.routines, data.me.id) : [];
  entries.push({ key: "l-routines", type: "label", text: "Routines you set", right: mine.length > 0 ? String(mine.length) : "" });
  entries.push({ key: "r-runs", type: "row", title: "Automation runs", note: "Every run of these routines", leading: <LeadIcon name="clock" />, onPress: () => data.nav.openAutomationRuns(agentId), trailing: <Icon name="chev" size={12} />, testID: "automation-runs" });
  if (mine.length === 0) entries.push({ key: "no-routines", type: "empty", text: `You have not set a routine for ${name}. Ask it in a chat: "Every morning at 8, …".`, testID: "routines-empty" });
  for (const r of mine) {
    entries.push({
      key: `r-${r.routineId}`, type: "row", title: r.title, note: `${routineNote(r, clock)} · ${lastRun(r, clock)}`, leading: <LeadIcon name="clock" />, testID: `routine-${r.routineId}`,
      onPress: () => data.nav.openRoutineFile(agentId, r.title),
      trailing: <Switch on={r.enabled} label={`${r.title} on`} testID={`routine-switch-${r.routineId}`} onPress={() => void setRoutine(deps, agentId, r, !r.enabled)} />,
    });
  }
  if (mine.length > 0) entries.push({ key: "r-label", type: "empty", text: `Its posts from your routines carry the line: ${routineLabel(name, data.me.name)}. Nobody else sees or edits a routine.`, testID: "routine-label-note" });

  /* ---- pause and trash */
  if (data.canEdit) {
    entries.push({ key: "l-agent", type: "label", text: "This agent" });
    entries.push(agent.status === "paused"
      ? { key: "p-resume", type: "row", title: "Resume", note: "Routines and watchers start again", leading: <LeadIcon name="clock" />, onPress: () => void resume(deps, agentId, name), testID: "resume" }
      : { key: "p-pause", type: "row", title: "Pause", note: "Stops its routines and watchers until you resume it", leading: <LeadIcon name="clock" />, onPress: () => void pause(deps, agentId, name, "Paused from the agent page"), testID: "pause" });
    entries.push(trash
      ? {
        key: "t-confirm", type: "block", node: (
          <View testID="trash-confirm" accessibilityRole="alert" style={st.confirm}>
            <Text style={st.confirmText}>Move this agent to Trash?</Text>
            <TextButton label="Move to Trash" primary testID="trash-yes" onPress={() => void moveToTrash(deps, agentId, name).then((ok) => { setTrash(false); if (ok) data.nav.closePage(); })} />
            <TextButton label="Cancel" testID="trash-no" onPress={() => setTrash(false)} />
          </View>
        ),
      }
      : { key: "t-trash", type: "row", title: "Move to Trash…", note: "Its folder and chats are kept for 30 days", leading: <LeadIcon name="trash" color="var(--danger)" />, onPress: () => setTrash(true), testID: "trash" });
  }
  return <PaneList entries={entries} {...(window ? { window } : {})} testID="settings-list" />;
}

const st = StyleSheet.create({
  pair: { flexDirection: "row", alignItems: "center", gap: 4 },
  confirm: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, paddingHorizontal: 8, paddingVertical: 8 },
  confirmText: { flex: 1, minWidth: 160, fontSize: 13, color: "var(--ink)" as string },
});
