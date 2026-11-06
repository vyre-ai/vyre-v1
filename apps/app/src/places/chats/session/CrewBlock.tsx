// The crew in a long session (prototype t-session): one compact block instead of a card per helper. A header with how many and how they stand, then one 36 px row per helper: a face, its name, what it was asked, one
// word of status and a clock. A row opens in place to the helper's last three steps; its name opens the helper's pane. Same data and the same test ids as the crew strip (crew/strip.tsx), no rings and no boxes.
import { createElement, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { injectCss } from "../../../../../../ui/src/theme/css.ts";
import { Glyph } from "../conversation/parts.tsx";
import { stepsOf } from "../crew/pane.tsx";
import type { HelperStep } from "../crew/pane.tsx";
import { stripTone, faceSeed } from "../crew/model.ts";
import type { CrewMember, CrewTotals } from "../crew/model.ts";
import { useNow } from "../crew/strip.tsx";
import { durationWords } from "../../../../../../lib/duration.ts";
import type { Call } from "../crew/status.ts";

const web = Platform.OS === "web";
const CSS = [
  "@keyframes vy-cb-spin{to{transform:rotate(360deg)}}",
  ".vy-cb-spin{width:10px;height:10px;border-radius:50%;border:1.5px solid var(--accent);border-right-color:transparent;animation:vy-cb-spin 1s linear infinite;display:inline-block;flex:none}",
  "@media (prefers-reduced-motion:reduce){.vy-cb-spin{animation:none}}",
].join("\n");

/** The header's one line: how many, who needs you, how long, in the app's duration words (never a clock). */
export function blockTitle(t: CrewTotals): string {
  if (t.members === 0) return "";
  const tail = t.elapsedMs > 0 ? ` · ${durationWords(t.elapsedMs)}` : "";
  if (t.working === 0 && t.needsYou === 0) return `${t.done} of ${t.members} done${t.failed > 0 ? ` · ${t.failed} failed` : ""}${t.stopped > 0 ? ` · ${t.stopped} stopped` : ""}${tail}`;
  return `${t.members === 1 ? "1 helper" : `${t.members} helpers`} · ${t.needsYou > 0 ? `${t.needsYou} needs you` : "working"}${tail}`;
}

/** What a row says on the right: one word. A spinner only while it works. */
export const statusWord = (s: CrewMember["state"]): string => (s === "working" ? "Working" : s === "needs_you" ? "Waiting on you" : s === "done" ? "Done" : s === "failed" ? "Failed" : "Stopped");

/** Who the row is: the helper's name and, beside it, what it was asked (when that is not the same words). */
export function whoOf(m: Pick<CrewMember, "name" | "title">): { name: string; task: string } {
  const name = m.name && m.name !== "" ? m.name : m.title;
  return { name, task: name === m.title ? "" : m.title };
}

/** The last three steps of a helper, read from its own chat while its row is open. */
export function useLastSteps(call: Call | undefined, member: Pick<CrewMember, "id" | "state">, open: boolean): HelperStep[] {
  const [steps, setSteps] = useState<HelperStep[]>([]);
  const live = member.state === "working" || member.state === "needs_you";
  useEffect(() => {
    if (!open || !call) return undefined;
    let dead = false;
    const read = (): void => {
      void Promise.resolve(call("chat.messages.list", { threadId: member.id })).then((r) => {
        if (dead) return;
        setSteps(stepsOf(((r as { messages?: Array<{ blocks: Array<{ id: string; type: string; data?: unknown; state?: string }> }> } | undefined)?.messages ?? []).flatMap((m) => m.blocks)).slice(-3));
      }, () => undefined);
    };
    read();
    const t = live ? setInterval(read, 2500) : undefined;
    (t as { unref?: () => void } | undefined)?.unref?.();
    return () => { dead = true; if (t) clearInterval(t); };
  }, [call, member.id, live, open]);
  return steps;
}

function Row({ m, now, call, selected, onPeek, onRetry }: { m: CrewMember; now: number; call: Call | undefined; selected: boolean; onPeek: (m: CrewMember) => void; onRetry?: ((m: CrewMember) => void) | undefined }): ReactElement {
  const [open, setOpen] = useState(false);
  const id = `crew-chip-${m.id}`;
  const { name, task } = whoOf(m);
  const steps = useLastSteps(call, m, open);
  const canRetry = (m.state === "failed" || m.state === "stopped") && onRetry !== undefined;
  const last = m.state === "working" || m.state === "needs_you" ? m.step : m.found;
  return (
    <View testID={id} {...(web ? { dataSet: { state: m.state } } : {})}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${name}${task ? `, ${task}` : ""}, ${statusWord(m.state)}`} testID={`${id}-toggle`} onPress={() => setOpen((o) => !o)} style={({ hovered }: { hovered?: boolean }) => [st.row, (hovered === true || selected) && st.hover]}>
        <Avatar name={name} seedId={faceSeed(m)} kind="agent" size={20} />
        <Pressable accessibilityRole="link" accessibilityLabel={`Open ${name}`} testID={`${id}-name`} onPress={() => onPeek(m)}><Text numberOfLines={1} style={st.name}>{name}</Text></Pressable>
        {task !== "" ? <Text numberOfLines={1} testID={`${id}-role`} style={st.task}>{task}</Text> : <View style={{ flex: 1 }} />}
        <View style={st.status}>
          {m.state === "working" && web ? createElement("span", { className: "vy-cb-spin", "aria-hidden": true, title: "Working" }) : null}
          <Text testID={`${id}-state`} style={[st.statusText, m.state === "needs_you" && st.wait]}>{statusWord(m.state)}</Text>
        </View>
        {canRetry ? <Pressable accessibilityRole="button" testID={`${id}-retry`} onPress={() => onRetry!(m)} style={st.retry}><Text style={st.retryText}>Retry</Text></Pressable> : <Text testID={`${id}-time`} style={st.time}>{m.state === "working" ? durationWords(Math.max(m.elapsedMs, now - m.startedAt)) : ""}</Text>}
      </Pressable>
      {open ? (
        <View testID={`${id}-steps`} style={st.steps}>
          {steps.length > 0
            ? steps.map((x) => <Text key={x.id} numberOfLines={1} style={st.step}>{x.title}{x.sub ? ` · ${x.sub}` : ""}</Text>)
            : last ? <Text numberOfLines={1} testID={`${id}-line`} style={st.step}>{last}</Text> : <Text style={st.step}>{m.state === "working" ? "Getting started" : "No steps kept"}</Text>}
          {steps.length > 0 && m.state === "done" && m.found ? <Text numberOfLines={2} testID={`${id}-line`} style={[st.step, st.found]}>{m.found}</Text> : null}
          <Pressable accessibilityRole="link" testID={`${id}-open`} onPress={() => onPeek(m)}><Text style={st.open}>Open in the pane</Text></Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function CrewBlock({ members, totals, call, selectedId, merge, onPeek, onStopAll, onOpenPane, onRetry }: {
  members: readonly CrewMember[]; totals: CrewTotals; call?: Call | undefined; selectedId?: string | null | undefined;
  merge?: { state: "working" | "ready" | "merged"; onReview(): void; onMerge(): void } | undefined;
  onPeek: (m: CrewMember) => void; onStopAll?: (() => void) | undefined; onOpenPane?: (() => void) | undefined; onRetry?: ((m: CrewMember) => void) | undefined;
}): ReactElement | null {
  const live = totals.working + totals.needsYou > 0;
  const now = useNow(live);
  const [reviewed, setReviewed] = useState(false);
  if (members.length === 0) return null;
  if (web) injectCss((globalThis as { document?: Parameters<typeof injectCss>[0] }).document, "vyre-crew-block", CSS);
  const tone = stripTone(totals);
  return (
    <View testID="crew-strip" accessibilityRole="summary" {...(web ? { dataSet: { tone } } : {})} style={st.block}>
      <View style={st.head}>
        <Text style={st.headLead}>Crew</Text>
        <Text numberOfLines={1} testID="crew-strip-title" style={st.headMeta}>{blockTitle(totals)}</Text>
        {merge && merge.state === "ready" ? (
          <>
            {reviewed ? <Text testID="crew-strip-reviewed" style={st.action}>Reviewed</Text> : <Pressable accessibilityRole="button" testID="crew-strip-review" onPress={() => { setReviewed(true); merge.onReview(); }}><Text style={st.action}>Review all</Text></Pressable>}
            <Pressable accessibilityRole="button" testID="crew-strip-merge" onPress={merge.onMerge}><Text style={[st.action, reviewed && st.primary]}>Merge</Text></Pressable>
          </>
        ) : null}
        {merge && merge.state === "merged" ? <Text testID="crew-strip-merged" style={st.action}>Merged</Text> : null}
        {live && onStopAll ? <Pressable accessibilityRole="button" testID="crew-strip-stop-all" onPress={onStopAll}><Text style={st.action}>Stop all</Text></Pressable> : null}
        {onOpenPane ? <Pressable accessibilityRole="button" accessibilityLabel="Open Crew" testID="crew-strip-pane" onPress={onOpenPane} style={st.pane}><Glyph name="pane" size={14} /></Pressable> : null}
      </View>
      {/* ui-rows-lint: not a list (the rows of one crew block: a face, a name, what it was asked, a status and a clock, drawn together as the prototype t-session shows them) */}
      {members.map((m) => <Row key={m.id} m={m} now={now} call={call} selected={selectedId === m.id} onPeek={onPeek} onRetry={onRetry} />)}
    </View>
  );
}

const st = StyleSheet.create({
  block: { marginVertical: 12, maxWidth: 660 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32, marginBottom: 4 },
  headLead: { fontSize: 13, fontWeight: "600", color: "var(--ink-2)" as string },
  headMeta: { flex: 1, minWidth: 0, fontSize: 12, color: "var(--ink-3)" as string },
  action: { fontSize: 12, color: "var(--ink-3)" as string },
  primary: { color: "var(--accent)" as string, fontWeight: "600" },
  pane: { height: 24, paddingHorizontal: 4, justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 36, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 12 },
  hover: { backgroundColor: "var(--hover)" as string },
  name: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  task: { flex: 1, minWidth: 0, fontSize: 13, color: "var(--ink-3)" as string },
  status: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusText: { fontSize: 12, color: "var(--ink-3)" as string },
  wait: { color: "var(--warn)" as string },
  time: { minWidth: 40, textAlign: "right", fontSize: 12, color: "var(--ink-4)" as string, fontVariant: ["tabular-nums"] },
  retry: { height: 24, paddingHorizontal: 8, borderRadius: 12, justifyContent: "center" },
  retryText: { fontSize: 12, fontWeight: "600", color: "var(--ink)" as string },
  steps: { gap: 4, marginLeft: 20, marginTop: 4, marginBottom: 8 },
  step: { fontSize: 13, lineHeight: 20, color: "var(--ink-2)" as string },
  found: { color: "var(--ink)" as string },
  open: { fontSize: 12, color: "var(--accent)" as string, marginTop: 4 },
});
