// The Knows tab of a project: what Vyre remembers here, from memory.place.list (l-memory), drawn by the shared ui/Knows. A row's Source opens the project's chat at that message; Edit and Remove
// are the person's where they may edit the place.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Knows } from "../../../../../../ui/src/Knows/index.tsx";
import type { KnowsItem, KnowsKind, KnowsState } from "../../../../../../ui/src/Knows/model.ts";
import { useProjectPageData } from "./data.tsx";
import { ago } from "./model.ts";
import type { ProjectTabProps } from "./tabs.ts";

interface PlaceFact { factId: string; kind: KnowsKind; text: string; state: KnowsState; said_by?: string; at?: number; messageId?: string; threadId?: string; canEdit?: boolean; replacedBy?: string; owes?: string }

/** memory.place.list rows as the Knows tab reads them: people as names, times as the reader reads them. */
export function knowsItems(facts: readonly PlaceFact[], nameOf: (id: string) => string, now: number, canEdit: boolean): KnowsItem[] {
  return facts.map((f) => ({
    factId: f.factId, kind: f.kind, text: f.text, state: f.state, by: f.said_by ? nameOf(f.said_by) : "Vyre", at: f.at ? ago(f.at, now) : "",
    ...(f.replacedBy ? { replacedBy: f.replacedBy } : {}), ...(f.owes ? { owes: f.owes } : {}), canEdit: f.canEdit ?? canEdit,
    ...(f.messageId ? { messageId: f.messageId } : {}), ...(f.threadId ? { threadId: f.threadId } : {}),
  }));
}

export function KnowsTab({ projectId, canEdit }: ProjectTabProps): ReactElement {
  const d = useProjectPageData();
  const [facts, setFacts] = useState<PlaceFact[] | null>(null);
  const [title, setTitle] = useState("this project");
  const read = useCallback(async (): Promise<void> => {
    try {
      const out = (await d.call("memory.place.list", { placeKind: "project", placeId: projectId, history: true })) as { facts?: PlaceFact[] };
      setFacts(out.facts ?? []);
    } catch { setFacts([]); }
  }, [d, projectId]);
  useEffect(() => { void read(); }, [read]);
  useEffect(() => { void Promise.resolve(d.call("projects.get", { projectId })).then((o) => setTitle((o as { project?: { title?: string } }).project?.title ?? "this project"), () => undefined); }, [d, projectId]);
  if (facts === null) return <View testID="project-knows-loading" style={s.pad}><Text style={s.dim}>Loading</Text></View>;
  const items = knowsItems(facts, d.nameOf, d.now(), canEdit);
  return (
    <View style={s.fill} testID="project-knows">
      <Knows
        place={title} items={items}
        onSource={(i) => { if (i.threadId) d.nav.openThread(i.threadId); }}
        onEdit={(i, text) => { void Promise.resolve(d.call("memory.fact.correct", { factId: i.factId, text })).then(read, read); }}
        onRemove={(i) => { void Promise.resolve(d.call("memory.facts.remove", { factIds: [i.factId] })).then(read, read); }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, minHeight: 0, padding: 24 },
  pad: { padding: 24 },
  dim: { fontSize: 13, color: "var(--ink-3)" as string },
});
