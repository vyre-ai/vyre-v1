// Skills in the right pane (owner, 4 Nov 2026; prototype r-install): the skills this chat's agent can use, in three groups: Yours, Your agents' (what agents keep for themselves) and Shared with you. Each row has
// Share, the one Share sheet on the skill (an access resource): people and agents at Can use, Can edit and Can manage. History, the versions with who saved each. An "Update available" mark on a skill installed
// from a link that has a newer commit. Reads skills.page, skills.of_agents and install.list; the tab shows only where the person has skills.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { CapMap } from "../../../../../../../generated/types.ts";
import { Face, TextButton } from "../rightpane/parts.tsx";
import type { PaneDeps } from "../rightpane/actions.ts";
import { historyLine, skillLine } from "./model.ts";

type Page = CapMap["skills.page"]["out"];
type OfAgents = CapMap["skills.of_agents"]["out"]["skills"][number];

export interface SkillRow { skillId: string; name: string; line: string; faceId: string; faceName: string; mine: boolean }
export interface SkillGroup { title: string; rows: SkillRow[] }

/** The three groups the list draws, from the page and the agents' skills. A group with nothing in it is left out. */
export function groupsOf(page: Pick<Page, "mine" | "shared" | "me">, agents: readonly OfAgents[], nameOf: (id: string) => string): SkillGroup[] {
  const groups: SkillGroup[] = [
    { title: "Yours", rows: page.mine.map((s) => ({ skillId: s.skillId, name: s.label ?? s.name, line: skillLine({ version: s.version ?? "", source: s.source }), faceId: page.me, faceName: nameOf(page.me), mine: true })) },
    { title: "Your agents'", rows: agents.map((s) => ({ skillId: s.skillId, name: s.name, line: `${s.agentName} keeps it · ${skillLine({ version: s.version, source: s.source }) || `v${s.rev}`}`, faceId: s.agentId, faceName: s.agentName, mine: true })) },
    { title: "Shared with you", rows: page.shared.map((c) => ({ skillId: c.skillId, name: c.label ?? c.name, line: `Shared by ${c.sharerName}`, faceId: c.sharer, faceName: c.sharerName, mine: false })) },
  ];
  return groups.filter((g) => g.rows.length > 0);
}

const SAME = (id: string): string => id;
export function SkillsTab({ deps, nameOf = SAME, highlight, renderShare }: { deps: PaneDeps; nameOf?: (id: string) => string; /** the skill an Open from an install card points at */ highlight?: string; /** The shared Share sheet on a skill (access resource "skill"): agents and people at Can use, Can edit and Can manage. */ renderShare?(resource: { type: string; id: string; name: string }, onClose: () => void): ReactElement }): ReactElement {
  const [groups, setGroups] = useState<SkillGroup[] | null>(null);
    const [hist, setHist] = useState<Record<string, string[] | undefined>>({});
  const [share, setShare] = useState<string | null>(null);
  const read = useCallback(async (): Promise<void> => {
    try {
      const page = (await deps.call("skills.page", {})) as Page;
      const of = (await deps.call("skills.of_agents", {}).catch(() => ({ skills: [] }))) as { skills: OfAgents[] };
      setGroups(groupsOf(page, of.skills, nameOf));
    } catch { setGroups([]); }
  }, [deps, nameOf]);
  useEffect(() => { void read(); }, [read]);

  const showHistory = async (id: string): Promise<void> => {
    if (hist[id]) { setHist((h) => ({ ...h, [id]: undefined })); return; }
    try {
      const out = (await deps.call("skills.history", { skillId: id })) as CapMap["skills.history"]["out"];
      setHist((h) => ({ ...h, [id]: out.revisions.map((r) => historyLine(r, nameOf)) }));
    } catch { deps.note("Could not read its history."); }
  };
  // Update marker: a skill installed from a link is looked at once when the tab opens (a few at a time, never blocking the list). A newer commit puts "Update available" on its row.
  const [updates, setUpdates] = useState<Record<string, { installId: string; to: string }>>({});
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const list = ((await deps.call("install.list", {})) as { installs: Array<{ installId: string; kind: string; installed: { skillId?: string } }> }).installs.filter((i) => i.kind === "skill" && i.installed.skillId).slice(0, 4);
        for (const i of list) {
          const out = (await deps.call("install.check_update", { installId: i.installId }).catch(() => null)) as { changed: boolean; plan?: { planId: string; commit: string } } | null;
          if (live && out?.changed && out.plan) setUpdates((u) => ({ ...u, [i.installed.skillId!]: { installId: i.installId, to: out.plan!.commit } }));
        }
      } catch { /* no marker */ }
    })();
    return () => { live = false; };
  }, [deps]);

  if (groups === null) return <View testID="skills-loading" style={st.pad}><Text style={st.dim}>Reading skills…</Text></View>;
  if (groups.length === 0) return <View testID="skills-empty" style={st.pad}><Text style={st.dim}>No skills yet. Give the Assistant a GitHub link and ask it to install it.</Text></View>;
  return (
    <ScrollView testID="skills-list" contentContainerStyle={st.pad}>
      {groups.map((g) => (
        <View key={g.title} style={st.group}>
          <View style={st.gh}><Text accessibilityRole="header" style={st.gt}>{g.title}</Text><Text style={st.dim}>{g.rows.length}</Text></View>
          {g.rows.map((r) => (
            <View key={r.skillId} testID={`skill-row-${r.skillId}`} style={[st.row, highlight !== undefined && (r.name === highlight) && st.hi]}>
              <Face name={r.faceName} seedId={r.faceId} size={22} />
              <View style={st.body}>
                <Text style={st.name}>{r.name}</Text>
                <Text style={st.dim}>{r.line}</Text>
                {updates[r.skillId] ? <Text testID={`skill-update-${r.skillId}`} style={st.upd}>Update available</Text> : null}
                {r.mine ? (
                  <View style={st.actions}>
                    <TextButton label="Share" testID={`skill-share-${r.skillId}`} onPress={() => setShare(r.skillId)} />
                    <TextButton label={hist[r.skillId] ? "Hide history" : "History"} testID={`skill-history-${r.skillId}`} onPress={() => { void showHistory(r.skillId); }} />
                  </View>
                ) : null}
                {share === r.skillId && renderShare ? renderShare({ type: "skill", id: r.skillId, name: r.name }, () => setShare(null)) : null}
                {hist[r.skillId] ? (
                  <View testID={`skill-hist-${r.skillId}`} style={st.hist}>{hist[r.skillId]!.map((l, i) => <Text key={i} style={st.histLine}>{l}</Text>)}</View>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  pad: { padding: 12, gap: 10 },
  group: { gap: 4 },
  gh: { flexDirection: "row", gap: 8, alignItems: "center", paddingBottom: 2 },
  gt: { fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string },
  dim: { fontSize: 12.5, color: "var(--ink-3)" as string, lineHeight: 18 },
  row: { flexDirection: "row", gap: 10, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 10 },
  hi: { backgroundColor: "var(--accent-wash)" as string },
  body: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 13.5, fontWeight: "500", color: "var(--ink)" as string },
  actions: { flexDirection: "row", gap: 6, marginTop: 4 },
  sheet: { gap: 6, marginTop: 6, padding: 8, borderRadius: 10, backgroundColor: "var(--bg)" as string },
  agentRow: { gap: 4 },
  agentName: { fontSize: 13, color: "var(--ink)" as string },
  seg: { flexDirection: "row", flexWrap: "wrap", gap: 2, padding: 2, borderRadius: 9, backgroundColor: "var(--hover)" as string, alignSelf: "flex-start" },
  pill: { height: 26, paddingHorizontal: 10, borderRadius: 7, justifyContent: "center" },
  pillOn: { backgroundColor: "var(--raised)" as string },
  pillText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  pillTextOn: { color: "var(--ink)" as string },
  upd: { fontSize: 12, fontWeight: "500", color: "var(--accent)" as string },
  hist: { marginTop: 4, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: "var(--line)" as string, gap: 2 },
  histLine: { fontSize: 12, color: "var(--ink-3)" as string, lineHeight: 18 },
});
