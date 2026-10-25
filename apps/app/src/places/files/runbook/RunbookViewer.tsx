// The runbook viewer (spec 2.16 Runbooks, 3.5 Files > run a runbook; screen files.runbook-viewer). A markdown note whose fenced sh or bash blocks can run:
//   - a "Runs on" bar: the Space server or an agent computer (saved with the file, not in its bytes), and Run all (Stop · block 2 of 4 while it goes);
//   - each block: its language, a quiet Run button (accent on hover, or once it has run), the code, and under it the output as it streams, "Exit 0 · 14.2 s", who, where and when;
//   - right-click a block: Run, Copy Command, Show or Hide Output, Clear Output; the chevron under the block folds its output;
//   - Run all stops at the first error and says where; every run is kept under Runs.
// Reads are four live queries over the kept copy (runbooks.parse, runs.list, targets, runs.get). Writes: runbooks.run, runbooks.set_target, runs.stop.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { runAll, runBlock, setTarget, stopRun } from "./actions.ts";
import type { Result } from "./actions.ts";
import { useRunbookData, useRunbookQuery } from "./data.tsx";
import { Glyph } from "./icons.tsx";
import { Prose } from "./Prose.tsx";
import { RunsList } from "./RunbookHistory.tsx";
import {
  SERVER, activeAll, allSummary, blockIds, fmtDuration, fmtTime, hasOutputPanel, highlight, isActive, latestByBlock, outputText, progressLine, runnableCount, sameTarget, splitRunbook, statusWords, targetName,
} from "./model.ts";
import type { BlockRow, BlockStatus, Parse, RunRow, Segment, Target, TargetRow, Tok } from "./model.ts";
import { Dot, OutputPre, Spinner, Tile, webProps } from "./parts.tsx";

type Targets = CapMap["runbooks.targets"]["out"];
type RunsOut = CapMap["runbooks.runs.list"]["out"];
type GetOut = CapMap["runbooks.runs.get"]["out"];

export interface RunbookViewerProps {
  fileId: string;
  versionId?: string;
  /** The note's markdown. The Files viewer passes the version it is showing. */
  text: string;
  /** Draw the Runs list under the note (default). The History tab of the viewer passes false and draws RunbookHistory itself. */
  withRuns?: boolean;
}

export function RunbookViewer({ fileId, versionId, text, withRuns = true }: RunbookViewerProps): ReactElement {
  const data = useRunbookData();
  const menu = useMenu();
  const q = useMemo(() => ({ fileId, ...(versionId ? { versionId } : {}) }), [fileId, versionId]);
  const blocksQ = useRunbookQuery<Parse>("blocks", q);
  const historyQ = useRunbookQuery<RunsOut>("history", { fileId });
  const targetsQ = useRunbookQuery<Targets>("targets");
  const segments = useMemo(() => splitRunbook(text), [text]);
  const count = runnableCount(segments);

  const [shut, setShut] = useState<Record<string, boolean>>({});
  const [cleared, setCleared] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [picked, setPicked] = useState<Target | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const blocks: BlockRow[] = blocksQ.status === "ready" ? blocksQ.data.blocks : [];
  const byIndex = new Map<number, BlockRow>();
  for (const b of blocks) byIndex.set(b.index, b);
  const order = blockIds(blocks);
  const runs: RunRow[] = historyQ.status === "ready" ? historyQ.data.runs : [];
  const targets: TargetRow[] = targetsQ.status === "ready" ? targetsQ.data.targets : [];
  const latest = latestByBlock(runs);
  const target: Target = picked ?? (blocksQ.status === "ready" ? blocksQ.data.runsOn : undefined) ?? SERVER;
  const where = targetName(target, targets);
  const going = activeAll(runs);
  const anyActive = runs.some((r) => isActive(r.state));
  const newest = runs.length ? [...runs].sort((a, b) => b.at - a.at)[0] : undefined;
  const summary = newest ? allSummary(newest, order, targetName(newest.target, targets)) : null;
  const failedSummary = newest !== undefined && newest.blocks.some((b) => b.state === "failed");
  const c = data.clock();

  const say = (r: Result): void => setNotice(r.ok ? null : r.error);

  const run = (b: BlockRow): void => {
    setNotice(null);
    setBusy((x) => ({ ...x, [b.blockId]: true }));
    void runBlock(data.call, { fileId, blockId: b.blockId, target, ...(versionId ? { versionId } : {}), at: data.clock().now }).then((r) => {
      setBusy((x) => ({ ...x, [b.blockId]: false }));
      setShut((x) => ({ ...x, [b.blockId]: false }));
      say(r);
    });
  };
  const runEverything = (): void => {
    setNotice(null);
    void runAll(data.call, { fileId, target, ...(versionId ? { versionId } : {}), at: data.clock().now }).then(say);
  };
  const stop = (runId: string): void => void stopRun(data.call, runId).then(say);

  const chooseTarget = (t: Target): void => {
    setPicked(t);
    void setTarget(data.call, fileId, t).then((r) => { if (!r.ok) { setPicked(null); say(r); } });
  };
  const whereMenu = (e: unknown): void => {
    const ev = e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } }; nativeEvent?: { pageX?: number; pageY?: number } };
    const box = ev.currentTarget?.getBoundingClientRect?.();
    const x = box ? box.left : ev.nativeEvent?.pageX ?? 0;
    const y = box ? box.bottom + 4 : ev.nativeEvent?.pageY ?? 0;
    const computers = targets.filter((t) => t.target.kind === "computer");
    const items: MenuEntry[] = [{ label: "Space server", checked: sameTarget(target, SERVER), onSelect: () => chooseTarget(SERVER) }];
    if (computers.length) {
      items.push({ separator: true }, { head: "An agent's computer" });
      for (const t of computers) items.push({ label: t.online ? t.name : `${t.name} (offline)`, checked: sameTarget(target, t.target), ...(t.online ? { onSelect: () => chooseTarget(t.target) } : {}) });
    }
    menu.show(items, x, y, "other");
  };

  const blockMenu = (b: BlockRow | undefined, code: string, s: BlockStatus | undefined, x: number, y: number): void => {
    const items: MenuEntry[] = [];
    if (b) items.push({ label: "Run", onSelect: () => run(b) });
    items.push({ label: "Copy Command", onSelect: () => data.copy(code) });
    if (b && s && hasOutputPanel(s)) {
      const hidden = shut[b.blockId] === true;
      const id = b.blockId;
      const runId = s.runId;
      items.push({ separator: true }, { label: hidden ? "Show Output" : "Hide Output", onSelect: () => setShut((m) => ({ ...m, [id]: !hidden })) }, { label: "Clear Output", onSelect: () => setCleared((m) => ({ ...m, [id]: runId })) });
    }
    menu.show(items, x, y, "context");
  };

  const pieces: ReactElement[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] as Segment;
    if (seg.kind === "prose") { pieces.push(<Prose key={i} text={seg.text} />); continue; }
    const b = seg.runIndex === null ? undefined : byIndex.get(seg.runIndex);
    const s = b ? latest.get(b.blockId) : undefined;
    const shown = s !== undefined && b !== undefined && cleared[b.blockId] !== s.runId ? s : undefined;
    pieces.push(
      <CodeBlock
        key={i}
        lang={seg.lang}
        code={seg.code}
        runnable={seg.runIndex !== null}
        number={seg.runIndex === null ? null : seg.runIndex + 1}
        block={b}
        status={shown}
        shut={b ? shut[b.blockId] === true : false}
        busy={b ? busy[b.blockId] === true : false}
        where={shown ? targetName(shown.target, targets) : where}
        now={c.now}
        offsetMin={c.offsetMin}
        onRun={() => { if (b) run(b); }}
        onStop={() => { if (shown) stop(shown.runId); }}
        onToggle={() => { if (b) setShut((x) => ({ ...x, [b.blockId]: !x[b.blockId] })); }}
        onMenu={(x, y) => blockMenu(b, seg.code, shown, x, y)}
      />,
    );
  }

  return (
    <View style={st.page} testID="runbook-viewer">
      {count > 0 ? (
        <View style={st.bar} testID="runbook-bar">
          <Text style={st.barLabel}>Runs on</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Runs on ${where}`} onPress={whereMenu} testID="runbook-where" style={st.where} {...webProps({ "aria-haspopup": "menu", title: "Where the commands run" })}>
            {target.kind === "server" ? <Glyph name="server" size={14} /> : <Tile name={where} size={16} />}
            <Text numberOfLines={1} style={st.whereText}>{where}</Text>
            <Glyph name="chevd" size={11} />
          </Pressable>
          <View style={st.grow} />
          {going ? (
            <Pressable accessibilityRole="button" accessibilityLabel={progressLine(going, order)} onPress={() => stop(going.runId)} testID="runbook-stop-all" style={st.hm}>
              <Glyph name="stop" size={11} color="var(--ink-2)" />
              <Text style={st.hmText}>{progressLine(going, order)}</Text>
            </Pressable>
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel="Run all" accessibilityState={{ disabled: anyActive || blocks.length === 0 }} disabled={anyActive || blocks.length === 0} onPress={runEverything} testID="runbook-run-all" style={[st.hm, (anyActive || blocks.length === 0) && st.dim]}>
              <Glyph name="play" size={11} color="var(--ink-2)" />
              <Text style={st.hmText}>Run all</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <Text style={st.quiet} testID="runbook-empty">No shell blocks in this file</Text>
      )}
      {notice ? <Text accessibilityRole="alert" role="alert" style={st.notice} testID="runbook-notice">{notice}</Text> : null}
      {summary && count > 0 ? <Text accessibilityRole="summary" style={[st.summary, failedSummary && st.summaryBad]} testID="runbook-summary">{summary}</Text> : null}

      {pieces}

      {withRuns && runs.length ? (
        <View style={st.runs}>
          <Text accessibilityRole="header" style={st.runsHead}>Runs</Text>
          <RunsList runs={runs} order={order} targets={targets} />
        </View>
      ) : null}
      {menu.element}
    </View>
  );
}

// ---------------------------------------------------------------- one block

interface CodeBlockProps {
  lang: string;
  code: string;
  runnable: boolean;
  number: number | null;
  block: BlockRow | undefined;
  status: BlockStatus | undefined;
  shut: boolean;
  busy: boolean;
  where: string;
  now: number;
  offsetMin: number;
  onRun(): void;
  onStop(): void;
  onToggle(): void;
  onMenu(x: number, y: number): void;
}

const TOK_COLOR: Record<Tok["kind"], string> = { k: "var(--accent)", s: "var(--ok)", c: "var(--ink-3)", t: "var(--ink)" };

function CodeBlock(p: CodeBlockProps): ReactElement {
  const [over, setOver] = useState(false);
  const active = p.status !== undefined && isActive(p.status.state);
  const lines = p.code.split("\n");
  const warm = over || p.status !== undefined;
  const codeLines: ReactElement[] = [];
  for (let i = 0; i < lines.length; i++) {
    const toks: ReactElement[] = [];
    const parts = highlight(lines[i] as string);
    for (let j = 0; j < parts.length; j++) {
      const t = parts[j] as Tok;
      toks.push(<Text key={j} style={{ color: TOK_COLOR[t.kind] as string }}>{t.text}</Text>);
    }
    codeLines.push(<Text key={i}>{toks}{i < lines.length - 1 ? "\n" : ""}</Text>);
  }
  return (
    <Pressable
      accessible={false}
      onHoverIn={() => setOver(true)}
      onHoverOut={() => setOver(false)}
      style={st.block}
      testID={p.block ? `block-${p.block.blockId}` : "block-plain"}
      {...menuTrigger(p.onMenu)}
    >
      <View style={st.blockHead}>
        <Text style={st.lang}>{p.lang || "text"}</Text>
        <View style={st.grow} />
        {p.runnable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={active ? "Stop" : `Run block ${p.number ?? ""}`.trim()}
            accessibilityState={{ disabled: p.block === undefined || p.busy }}
            disabled={p.block === undefined || p.busy}
            onPress={active ? p.onStop : p.onRun}
            testID={p.block ? `run-${p.block.blockId}` : "run-pending"}
            style={[st.runBtn, (p.block === undefined || p.busy) && st.dim]}
            {...webProps({ title: active ? "Stop" : `Run on ${p.where}` })}
          >
            <Glyph name={active ? "stop" : "play"} size={10} color={warm ? "var(--accent)" : "var(--ink-3)"} />
            <Text style={[st.runText, warm && st.runTextWarm]}>{active ? "Stop" : "Run"}</Text>
          </Pressable>
        ) : null}
      </View>
      <Text selectable style={st.code} testID="block-code">{codeLines}</Text>
      {p.status && p.block ? <BlockOutput blockId={p.block.blockId} status={p.status} shut={p.shut} where={p.where} now={p.now} offsetMin={p.offsetMin} onToggle={p.onToggle} /> : null}
    </Pressable>
  );
}

function BlockOutput({ blockId, status, shut, where, now, offsetMin, onToggle }: { blockId: string; status: BlockStatus; shut: boolean; where: string; now: number; offsetMin: number; onToggle: () => void }): ReactElement {
  const panel = hasOutputPanel(status);
  const out = useRunbookQuery<GetOut>("output", { runId: status.runId, blockId }, panel && !shut);
  const words = statusWords(status);
  if (!panel) return <Text style={st.skipped} testID={`output-${blockId}`}>{words.text}</Text>;
  const text = out.status === "ready" ? outputText(out.data.output, blockId) : "";
  return (
    <View style={st.out} testID={`output-${blockId}`}>
      <View style={st.outHead}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${shut ? "Show" : "Hide"} output`} aria-expanded={!shut} onPress={onToggle} testID={`toggle-${blockId}`} style={st.tog}>
          <Glyph name={shut ? "chevr" : "chevd"} size={12} />
        </Pressable>
        <View style={st.statusWrap} accessibilityRole="status">
          {words.tone === "run" ? <Spinner size={12} /> : <Dot tone={words.tone} />}
          <Text style={[st.statusText, words.tone === "bad" && st.statusBad]}>{words.text}</Text>
          {status.ms !== undefined && words.tone !== "run" ? <Text style={st.statusMs}>{fmtDuration(status.ms)}</Text> : null}
        </View>
        <View style={st.grow} />
        <View style={st.who}>
          <Tile name={status.by} size={14} />
          <Text numberOfLines={1} style={st.whoText}>{`${where} · ${fmtTime(status.at, now, offsetMin)}`}</Text>
        </View>
      </View>
      {shut ? null : <OutputPre text={text} follow={status.state === "running"} testID={`output-text-${blockId}`} />}
    </View>
  );
}

const st = StyleSheet.create({
  page: { width: "100%", maxWidth: 720 },
  bar: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 18, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  barLabel: { fontSize: 12.5, color: "var(--ink-3)" as string },
  where: { height: 28, paddingHorizontal: 8, borderRadius: 6, flexDirection: "row", alignItems: "center", gap: 7, maxWidth: 260 },
  whereText: { flexShrink: 1, fontSize: 12.5, fontWeight: "500", color: "var(--ink)" as string },
  grow: { flex: 1 },
  hm: { height: 28, paddingHorizontal: 8, borderRadius: 7, flexDirection: "row", alignItems: "center", gap: 6 },
  hmText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  dim: { opacity: 0.35 },
  quiet: { fontSize: 12.5, color: "var(--ink-3)" as string, marginBottom: 14 },
  notice: { fontSize: 12.5, lineHeight: 18, color: "var(--danger)" as string, marginBottom: 10 },
  summary: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string, marginBottom: 10 },
  summaryBad: { color: "var(--warn)" as string },
  block: { marginTop: 10, marginBottom: 16, borderRadius: 10, backgroundColor: "var(--sunk)" as string, overflow: "hidden" },
  blockHead: { flexDirection: "row", alignItems: "center", minHeight: 30, paddingLeft: 14, paddingRight: 6 },
  lang: { fontFamily: "var(--mono)" as string, fontSize: 11, color: "var(--ink-3)" as string },
  runBtn: { height: 24, paddingHorizontal: 9, borderRadius: 6, flexDirection: "row", alignItems: "center", gap: 6 },
  runText: { fontSize: 12, fontWeight: "500", color: "var(--ink-3)" as string },
  runTextWarm: { color: "var(--accent)" as string },
  code: { fontFamily: "var(--mono)" as string, fontSize: 12.5, lineHeight: 20, color: "var(--ink)" as string, paddingHorizontal: 16, paddingBottom: 14 },
  out: { borderTopWidth: 1, borderTopColor: "var(--line)" as string, backgroundColor: "var(--win)" as string },
  outHead: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32, paddingLeft: 6, paddingRight: 12 },
  tog: { width: 24, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  statusWrap: { flexDirection: "row", alignItems: "center", gap: 7 },
  statusText: { fontSize: 12, color: "var(--ink-2)" as string },
  statusBad: { color: "var(--danger)" as string },
  statusMs: { fontSize: 12, color: "var(--ink-3)" as string },
  who: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1, minWidth: 0 },
  whoText: { flexShrink: 1, fontSize: 12, color: "var(--ink-3)" as string },
  skipped: { paddingHorizontal: 14, paddingBottom: 10, fontSize: 12, color: "var(--ink-3)" as string },
  runs: { marginTop: 8 },
  runsHead: { marginHorizontal: 8, marginBottom: 4, fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
});
