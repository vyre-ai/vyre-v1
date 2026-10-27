// The lines of a run chat (spec 2.13): the run thread as the prototype draws it. Plain steps are compact rows (an icon, one line, the time into the run); an agent step is a real turn with
// the agent's words, its thought (closed), what it did and skipped, and the key and model it ran on; an error row carries Retry step; a wait row carries Approve and Decline; a parallel
// branch is a side thread under a quiet rule. Nothing here calls a capability: the chat passes the actions in.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { pressPoint } from "./actions.tsx";
import { each } from "./each.ts";
import { Glyph, lineGlyph } from "./glyphs.tsx";
import { lineTime } from "./model.ts";
import type { Run, RunLine, Tone, Who } from "./model.ts";
import { Face, QuietButton, pointer, webOnly } from "./parts.tsx";

export interface LineActions {
  /** Retry from the step the error row names (or the failed step in the log). */
  retryStep(): void;
  skipStep(): void;
  editStep(step: string | undefined): void;
  stopRun(): void;
  copyTrace(): void;
  replayMenu(x: number, y: number): void;
  decide(taskId: string, action: "approve" | "reject"): void;
}

export interface LinesProps {
  run: Run;
  lines: readonly RunLine[];
  name(who: Who): string;
  me: string;
  actions: LineActions;
  /** The failed run can be retried: nobody retried it yet. */
  canRetry: boolean;
  /** Thought ids open at first render. */
  openThoughts?: readonly string[];
}

const TONE: Readonly<Record<Tone, string>> = { ok: "var(--ok)", wait: "var(--warn)", bad: "var(--danger)", muted: "var(--ink-3)" };

export function RunLines({ run, lines, name, me, actions, canRetry, openThoughts = [] }: LinesProps): ReactElement {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set(openThoughts));
  const toggle = (id: string): void => setOpen((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const lastError = [...lines].reverse().find((l) => l.kind === "error")?.id;
  const render = (l: RunLine): ReactElement => {
    switch (l.kind) {
      case "row":
        return (
          <View key={l.id} testID={`line-${l.id}`} style={c.rl}>
            <View style={c.ri}><Glyph name={lineGlyph(l.icon)} size={13} color={TONE[l.tone]} /></View>
            <View style={c.rb}><Text style={c.rbText}>{l.text}</Text>{l.retry ? <Text style={c.mono}>{l.retry}</Text> : null}</View>
            <Text style={c.tm}>{lineTime(l.offset, run)}</Text>
          </View>
        );
      case "turn":
      case "say": {
        const who = name(l.who);
        const turn = l.kind === "turn" ? l : null;
        return (
          <View key={l.id} testID={`line-${l.id}`} style={c.turn}>
            <Face name={who} seedId={l.who.id} kind={l.who.kind === "person" ? "person" : "agent"} size={24} />
            <View style={c.tb}>
              <View style={c.th}>
                <Text style={c.who}>{l.who.id === me ? "You" : who}</Text>
                {turn?.step ? <Text numberOfLines={1} style={c.stp}>{turn.step}</Text> : null}
                <View style={{ flex: 1 }} />
                <Text style={c.tmQuiet}>{l.offset > 0 ? `+${l.offset} s` : ""}</Text>
              </View>
              <Text style={c.tx}>{l.text}</Text>
              {turn?.thought ? (
                <View>
                  <Pressable accessibilityRole="button" accessibilityState={{ expanded: open.has(l.id) }} aria-expanded={open.has(l.id)} testID={`thought-${l.id}`} onPress={() => toggle(l.id)} style={[c.thoughtBtn, pointer]}>
                    <View style={open.has(l.id) ? c.rot : undefined}><Glyph name="chevR" size={9} color="var(--ink-3)" /></View>
                    <Text style={c.thoughtText}>Thought for {turn.thought.secs} s</Text>
                  </Pressable>
                  {open.has(l.id) ? <Text style={c.tq}>{turn.thought.text}</Text> : null}
                </View>
              ) : null}
              {turn && turn.did.length ? <View style={c.list}><Text style={c.listHead}>Did</Text>{each(turn.did, (x) => <Text key={x} style={c.li}>{`•  ${x}`}</Text>)}</View> : null}
              {turn && turn.skipped.length ? <View style={c.list}><Text style={[c.listHead, { color: "var(--ink-3)" as string }]}>Skipped</Text>{each(turn.skipped, (x) => <Text key={x} style={[c.li, { color: "var(--ink-3)" as string }]}>{`•  ${x}`}</Text>)}</View> : null}
              {turn && (turn.key || turn.model) ? (
                <View style={c.meta2}>
                  <Glyph name="key" size={12} color="var(--ink-3)" />
                  <Text style={c.meta2Text}>{`Ran on ${turn.key ?? "its key"}${turn.model ? `, ${turn.model}` : ""}`}</Text>
                  {turn.backup ? <View style={c.fb}><Glyph name="warn" size={12} color="var(--warn)" /><Text style={c.fbText}>{turn.backup}</Text></View> : null}
                </View>
              ) : null}
            </View>
          </View>
        );
      }
      case "join":
        return (
          <View key={l.id} testID={`line-${l.id}`} style={c.joinl}>
            <View style={c.rule} />
            <View style={c.jt}><Face name={name(l.who)} seedId={l.who.id} kind={l.who.kind === "person" ? "person" : "agent"} size={14} /><Text style={c.joinText}>{l.text}</Text></View>
            <View style={c.rule} />
          </View>
        );
      case "wait":
        return (
          <View key={l.id}>
            <View testID={`line-${l.id}`} style={c.rl}>
              <View style={c.ri}><Glyph name="hourglass" size={13} color="var(--warn)" /></View>
              <View style={c.rb}><Text style={c.rbText}>{l.text}</Text></View>
              <Text style={c.tm}>{lineTime(l.offset, run)}</Text>
            </View>
            {run.status === "waiting" && l.taskId ? (
              <View style={c.waitb}>
                <QuietButton label="Approve" icon="check" tone="filled" testID="approve" onPress={() => actions.decide(l.taskId!, "approve")} />
                <QuietButton label="Decline" testID="decline" onPress={() => actions.decide(l.taskId!, "reject")} />
              </View>
            ) : null}
          </View>
        );
      case "error":
        return (
          <View key={l.id} testID={`line-${l.id}`} style={c.rl}>
            <View style={c.ri}><Glyph name="x" size={13} color="var(--danger)" /></View>
            <View style={c.rb}>
              <Text style={c.errTitle}>{l.text}</Text>
              {l.detail ? <Text style={c.errDetail}>{l.detail}</Text> : null}
              {l.retry ? <Text style={c.mono}>{l.retry}</Text> : null}
              {run.status === "failed" && canRetry && l.id === lastError ? (
                <View style={c.acts}>
                  <QuietButton label="Retry step" icon="retry" tone="accent" testID="retry-step" onPress={actions.retryStep} />
                  <QuietButton label="Skip step" testID="skip-step" onPress={actions.skipStep} />
                </View>
              ) : null}
              <View style={c.errx}>
                <Text style={c.mono}>{run.traceId}</Text>
                <QuietButton label="Copy trace id" testID="copy-trace" onPress={actions.copyTrace} />
                <QuietButton label="Edit step" testID="edit-step" onPress={() => actions.editStep(l.step)} />
                <QuietButton label="Replay in sandbox" testID="replay" onPress={(e) => { const p = pressPoint(e); actions.replayMenu(p.x, p.y); }} />
              </View>
            </View>
            <Text style={c.tm}>{lineTime(l.offset, run)}</Text>
          </View>
        );
      case "stat":
        return <Text key={l.id} testID={`line-${l.id}`} style={c.statl}>{l.text}</Text>;
      case "branch":
        return (
          <View key={l.id} testID={`branch-${l.id}`} accessibilityLabel={`Side thread, ${l.label}`} style={c.branch}>
            <Text style={c.branchHead}>{l.label}</Text>
            {each(l.lines, render)}
          </View>
        );
    }
  };
  return (
    <View testID="run-lines" {...webOnly({ role: "log" })}>
      {each(lines, render)}
      {run.status === "running" ? (
        <View style={c.rl} testID="run-working"><View style={c.ri}><Glyph name="retry" size={13} color="var(--ink-3)" /></View><View style={c.rb}><Text style={[c.rbText, { color: "var(--ink-3)" as string }]}>Working…</Text></View></View>
      ) : null}
    </View>
  );
}

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const c = StyleSheet.create({
  rl: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 5, minHeight: 26 },
  ri: { width: 18, height: 18, alignItems: "center", justifyContent: "center" },
  rb: { flex: 1, minWidth: 0 },
  rbText: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-2)" as string },
  mono: { fontSize: 11.5, lineHeight: 16, color: "var(--ink-3)" as string, fontFamily: MONO },
  tm: { fontSize: 11.5, lineHeight: 18, color: "var(--ink-4)" as string },
  tmQuiet: { fontSize: 11.5, color: "var(--ink-4)" as string },
  turn: { flexDirection: "row", gap: 10, paddingTop: 10, paddingBottom: 8 },
  tb: { flex: 1, minWidth: 0 },
  th: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  who: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  stp: { fontSize: 12, color: "var(--ink-3)" as string, flexShrink: 1 },
  tx: { fontSize: 13, lineHeight: 20, color: "var(--ink)" as string, marginTop: 2 },
  thoughtBtn: { flexDirection: "row", alignItems: "center", gap: 5, height: 22 },
  thoughtText: { fontSize: 12, color: "var(--ink-3)" as string },
  rot: { transform: [{ rotate: "90deg" }] },
  tq: { fontSize: 12.5, lineHeight: 19, color: "var(--ink-3)" as string, paddingLeft: 14, marginLeft: 3, marginVertical: 2, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string },
  list: { marginTop: 2 },
  listHead: { fontSize: 12.5, lineHeight: 19, fontWeight: "500", color: "var(--ink-2)" as string },
  li: { fontSize: 12.5, lineHeight: 19, color: "var(--ink-2)" as string, paddingLeft: 4 },
  meta2: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 5, flexWrap: "wrap" },
  meta2Text: { fontSize: 11.5, color: "var(--ink-3)" as string },
  fb: { flexDirection: "row", alignItems: "center", gap: 4 },
  fbText: { fontSize: 11.5, color: "var(--warn)" as string },
  joinl: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  rule: { flex: 1, height: 1, backgroundColor: "var(--line)" as string },
  jt: { flexDirection: "row", alignItems: "center", gap: 6 },
  joinText: { fontSize: 12, color: "var(--ink-3)" as string },
  waitb: { marginLeft: 28, marginTop: 4, marginBottom: 6, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  errTitle: { fontSize: 12.5, lineHeight: 18, fontWeight: "500", color: "var(--danger)" as string },
  errDetail: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-2)" as string },
  acts: { flexDirection: "row", gap: 2, marginTop: 4, marginLeft: -9 },
  errx: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" },
  statl: { textAlign: "center", fontSize: 12, color: "var(--ink-3)" as string, paddingTop: 8, paddingBottom: 6 },
  branch: { marginVertical: 4, marginLeft: 8, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: "var(--line-2)" as string },
  branchHead: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string, paddingTop: 4 },
});
