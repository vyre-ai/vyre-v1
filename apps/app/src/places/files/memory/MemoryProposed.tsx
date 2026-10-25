// Files > Knowledge > Proposed (spec 2.15): the facts an agent has proposed and nobody has decided on yet. Grouped by the layer each would join; every row is the shared ui/Row with the fact as its
// title, where it came from under it, and Accept and Reject at its right (also in its right-click menu). Accepting makes the fact current in the layer it was proposed for, with the person's name and
// time; rejecting closes it off and keeps it in history. A group has Accept all. Notes waiting in memory/proposed are listed beneath, to open.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { acceptFact, errorText, rejectFact } from "./actions.ts";
import { useLive, useMemoryData, useOptionalMemoryData } from "./data.tsx";
import { LAYER_LABEL, SOURCE_LABEL, ago, lands, proposedGroups } from "./model.ts";
import type { Fact, NoteRow } from "./model.ts";
import { Icon } from "./parts.tsx";

export interface MemoryProposedProps { agentId?: string }

interface Said { text: string; tone: "ok" | "bad" }

/** One proposed fact. Named Row because the rows lint reads a list item by that name; it is the shared ui/Row with Accept and Reject in its trailing slot. */
function FactRow({ fact, busy, onAccept, onReject, onOpen, now, who }: { fact: Fact; busy: boolean; onAccept: () => void; onReject: () => void; onOpen: () => void; now: number; who: (id: string) => string }): ReactElement {
  const menu = useMenu();
  const trig = menuTrigger((x, y) => menu.show([{ label: "Accept", onSelect: onAccept }, { label: "Reject", onSelect: onReject }, { separator: true }, { label: "Open Source", onSelect: onOpen }], x, y));
  const from = `From ${SOURCE_LABEL[fact.sourceKind]}${fact.layer === "person" ? "" : ` of ${who(fact.ownerRef)}`} · ${ago(fact.learnedAt, now)}${fact.lowRisk === true ? " · low risk" : ""}`;
  return (
    <View testID={`fact-${fact.factId}`} {...(trig as object)}>
      <Row
        id={`fact:${fact.factId}`} title={fact.text} note={from} onPress={onOpen}
        leading={<Icon name="note" size={16} color="var(--ink-3)" />}
        trailing={(
          <View style={p.acts}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Accept: ${fact.text}`} accessibilityState={{ disabled: busy }} disabled={busy} testID={`accept-${fact.factId}`} onPress={onAccept} style={({ hovered }: { hovered?: boolean }) => [p.accept, hovered === true && p.acceptOver]}>
              <Icon name="check" size={13} color="var(--accent-ink)" width={1.8} /><Text style={p.acceptText}>Accept</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Reject: ${fact.text}`} accessibilityState={{ disabled: busy }} disabled={busy} testID={`reject-${fact.factId}`} onPress={onReject} style={({ hovered }: { hovered?: boolean }) => [p.reject, hovered === true && p.rejectOver]}>
              <Text style={p.rejectText}>Reject</Text>
            </Pressable>
          </View>
        )}
      />
      {menu.element}
    </View>
  );
}

export function MemoryProposedBody({ agentId }: MemoryProposedProps): ReactElement {
  const data = useMemoryData();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [said, setSaid] = useState<Said | null>(null);
  const now = data.now();
  const fq = useLive("memory.facts.list", { ...(agentId ? { agentId } : {}), status: ["proposed"] });
  const nq = useLive("memory.notes.list", { ...(agentId ? { agentId } : {}), area: "proposed" });
  const facts = fq.status === "ready" ? fq.data.facts : [];
  const notes: readonly NoteRow[] = nq.status === "ready" ? nq.data.notes : [];
  const groups = proposedGroups(facts);

  const decide = (f: Fact, accept: boolean): void => {
    setSaid(null);
    setBusy((b) => new Set(b).add(f.factId));
    (accept ? acceptFact(data, f.factId) : rejectFact(data, f.factId))
      .then(() => setSaid({ tone: "ok", text: accept ? `Accepted. It is now in ${lands(f)}.` : "Rejected. It is closed off and kept in history." }))
      .catch((e: unknown) => setSaid({ tone: "bad", text: errorText(e, accept ? "Could not accept the fact" : "Could not reject the fact") }))
      .finally(() => setBusy((b) => { const n = new Set(b); n.delete(f.factId); return n; }));
  };
  const acceptAll = (list: readonly Fact[]): void => { for (const f of list) decide(f, true); };

  const body: ReactElement[] = [];
  for (const g of groups) {
    const rows: ReactElement[] = [];
    for (const f of g.facts) rows.push(<FactRow key={f.factId} fact={f} busy={busy.has(f.factId)} now={now} who={data.nameOf} onAccept={() => decide(f, true)} onReject={() => decide(f, false)} onOpen={() => data.nav.openSource(f.sourceLink ?? f.sourceRef)} />);
    body.push(
      <View key={g.layer} testID={`layer-${g.layer}`} accessibilityRole="list" accessibilityLabel={`Proposed for ${LAYER_LABEL[g.layer]}`}>
        <View style={p.gh}>
          <Text style={p.gt}>{`Joins ${lands(g.facts[0]!)}`}</Text>
          <Text style={p.gn} testID={`layer-count-${g.layer}`}>{g.facts.length}</Text>
          <View style={p.grow} />
          {g.facts.length > 1 ? <Pressable accessibilityRole="button" testID={`accept-all-${g.layer}`} onPress={() => acceptAll(g.facts)} style={({ hovered }: { hovered?: boolean }) => [p.all, hovered === true && p.allOver]}><Text style={p.allText}>Accept all</Text></Pressable> : null}
        </View>
        {rows}
      </View>,
    );
  }
  const noteRows: ReactElement[] = [];
  for (const n of notes) noteRows.push(<Row key={n.noteId} id={`note:${n.noteId}`} title={n.title} note={n.path} leading={<Icon name="note" size={16} color="var(--ink-3)" />} onPress={() => data.nav.openNote(n.noteId)} />);

  return (
    <View style={p.main} testID="memory-proposed" accessibilityLabel="Proposed memory">
      <View style={p.head}>
        <Icon name="lock" size={14} color="var(--ink-3)" />
        <Text accessibilityRole="header" aria-level={1} style={p.h1}>Proposed</Text>
        <Text style={p.count} testID="proposed-count">{facts.length === 0 ? "" : `${facts.length} waiting`}</Text>
      </View>
      {said ? <Text style={[p.said, said.tone === "bad" && p.bad]} accessibilityRole="alert" testID="proposed-said">{said.text}</Text> : null}
      <ScrollView style={p.scroll} contentContainerStyle={p.content}>
        {groups.length === 0 && notes.length === 0 ? (
          <States kind="empty" title="Nothing waiting for review" icon="done" />
        ) : (
          <>
            {body}
            {noteRows.length > 0 ? (
              <View testID="proposed-notes" accessibilityRole="list" accessibilityLabel="Notes waiting">
                <View style={p.gh}><Text style={p.gt}>Notes waiting in memory/proposed</Text><Text style={p.gn}>{notes.length}</Text></View>
                {noteRows}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

/** The screen, or its frame while the shell has not provided the data yet. */
export function MemoryProposed(props: MemoryProposedProps): ReactElement {
  const data = useOptionalMemoryData();
  if (!data) return <View style={p.main} testID="memory-proposed-loading" accessibilityLabel="Loading"><View style={p.head}><Text accessibilityRole="header" style={p.h1}>Proposed</Text></View></View>;
  return <MemoryProposedBody {...props} />;
}

const p = StyleSheet.create({
  main: { flex: 1, minWidth: 0, backgroundColor: "var(--win)" as string },
  head: { height: 48, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  h1: { margin: 0, fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  count: { fontSize: 12.5, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  said: { fontSize: 12.5, color: "var(--ink-2)" as string, paddingHorizontal: 18, paddingVertical: 8, backgroundColor: "var(--accent-wash)" as string },
  bad: { color: "var(--danger)" as string },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 24, maxWidth: 880 },
  gh: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingTop: 14, paddingBottom: 6 },
  gt: { fontSize: 12, fontWeight: "600", color: "var(--ink-3)" as string },
  gn: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  grow: { flex: 1 },
  all: { height: 24, paddingHorizontal: 8, borderRadius: 6, justifyContent: "center" },
  allOver: { backgroundColor: "var(--hover)" as string },
  allText: { fontSize: 12, fontWeight: "500", color: "var(--accent)" as string },
  acts: { flexDirection: "row", alignItems: "center", gap: 6 },
  accept: { height: 24, paddingHorizontal: 9, borderRadius: 6, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "var(--accent)" as string },
  acceptOver: { opacity: 0.9 },
  acceptText: { fontSize: 12, fontWeight: "500", color: "var(--accent-ink)" as string },
  reject: { height: 24, paddingHorizontal: 9, borderRadius: 6, justifyContent: "center" },
  rejectOver: { backgroundColor: "var(--hover)" as string },
  rejectText: { fontSize: 12, fontWeight: "500", color: "var(--ink-2)" as string },
});
