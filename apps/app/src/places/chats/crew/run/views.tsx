// The pieces around a delegated run, as a person sees them (lane r42-subagents, prototype sub42, 19 Nov 2026): the board, the quiet lines between helpers, the dependency line, the sleeping line, the token report, the
// Space's running-and-asleep list and the @name menu. Each takes the runtime's shapes (run/model.ts) and draws; none reads a server.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../../ui/src/Avatar/index.tsx";
import { WorkingMark } from "../../../../../../../ui/src/WorkingMark/index.tsx";
import { Glyph } from "../../conversation/parts.tsx";
import { modelName } from "../../../../../../../lib/model-names.ts";
import { money, tokens } from "../model.ts";
import {
  activityGroups,
  atCandidates,
  boardGroups,
  dependencyLine,
  messageLines,
  sleepLine,
  wakeCondition,
  tokenReport,
} from "./model.ts";
import type { ActivityRow, BoardEntry, NodeMessage, RunNode } from "./model.ts";

const nameIn = (nodes: readonly Pick<RunNode, "id" | "name">[], id: string): string =>
  (nodes.find((n) => n.id === id)?.name ?? "Helper").split(" ")[0]!;

/** The board: open questions first, then answered, decisions and facts; each says who wrote it and where it came from. */
export function BoardView({
  entries,
  nodes,
  onEvidence,
}: {
  entries: readonly BoardEntry[];
  nodes: readonly Pick<RunNode, "id" | "name">[];
  onEvidence?: (ref: string) => void;
}): ReactElement {
  const g = boardGroups(entries);
  if (entries.length === 0)
    return (
      <Text testID="board-empty" style={st.note}>
        Nothing on the board yet.
      </Text>
    );
  const section = (key: string, title: string, list: BoardEntry[]): ReactElement | null =>
    list.length === 0 ? null : (
      <View key={key} testID={`board-${key}`} style={st.sec}>
        <Text style={st.h}>
          {title} <Text style={st.count}>{list.length}</Text>
        </Text>
        {/* ui-rows-lint: not a list (the entries of one board section: a sentence, who wrote it, where it came from) */}
        {list.map((e) => (
          <View key={e.id} testID={`board-entry-${e.id}`} style={st.entry}>
            <Text style={st.entryText}>{e.text}</Text>
            <View style={st.meta}>
              <Avatar name={nameIn(nodes, e.byRun)} seedId={e.byRun} kind="agent" size={14} />
              <Text style={st.metaText}>{nameIn(nodes, e.byRun)}</Text>
              {/* ui-rows-lint: not a list (the sources of one entry, each a small chip) */}
              {(e.evidence ?? []).map((ref) => (
                <Pressable
                  key={ref}
                  accessibilityRole="link"
                  testID={`board-evidence-${e.id}`}
                  onPress={() => onEvidence?.(ref)}
                  style={st.chip}
                >
                  <Text style={st.chipText} numberOfLines={1}>
                    {ref}
                  </Text>
                </Pressable>
              ))}
              {e.answer ? (
                <Text testID={`board-answer-${e.id}`} style={st.answer}>
                  ✓ {nameIn(nodes, e.answer.byRun)}: {e.answer.text}
                </Text>
              ) : e.kind === "question" ? (
                <Text style={st.open}>Open</Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    );
  return (
    <View testID="board">
      {section("open", "Open questions", g.open)}
      {section("answered", "Answered", g.answered)}
      {section("decisions", "Decisions", g.decisions)}
      {section("facts", "Facts", g.facts)}
    </View>
  );
}

/** The last two messages between helpers, under the tiles: who to whom as two faces, then the words; a quiet check once the receiver has read it. */
export function MessageLines({
  messages,
  nodes,
}: {
  messages: readonly NodeMessage[];
  nodes: readonly Pick<RunNode, "id" | "name">[];
}): ReactElement | null {
  const lines = messageLines(messages, nodes);
  if (lines.length === 0) return null;
  return (
    <View testID="message-lines" style={st.lines}>
      {/* ui-rows-lint: not a list (the last two lines said between helpers: two faces and plain text, nothing to press) */}
      {lines.map((l) => (
        <View
          key={l.id}
          testID={`message-line-${l.id}`}
          accessibilityLabel={`${l.from} to ${l.to}: ${l.body}`}
          style={st.msg}
        >
          <Avatar name={l.from} seedId={l.fromId} kind="agent" size={16} />
          <Glyph name="chev" size={10} color="var(--ink-4)" />
          <Avatar name={l.to} seedId={l.toId} kind="agent" size={16} />
          <Text numberOfLines={1} style={st.msgText}>
            {l.body}
          </Text>
          {l.seen ? <Glyph name="check" size={11} color="var(--ink-4)" /> : null}
        </View>
      ))}
    </View>
  );
}

/** "Starts when Research and Numbers are done", only while it matters. */
export function DependencyLine({
  node,
  nodes,
}: {
  node: Pick<RunNode, "dependsOn" | "status">;
  nodes: readonly Pick<RunNode, "id" | "name" | "status">[];
}): ReactElement | null {
  const t = dependencyLine(node, nodes);
  return t === null ? null : (
    <Text testID="dependency-line" style={st.dep}>
      › {t}
    </Text>
  );
}

/** A run that sleeps is one calm line, never a spinner: the moon, what it waits on, how often it has woken. */
export function SleepLine({
  node,
  when,
  onOpen,
}: {
  node: Pick<RunNode, "status" | "wake">;
  when: (ts: number) => string;
  onOpen?: () => void;
}): ReactElement | null {
  const s = sleepLine(node, when);
  if (s === null || node.wake === undefined) return null;
  const cond = wakeCondition(node.wake, when);
  const woke = node.wake.wokeCount ?? 0;
  const body = (
    <>
      <Glyph name="moon" size={15} color="var(--ink-3)" />
      <Text style={st.sleepText} numberOfLines={1}>
        {cond === "" ? "Asleep" : cond}
      </Text>
      {woke > 0 ? <Text style={st.sleepN}>{`${woke}×`}</Text> : null}
    </>
  );
  return onOpen ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={s.head}
      testID="sleep-line"
      onPress={onOpen}
      style={st.sleep}
    >
      {body}
    </Pressable>
  ) : (
    <View accessibilityLabel={s.head} testID="sleep-line" style={st.sleep}>
      {body}
    </View>
  );
}

/** The token report: one line, and under it each node's model, tokens, share from cache and cost. */
export function TokenReport({
  nodes,
  open = false,
  onToggle,
}: {
  nodes: readonly RunNode[];
  open?: boolean;
  onToggle?: () => void;
}): ReactElement | null {
  const r = tokenReport(nodes);
  if (r.tokens === 0) return null;
  return (
    <View testID="token-report">
      <Pressable accessibilityRole="button" testID="token-report-line" onPress={onToggle} style={st.repLine}>
        <Text style={st.repText}>
          {tokens(r.tokens)} tokens · {money(r.costMicros)}
          {r.cacheRead > 0 ? ` · ${r.cachePct}% read from cache` : ""}
        </Text>
      </Pressable>
      {open ? (
        <View testID="token-report-rows">
          {/* ui-rows-lint: not a list (one line per helper of the report: name, model, tokens, cache share, cost) */}
          {r.rows.map((x) => (
            <View key={x.id} testID={`token-row-${x.id}`} style={st.repRow}>
              <Text style={[st.repCell, { flex: 1 }]} numberOfLines={1}>
                {x.name}
              </Text>
              <Text style={st.repMuted} numberOfLines={1}>
                {x.model === "" ? "" : modelName(x.model)}
              </Text>
              <Text style={st.repCell}>{tokens(x.tokens)}</Text>
              <Text style={st.repMuted}>{x.cachePct}%</Text>
              <Text style={st.repCell}>{money(x.costMicros)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** A section's head: a disclosure chevron, a short title, a quiet count. One press opens or shuts it. */
export function SectionHead({
  title,
  count,
  open,
  onPress,
  testID,
}: {
  title: string;
  count?: number | undefined;
  open: boolean;
  onPress: () => void;
  testID: string;
}): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      testID={testID}
      onPress={onPress}
      style={st.head}
    >
      <View style={open ? st.chevOpen : undefined}>
        <Glyph name="chev" size={12} color="var(--ink-3)" />
      </View>
      <Text style={st.headTitle}>{title}</Text>
      {count !== undefined && count > 0 ? <Text style={st.headCount}>{count}</Text> : null}
    </Pressable>
  );
}

/** Everything running or asleep in the Space: Needs you, Running, Asleep. A running one wears the live mark, a sleeping one the moon and what it waits on; one press opens its session. */
export function ActivityList({
  rows,
  when,
  onOpen,
  onNudge,
}: {
  rows: readonly ActivityRow[];
  when: (ts: number) => string;
  onOpen: (runId: string) => void;
  onNudge?: (runId: string) => void;
}): ReactElement {
  const groups = activityGroups(rows);
  return (
    <View testID="activity">
      {groups.length === 0 ? (
        <Text testID="activity-empty" style={st.note}>
          Nothing is running or asleep.
        </Text>
      ) : null}
      {/* ui-rows-lint: not a list (the three groups of the Space's activity: a title and its runs) */}
      {groups.map((g) => (
        <View key={g.key} testID={`activity-${g.key}`} style={st.sec}>
          <Text style={st.h}>
            {g.title} <Text style={st.count}>{g.rows.length}</Text>
          </Text>
          {/* ui-rows-lint: not a list (the runs of one group of the Space's activity, each a line with what it is on and a time) */}
          {g.rows.map((r) => {
            const cond = r.status === "waiting" && r.wake ? wakeCondition(r.wake, when) : "";
            const woke = r.status === "waiting" ? (r.wake?.wokeCount ?? 0) : 0;
            return (
              <Pressable
                key={r.runId}
                accessibilityRole="button"
                accessibilityLabel={`${r.name}, ${r.stuck ? `looks stuck: ${r.stuck.reason}` : r.status === "waiting" ? `asleep ${cond}` : (r.step ?? "working")}`}
                testID={`activity-row-${r.runId}`}
                onPress={() => onOpen(r.runId)}
                style={st.actRow}
              >
                <Avatar name={r.name} seedId={r.runId} kind="agent" size={26} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={st.actName} numberOfLines={1}>
                    {r.name}
                  </Text>
                  <View style={st.actState}>
                    {r.stuck ? (
                      <Text style={st.actLine} numberOfLines={1}>
                        Looks stuck: {r.stuck.reason}
                      </Text>
                    ) : r.status === "waiting" ? (
                      <>
                        <Glyph name="moon" size={12} color="var(--ink-3)" />
                        <Text style={st.actLine} numberOfLines={1}>
                          {cond}
                        </Text>
                      </>
                    ) : (
                      <>
                        <WorkingMark state="thinking" size={14} testID={`activity-live-${r.runId}`} />
                        {r.step ? (
                          <Text style={st.actLine} numberOfLines={1}>
                            {r.step}
                          </Text>
                        ) : null}
                      </>
                    )}
                  </View>
                </View>
                {r.stuck && onNudge ? (
                  <Pressable
                    accessibilityRole="button"
                    testID={`activity-nudge-${r.runId}`}
                    onPress={() => onNudge(r.runId)}
                  >
                    <Text style={st.actNudge}>Nudge it</Text>
                  </Pressable>
                ) : (
                  <Text style={st.actMeta}>{woke > 0 ? `${`${woke}×`}` : (r.whoName ?? "")}</Text>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** The list that opens while typing "@" in the main box: who it can go to, with what each is on. */
export function AtMenu({
  nodes,
  query,
  index,
  onPick,
}: {
  nodes: readonly RunNode[];
  query: string;
  index: number;
  onPick: (n: RunNode) => void;
}): ReactElement | null {
  const l = atCandidates(nodes, query);
  if (l.length === 0) return null;
  return (
    <View testID="at-menu" accessibilityRole="menu" style={st.at}>
      <Text style={st.atHead}>Tell one of them</Text>
      {/* ui-rows-lint: not a list (the helpers an @ can mean, each a face, a name and what it is on) */}
      {l.map((n, i) => (
        <Pressable
          key={n.id}
          accessibilityRole="menuitem"
          accessibilityState={{ selected: i === index }}
          testID={`at-item-${n.id}`}
          onPress={() => onPick(n)}
          style={[st.atRow, i === index && st.atOn]}
        >
          <Avatar name={n.name ?? "Helper"} seedId={n.id} kind="agent" size={22} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.actName}>{n.name}</Text>
            <Text style={st.actLine} numberOfLines={1}>
              {n.summary ?? (n.status === "succeeded" ? "Done" : "Working")}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  sec: { marginBottom: 6 },
  h: { marginTop: 10, marginBottom: 4, fontSize: 11.5, color: "var(--ink-3)" as string },
  count: { fontSize: 11.5, color: "var(--ink-4)" as string },
  entry: { gap: 5, paddingVertical: 9, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  entryText: { fontSize: 13.5, lineHeight: 19, color: "var(--ink)" as string },
  meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  metaText: { fontSize: 12, color: "var(--ink-3)" as string },
  chip: {
    height: 20,
    maxWidth: 220,
    paddingHorizontal: 7,
    borderRadius: 6,
    justifyContent: "center",
    backgroundColor: "var(--hover)" as string,
  },
  chipText: { fontSize: 11.5, color: "var(--ink-2)" as string },
  answer: { fontSize: 12, color: "var(--ok)" as string },
  open: { fontSize: 12, color: "var(--warn)" as string },
  note: { marginTop: 12, fontSize: 12, lineHeight: 17, color: "var(--ink-4)" as string },
  lines: { gap: 3, marginHorizontal: 8, marginVertical: 4 },
  msg: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 22 },
  msgText: { flex: 1, minWidth: 0, fontSize: 12, color: "var(--ink-3)" as string },
  head: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32 },
  headTitle: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
  headCount: { fontSize: 12, color: "var(--ink-4)" as string, fontVariant: ["tabular-nums"] },
  chevOpen: { transform: [{ rotate: "90deg" }] },
  actState: { flexDirection: "row", alignItems: "center", gap: 5 },
  sleepN: { fontSize: 12, color: "var(--ink-4)" as string, fontVariant: ["tabular-nums"] },
  line: { fontSize: 12, lineHeight: 22, color: "var(--ink-3)" as string },
  seen: { color: "var(--ink-4)" as string },
  dep: { fontSize: 11.5, color: "var(--accent)" as string },
  sleep: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: "var(--sunk)" as string,
  },
  sleepText: { flex: 1, minWidth: 0, fontSize: 13, color: "var(--ink-3)" as string },
  sleepHead: { fontWeight: "500", color: "var(--ink)" as string },
  pill: {
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 9,
    justifyContent: "center",
    backgroundColor: "var(--hover)" as string,
  },
  pillText: { fontSize: 12, color: "var(--ink-2)" as string },
  repLine: { height: 28, paddingHorizontal: 8, borderRadius: 8, justifyContent: "center" },
  repText: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  repRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: "var(--line)" as string,
  },
  repCell: { fontSize: 12.5, color: "var(--ink)" as string, fontVariant: ["tabular-nums"] },
  repMuted: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  actHead: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string, marginBottom: 2 },
  actRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: 10,
  },
  actName: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
  actLine: { fontSize: 12, color: "var(--ink-3)" as string },
  actMeta: { fontSize: 12, color: "var(--ink-3)" as string },
  actNudge: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
  at: {
    padding: 5,
    borderRadius: 14,
    backgroundColor: "var(--raised)" as string,
    boxShadow: "inset 0 0 0 1px var(--line)",
  } as object,
  atHead: { paddingHorizontal: 8, paddingTop: 5, paddingBottom: 4, fontSize: 11.5, color: "var(--ink-3)" as string },
  atRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 9,
  },
  atOn: { backgroundColor: "var(--hover)" as string },
});
