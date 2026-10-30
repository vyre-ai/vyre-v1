// The run chat (spec 2.13, 3.7): one chat per Run. The Run's thread is its log, drawn by RunLines. Above it, the state of the run, when it started and how long it took, the version it
// pinned; Stop while it works, Replay on the same or the current version, and Undo this run, which shows what would be reversed and what cannot be before it does anything.
// Below it, a box to ask about the run or tell an agent what to do. In the side pane it carries the Automation's name and Open in Main; in Main it carries the page header.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { CHAT, useRunsData, useScreenQuery, useThread } from "./data.tsx";
import { decideTask, isActive, postToRun, pressPoint, previewUndo, undoRun, useRunActions } from "./actions.tsx";
import { Glyph } from "./glyphs.tsx";
import { STATUS_WORD, buildLines, durationSeconds, failedStep, runTitle, stamp, waitWords } from "./model.ts";
import type { Run, RunLine, RunStep, ThreadMessage, UndoPreview } from "./model.ts";
import { MainHead, QuietButton, Tile, pointer, statusColor, statusGlyph, webOnly } from "./parts.tsx";
import type { KeyEventLike } from "./parts.tsx";
import { LiveRerun } from "./LiveRerun.tsx";
import { SANDBOX_REPLAY_LABEL } from "./ledger.ts";
import { RunLineage } from "./RunLineage.tsx";
import type { LineageChild } from "./lineage.ts";
import { RunLines } from "./RunLines.tsx";
import { UndoPanel } from "./RunUndo.tsx";
import { each } from "./each.ts";

type GetOut = CapMap["runs.get"]["out"];
type StepsOut = CapMap["runs.steps"]["out"];

export interface RunChatProps {
  runId: string;
  /** In Main (the page header and a wider column) rather than the side pane. */
  wide?: boolean;
  /** Retried runs, so a failed run nobody retried shows Retry (the history passes what it knows). */
  retriedIds?: ReadonlySet<string>;
  openThoughts?: readonly string[];
  /** Open Undo this run at first render (a link from the Needs you row, and the screenshots). */
  initialUndo?: boolean;
  /** Child runs the parent already loaded. Omit when none were loaded. Empty stays empty. */
  childLinks?: readonly LineageChild[];
}

type UndoState = { phase: "loading" } | { phase: "ready"; preview: UndoPreview } | null;
const EMPTY: readonly string[] = [];
const NONE: ReadonlySet<string> = new Set();

export function RunChat({ runId, wide = false, retriedIds = NONE, openThoughts = EMPTY, initialUndo = false, childLinks = [] }: RunChatProps): ReactElement {
  const data = useRunsData();
  const actions = useRunActions();
  const { element, show } = useMenu();
  const q = useScreenQuery<GetOut>(CHAT, "run", { runId });
  const stepsQ = useScreenQuery<StepsOut>(CHAT, "steps", { runId });
  const run: Run | undefined = q.status === "ready" ? q.data.run : undefined;
  const threadQ = useThread<{ messages: readonly ThreadMessage[] }>(run?.threadId);
  const [undo, setUndo] = useState<UndoState>(null);
  const [results, setResults] = useState<readonly RunLine[]>([]);
  const [draft, setDraft] = useState("");
  const [retried, setRetried] = useState(false);
  const sent = useRef(0);
  const now = data.clock().now;
  useEffect(() => {
    if (!initialUndo) return;
    setUndo({ phase: "loading" });
    void previewUndo(data, runId).then((p) => setUndo({ phase: "ready", preview: p })).catch(() => setUndo(null));
  }, [initialUndo, runId, data]);

  if (q.status === "loading") {
    return <View testID="run-chat-loading" style={s.frame}><View style={s.skHead} /><View style={s.skBody}>{each([0, 1, 2, 3], (i) => <View key={i} style={s.skLine} />)}</View></View>;
  }
  if (!run) return <View testID="run-chat-gone" style={s.frame}><View style={s.gone}><Text style={s.goneText}>That run is gone.</Text></View></View>;

  const steps: readonly RunStep[] = stepsQ.status === "ready" ? stepsQ.data.steps : [];
  const messages = threadQ.status === "ready" ? threadQ.data.messages : [];
  const lines: RunLine[] = [...buildLines(run, messages, steps), ...results];
  const automation = run.subject?.type === "automation" ? run.subject.id : null;
  const automationName = automation ? data.name(automation) : run.name ?? "Run";
  const canRetry = !retried && !retriedIds.has(run.id);
  const duration = durationSeconds(run);

  const failStep = failedStep(lines, steps);
  const openUndo = async (): Promise<void> => {
    setUndo({ phase: "loading" });
    try { setUndo({ phase: "ready", preview: await previewUndo(data, run.id) }); } catch (e) { setUndo(null); actions.say(e instanceof Error ? e.message : "That did not work."); }
  };
  const doUndo = async (): Promise<void> => {
    try {
      const done = await undoRun(data, run.id);
      setResults((cur) => [...cur, { kind: "stat", id: `undo-${cur.length}`, text: done.text }]);
      setUndo(null);
    } catch (e) { setUndo(null); actions.say(e instanceof Error ? e.message : "That did not work."); }
  };
  const replayMenu = (x: number, y: number): void => show([
    { head: "Replay in the sandbox" },
    { label: run.definitionVersion ? `Replay on the same version (v${run.definitionVersion})` : "Replay on the same version", onSelect: () => void actions.replay(run, "same") },
    { label: "Replay on the current version", onSelect: () => void actions.replay(run, "current") },
  ], x, y, "other");
  const decide = (taskId: string, action: "approve" | "reject"): void => {
    void decideTask(data, taskId, action).then(actions.say).catch((e: unknown) => actions.say(e instanceof Error ? e.message : "That did not work."));
  };
  const send = (): void => {
    const body = draft.trim();
    if (!body || !run.threadId) return;
    sent.current += 1;
    setDraft("");
    void postToRun(data, run, body, `${sent.current}-${now}`).catch((e: unknown) => { setDraft(body); actions.say(e instanceof Error ? e.message : "That did not work."); });
  };

  const stateBar = (
    <View style={s.rhead} testID="run-state">
      <View style={s.state}>
        <Glyph name={statusGlyph(run.status)} size={13} color={statusColor(run.status)} />
        <Text style={s.stateText}>{run.status === "waiting" ? waitWords(run.waitReason) : STATUS_WORD[run.status]}</Text>
      </View>
      {run.kind === "automation_test" ? <View style={s.chip}><Glyph name="flask" size={12} color="var(--ink-2)" /><Text style={s.chipText}>Test, nothing sent</Text></View> : null}
      <Text style={s.when}>{`${stamp(run.startedAt, now)}${duration !== null && run.status !== "running" ? `, ${duration} s` : ""}`}</Text>
      {run.definitionVersion !== undefined ? <Text style={s.ver}>{`v${run.definitionVersion}`}</Text> : null}
      <View style={{ flex: 1 }} />
      {isActive(run) ? <QuietButton label="Stop" icon="stop" tone="danger" testID="stop-run" onPress={(e) => { const p = pressPoint(e); show([{ head: "Stop this run?" }, { label: "Stop", danger: true, onSelect: () => void actions.stop(run) }, { label: "Cancel" }], p.x, p.y, "other"); }} /> : null}
      {!isActive(run) ? <QuietButton label={SANDBOX_REPLAY_LABEL} icon="retry" testID="replay-run" onPress={(e) => { const p = pressPoint(e); replayMenu(p.x, p.y); }} /> : null}
      {!isActive(run) ? <LiveRerun run={run} stepKeys={steps.map((step) => step.step)} /> : null}
      {!isActive(run) ? <QuietButton label="Undo this run" icon="undo" testID="undo-run" onPress={() => void openUndo()} /> : null}
    </View>
  );

  const undoPanel = undo ? <UndoPanel state={undo.phase === "loading" ? { phase: "loading" } : { phase: "ready", preview: undo.preview }} onConfirm={() => void doUndo()} onCancel={() => setUndo(null)} /> : null;

  const body = (
    <>
      {stateBar}
      <RunLineage parentRun={run.parentRun} steps={steps} children={childLinks} />
      <ScrollView style={s.scroll} contentContainerStyle={[s.scrollIn, wide && s.scrollWide]}>
        <RunLines
          run={run} lines={lines} me={data.me.id} name={(w) => data.name(w.id)} canRetry={canRetry} openThoughts={openThoughts}
          actions={{
            retryStep: () => void actions.retry(run, failStep).then((id) => id && setRetried(true)), skipStep: () => void actions.skipStep(run).then((id) => id && setRetried(true)), editStep: (step) => { if (automation) data.nav.openAutomation(automation, step); }, stopRun: () => void actions.stop(run),
            copyTrace: () => actions.copy(run.traceId, "the trace id"), replayMenu, decide,
          }}
        />
      </ScrollView>
      {undoPanel}
      {actions.note ? <Text style={s.note} accessibilityLiveRegion="polite" testID="run-note">{actions.note}</Text> : null}
      <View style={[s.rin, wide && s.rinWide]}>
        <TextInput
          accessibilityLabel="Message in this run" testID="run-input" value={draft} onChangeText={setDraft} multiline
          placeholder="Ask about this run, or tell an agent what to do" placeholderTextColor="var(--ink-4)" style={s.input}
          {...webOnly({ onKeyDown: (e: KeyEventLike) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault?.(); send(); } } })}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Send" accessibilityState={{ disabled: !draft.trim() }} testID="run-send" onPress={send} {...webOnly({ title: "Send" })} style={[s.send, !draft.trim() && { opacity: 0.35 }, pointer]}>
          <Glyph name="up" size={15} color="var(--accent-ink)" />
        </Pressable>
      </View>
      {element}
    </>
  );

  return (
    <View testID="run-chat" accessibilityLabel={`Run chat, ${runTitle(run)}`} style={s.frame}>
      {wide ? (
        <MainHead tile={<Tile size={28} />} title={automationName} meta={runTitle(run)}>
          {automation ? <QuietButton label="Open the automation" icon="open" testID="open-automation" onPress={() => data.nav.openAutomation(automation)} /> : null}
        </MainHead>
      ) : (
        <View style={s.ph}>
          <Tile size={30} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={2} style={s.phName}>{automationName}</Text>
            <Text numberOfLines={1} style={s.phSub}>{runTitle(run)}</Text>
          </View>
          <QuietButton label="Open in Main" icon="open" testID="open-main" onPress={() => data.nav.openRun(run.id)} />
        </View>
      )}
      {body}
    </View>
  );
}

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const s = StyleSheet.create({
  frame: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  ph: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 14, paddingBottom: 12, paddingLeft: 16, paddingRight: 14 },
  phName: { fontSize: 14, lineHeight: 18, fontWeight: "600", color: "var(--ink)" as string },
  phSub: { fontSize: 12, lineHeight: 16, color: "var(--ink-3)" as string },
  rhead: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 6, paddingBottom: 10, paddingHorizontal: 16, flexWrap: "wrap" },
  state: { flexDirection: "row", alignItems: "center", gap: 6 },
  stateText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  chip: { flexDirection: "row", alignItems: "center", gap: 5 },
  chipText: { fontSize: 12, color: "var(--ink-2)" as string },
  when: { fontSize: 12.5, color: "var(--ink-3)" as string },
  ver: { fontSize: 11.5, color: "var(--ink-3)" as string, fontFamily: MONO },
  scroll: { flex: 1, minHeight: 0 },
  scrollIn: { paddingTop: 4, paddingBottom: 12, paddingHorizontal: 16 },
  scrollWide: { paddingTop: 12, paddingBottom: 20, width: "100%", maxWidth: 820, alignSelf: "center" },
  note: { fontSize: 12, color: "var(--ink-2)" as string, paddingVertical: 8, paddingHorizontal: 16 },
  rin: { marginHorizontal: 14, marginBottom: 14, position: "relative" },
  rinWide: { width: "100%", maxWidth: 820, alignSelf: "center", marginHorizontal: 0, paddingHorizontal: 16 },
  input: { minHeight: 40, maxHeight: 120, borderRadius: 20, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line-2)" as string, color: "var(--ink)" as string, fontSize: 13, lineHeight: 18, paddingTop: 10, paddingBottom: 10, paddingLeft: 16, paddingRight: 46, ...({ outlineStyle: "none", outlineWidth: 0 } as object) },
  send: { position: "absolute", right: 5, top: 5, width: 30, height: 30, borderRadius: 15, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center" },
  skHead: { height: 60, margin: 14, borderRadius: 9, backgroundColor: "var(--sunk)" as string },
  skBody: { paddingHorizontal: 16, gap: 12 },
  skLine: { height: 26, borderRadius: 7, backgroundColor: "var(--sunk)" as string },
  gone: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  goneText: { fontSize: 13, color: "var(--ink-3)" as string },
});
