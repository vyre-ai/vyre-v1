// A goal in a chat: the block a message carries (type "goal"). A draft the owner starts with one press; a check-in with the number Vyre read, what moved and what is next; a stuck notice
// with its two options; the end with its summary and, for a missed goal, Extend. The card follows the goal itself, so a goal started or extended anywhere shows here at once.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Card, CardActions } from "../../../../../../ui/src/Card/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useFollow } from "../conversation/use-follow.ts";
import type { Changes } from "../conversation/use-follow.ts";
import { Bar, TONE } from "./GoalRow.tsx";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { askedCall, goalMenuEntries } from "./goal-menu.ts";
import { TextAsk } from "../menus/TextAsk.tsx";
import { Icon } from "./GoalPage.tsx";
import { delta, fmt, lineWithDue, statusOf } from "./model.ts";
import { useZones } from "../../../../../../ui/src/Time/index.tsx";
import type { GoalBlock, Progress, Status } from "./model.ts";

export { goalBlockOf } from "./model.ts";

interface Live { status: Status; progress: Progress; deadline: number; owner?: string }

export function GoalCard({ block, call, changes, openGoal, me }: { block: GoalBlock; call(cap: string, input: unknown): Promise<unknown>; changes: Changes | undefined; openGoal?: (goalId: string) => void; me?: string }): ReactElement {
  const zones = useZones();
  const [live, setLive] = useState<Live | null>(null);
  const [said, setSaid] = useState("");
  const menu = useMenu();
  const [asking, setAsking] = useState<"stuck" | "report" | null>(null);
  const load = useCallback(async (): Promise<void> => {
    const o = (await call("goals.get", { goalId: block.goalId })) as { goal?: Live & { owner?: string } };
    if (o.goal) setLive({ status: o.goal.status, progress: o.goal.progress, deadline: o.goal.deadline, ...(o.goal.owner ? { owner: o.goal.owner } : {}) });
  }, [call, block.goalId]);
  useEffect(() => { void load().catch(() => undefined); }, [load]);
  // a draft or an end card follows the goal; a check-in is what it said at the time
  useFollow(changes, load, block.kind !== "update");
  const status = live?.status ?? block.status;
  const press = (cap: string, input: Record<string, unknown>, done: string): void => {
    void call(cap, { goalId: block.goalId, ...input }).then(() => { setSaid(done); void load(); }, (e: unknown) => setSaid(e instanceof Error && e.message ? e.message : "That did not go through."));
  };
  const s = statusOf({ status, owner: me ?? "" }, me);
  const value = block.kind === "update" ? block.value : live?.progress.value ?? block.value;
  const target = block.target ?? live?.progress.target;
  const frac = value !== undefined && target ? Math.max(0, Math.min(1, value / target)) : live ? (live.progress.percent ?? 0) / 100 : 0;
  const d = block.kind === "update" ? delta(block) : null;
  const title = block.kind === "draft" ? "Goal drafted" : block.kind === "update" ? "Check-in" : block.kind === "stuck" ? "Stuck" : block.outcome === "done" ? "Goal reached" : block.outcome === "missed" ? "Goal missed" : "Goal stopped";
  const icon = block.kind === "stuck" ? "warn" : block.outcome === "done" ? "check" : "target";
  return (
    <View {...menuTrigger((x, y) => { if (block.kind === "draft" || live?.owner === undefined) return; menu.show(goalMenuEntries({ id: block.goalId, title: block.title, status, owner: live.owner }, me, { run: async (cap, input, done) => { press(cap, input, done ?? ""); return true; }, open: openGoal ? () => openGoal(block.goalId) : undefined, ask: setAsking }), x, y, "context", { label: block.title }); })}>
    <Card kind="progress" testID={`goal-card-${block.kind}-${block.goalId}`} label={`${title}: ${block.title}`}>
      {menu.element}
      {asking ? <TextAsk title={asking === "stuck" ? "Why is this goal stuck?" : "Report progress"} label={asking === "stuck" ? "What is in the way" : "What changed and what is next"} action={asking === "stuck" ? "Mark stuck" : "Report"} multiline onClose={() => setAsking(null)} onDone={(text) => { const c = askedCall(asking, text); setAsking(null); press(c.cap, c.input, c.done); }} /> : null}
      <View style={st.head}>
        <Icon name={icon} size={14} color={block.kind === "stuck" ? TONE.stuck : block.outcome === "done" ? TONE.ok : "var(--ink-3)"} />
        <View style={{ flex: 1 }} />
        <Text style={[st.small, { color: TONE[s.tone] as string }]}>{s.word}</Text>
      </View>
      <Pressable accessibilityRole="link" accessibilityLabel={`Open the goal ${block.title}`} onPress={() => openGoal?.(block.goalId)} testID={`goal-card-open-${block.goalId}`}>
        <Text style={st.title}>{block.title}</Text>
      </Pressable>
      <Text style={st.small}>{lineWithDue(block.line, live?.deadline ?? block.deadline, zones)}</Text>
      {value !== undefined && target !== undefined ? (
        <View style={st.num}>
          <Text style={st.big}>{fmt(value)}</Text><Text style={st.of}>{`/ ${fmt(target)}${block.unit ? ` ${block.unit}` : ""}`}</Text>
          {d ? <Text style={[st.small, { marginLeft: 8 }]}>{d}</Text> : null}
        </View>
      ) : null}
      {value !== undefined && target !== undefined ? <Bar value={frac} tone={block.outcome === "done" ? "ok" : "plain"} width="100%" /> : null}
      {block.summary ? <Text style={st.body}>{block.summary}</Text> : null}
      {block.done?.length ? <Lines label="Done" items={block.done} icon="check" /> : null}
      {block.next?.length ? <Lines label="Next" items={block.next} icon="target" /> : null}
      {block.kind === "draft" && block.plan?.length ? <Lines label="First plan" items={block.plan} icon="target" /> : null}
      {block.kind === "draft" && block.permissions?.length ? <Lines label="May do without asking, once you start it" items={block.permissions} icon="check" /> : null}
      {block.kind !== "draft" && block.needs?.length ? <Lines label={block.kind === "stuck" ? "Options" : "Waiting on you"} items={block.needs} icon="clock" /> : null}
      {said ? <Text testID="goal-card-said" style={st.said}>{said}</Text> : (
        <CardActions
          {...(block.kind === "draft" && status === "draft" ? { primary: { label: "Start goal", testID: "goal-card-start", onPress: () => press("goals.confirm", {}, "Started. The lead agent researches first, then plans.") }, secondary: [{ label: "Open", onPress: () => openGoal?.(block.goalId) }] }
            : block.kind === "ended" && block.outcome === "missed" && status === "missed" ? { primary: { label: "Extend three days", testID: "goal-card-extend", onPress: () => press("goals.extend", { deadline: Math.max(Date.now(), live?.deadline ?? block.deadline) + 3 * 86_400_000 }, "Extended. Check-ins resume.") }, secondary: block.kind !== "draft" ? [{ label: "Open goal", onPress: () => openGoal?.(block.goalId), testID: "goal-card-goto" }] : [] }
            : block.kind !== "draft" ? { secondary: [{ label: "Open goal", onPress: () => openGoal?.(block.goalId), testID: "goal-card-goto" }] } : {})}
        />
      )}
    </Card>
    </View>
  );
}

function Lines({ label, items, icon }: { label: string; items: readonly string[]; icon: string }): ReactElement {
  return (
    <View style={st.lines}>
      <Text style={st.label}>{label}</Text>
      {items.map((t) => <Row key={t} id={`gl-${t.slice(0, 24)}`} title={t} leading={<View style={{ marginRight: 8 }}><Icon name={icon} color="var(--ink-4)" /></View>} />)}
    </View>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { color: "var(--ink)" as string, fontSize: 14.5, fontWeight: "600" },
  small: { color: "var(--ink-3)" as string, fontSize: 12, lineHeight: 17 },
  body: { color: "var(--ink-2)" as string, fontSize: 13, lineHeight: 19 },
  num: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 4 },
  big: { color: "var(--ink)" as string, fontSize: 26, fontWeight: "600", fontVariant: ["tabular-nums"] },
  of: { color: "var(--ink-3)" as string, fontSize: 14, fontVariant: ["tabular-nums"] },
  lines: { marginTop: 2 },
  label: { color: "var(--ink-3)" as string, fontSize: 11.5, fontWeight: "600", marginTop: 6 },
  said: { color: "var(--ok)" as string, fontSize: 12.5, marginTop: 4 },
});
