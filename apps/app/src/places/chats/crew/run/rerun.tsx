// Save as agent, Run again and the compare (lane r42-subagents, r42-runtime slice 7: runs.node.save_as_agent, runs.node.rerun, runs.node.compare). A finished helper's work can become an agent, or be run again beside the first
// with a changed brief or another model; the two are read side by side. The runtime owns what is stored and who may; this draws and sends. Run again has no idempotency key (the runtime starts one per call), so a press in flight blocks
// the next. A refusal says why in plain words (reads.ts refusalWords).
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../../ui/src/Row/index.tsx";
import { Segmented } from "../../../../../../../ui/src/Segmented/index.tsx";
import { TextField } from "../../../../../../../ui/src/TextField/index.tsx";
import { accountName, modelName } from "../../../../../../../lib/model-names.ts";
import { money, span, tokens } from "../model.ts";
import { compareDiff, sideLabel, sideOpen } from "./model.ts";
import type { CompareSide } from "./model.ts";
import { readCompare, readMayAct, refusalWords } from "./reads.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;

/** What the saved agent got for tools, in the server's own words kept / narrowed / default; nothing said when the server did not say. */
export function toolsWords(carried: string | undefined): string {
  return carried === "kept"
    ? "It keeps the tools this helper had."
    : carried === "narrowed"
      ? "Some tools were removed."
      : carried === "default"
        ? "It starts with the default tools."
        : "";
}

/** The most the server takes in each field (the manifest's maxLength; a test reads them from the generated registry), so a field stops there and nothing is cut after the person has read it. */
export const LIMITS = { name: 60, role: 200, saveInstructions: 4000, rerunInstructions: 20000 } as const;

/** The first run and what was started again from it. Reads once, then every 5 s while a side is still going (or `refresh()` was asked), so a re-run fills in by itself and the reads stop when all are finished. */
export function useCompare(
  call: Call,
  runId: string | undefined,
  enabled: boolean,
): { sides: readonly CompareSide[]; refresh: () => void } {
  const [sides, setSides] = useState<readonly CompareSide[]>([]);
  const [tick, setTick] = useState(0);
  const busy = useRef(false);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    setSides([]);
  }, [runId]);
  useEffect(() => {
    if (!enabled || runId === undefined) return undefined;
    let dead = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = (): void => {
      if (busy.current) return;
      busy.current = true;
      void readCompare(call, runId).then((r) => {
        busy.current = false;
        if (dead) return;
        if (r === "absent") return;
        if (r === "failed") {
          timer = setTimeout(read, 10_000);
          return;
        }
        setSides(r);
        if (r.some(sideOpen)) timer = setTimeout(read, 5000);
      });
    };
    read();
    return () => {
      dead = true;
      busy.current = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [call, runId, enabled, tick]);
  return { sides, refresh };
}

type Cat = {
  accounts: Array<{
    ref: string;
    label: string;
    provider?: string;
    models: Array<{ model: string; available: boolean; tier?: string }>;
  }>;
  parent?: { provider?: string };
  policy?: string;
};

/** Whether this person may save the work as an agent, run it again or compare; unknown until read, and no for someone who only watches. */
export function useMayAct(call: Call, runId: string | undefined, enabled: boolean): boolean {
  const [may, setMay] = useState(false);
  useEffect(() => {
    setMay(false);
    if (!enabled || runId === undefined) return undefined;
    let dead = false;
    void readMayAct(call, runId).then((m) => {
      if (!dead) setMay(m);
    });
    return () => {
      dead = true;
    };
  }, [call, runId, enabled]);
  return may;
}

/** Run it again: the brief to edit (what the helper was told), and a model if another one should do it. Nothing changed means nothing to compare, so Run again waits for a change. */
export function RerunForm({
  call,
  runId,
  parentThreadId,
  agentId,
  brief,
  model,
  onStarted,
  onCancel,
}: {
  call: Call;
  runId: string;
  parentThreadId: string;
  agentId?: string | undefined;
  brief: string;
  model?: string | undefined;
  onStarted: () => void;
  onCancel: () => void;
}): ReactElement {
  const [text, setText] = useState(brief);
  const [pick, setPick] = useState<string | null>(null);
  const [cat, setCat] = useState<Cat | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const changed = text.trim() !== brief.trim() || (pick !== null && pick !== model);
  const choose = (): void => {
    setChoosing(true);
    void Promise.resolve(call("engine.helper_models", { threadId: parentThreadId, agentId })).then(
      (r) => setCat(r as Cat),
      () => setErr("The models could not be read. Try again."),
    );
  };
  const go = (): void => {
    if (inflight.current || !changed || text.trim() === "") return;
    inflight.current = true;
    setBusy(true);
    setErr(null);
    void Promise.resolve(
      call("runs.node.rerun", {
        runId,
        ...(text.trim() !== brief.trim() ? { instructions: text.trim() } : {}),
        ...(pick !== null && pick !== model ? { model: pick } : {}),
      }),
    ).then(
      () => {
        inflight.current = false;
        setBusy(false);
        onStarted();
      },
      (e: unknown) => {
        inflight.current = false;
        setBusy(false);
        setErr(refusalWords(e, "rerun"));
      },
    );
  };
  // the Space's rule for helper models: inside the provider the chat runs on, unless the agent may use any
  const keep = (provider?: string): boolean =>
    cat?.policy !== "same_provider" || !cat.parent?.provider || provider === cat.parent.provider;
  const choices = cat
    ? cat.accounts
        .filter((a) => keep(a.provider))
        .flatMap((a) =>
          a.models
            .filter((m) => m.available && m.model !== model)
            .map((m) => ({ account: a.label, model: m.model, tier: m.tier })),
        )
    : [];
  return (
    <View testID="rerun-form" style={st.form}>
      <Text style={st.formHead}>Run it again</Text>
      <TextField
        testID="rerun-brief"
        accessibilityLabel="Brief"
        value={text}
        onChangeText={setText}
        multiline
        numberOfLines={5}
        maxLength={LIMITS.rerunInstructions}
        style={st.area}
      />
      <View style={st.line}>
        <Text style={st.hint}>Runs on {modelName(pick ?? model ?? "") || "the same model"}</Text>
        {!choosing ? (
          <Pressable accessibilityRole="button" testID="rerun-model" onPress={choose} style={st.pill}>
            <Text style={st.pillText}>Another model</Text>
          </Pressable>
        ) : null}
      </View>
      {choosing && cat !== null ? (
        choices.length === 0 ? (
          <Text style={st.hint}>No other model is available right now.</Text>
        ) : (
          choices.map((c) => (
            <Row
              key={c.model}
              id={`rerun-pick-${c.model}`}
              title={modelName(c.model)}
              note={`${accountName(c.account)}${c.tier ? ` · ${c.tier}` : ""}`}
              onPress={() => {
                setPick(c.model);
                setChoosing(false);
              }}
            />
          ))
        )
      ) : null}
      <Text style={st.hint}>The first result stays. You will see the two side by side.</Text>
      {err ? (
        <Text testID="rerun-error" style={st.err}>
          {err}
        </Text>
      ) : null}
      <View style={st.line}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || !changed }}
          testID="rerun-go"
          onPress={go}
          style={[st.pill, st.pillOn, (busy || !changed) && st.off]}
        >
          <Text style={[st.pillText, st.pillOnText]}>{busy ? "Starting" : "Run again"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" testID="rerun-cancel" onPress={onCancel} style={st.pill}>
          <Text style={st.pillText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Save as an agent: a name, a line on what it does, who can use it. The brief, model and tools it ran with come along on the runtime's side. */
export function SaveAgentForm({
  call,
  runId,
  name: initial,
  role: initialRole,
  instructions: initialText,
  onSaved,
  onCancel,
}: {
  call: Call;
  runId: string;
  name: string;
  role: string;
  /** What the agent will be told, from now on: the brief the work ran with. Shown and editable, because it may carry words the agent that started the work wrote. */
  instructions: string;
  onSaved: (name: string, tools: string | undefined) => void;
  onCancel: () => void;
}): ReactElement {
  const [name, setName] = useState(initial);
  const [role, setRole] = useState(initialRole);
  const [text, setText] = useState(initialText);
  const [sharing, setSharing] = useState<"me" | "everyone">("me");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const go = (): void => {
    const n = name.trim();
    if (inflight.current || n === "" || text.trim() === "") return;
    inflight.current = true;
    setBusy(true);
    setErr(null);
    void Promise.resolve(
      call("runs.node.save_as_agent", {
        runId,
        name: n,
        ...(role.trim() !== "" ? { role: role.trim() } : {}),
        ...(text.trim() !== initialText.trim() ? { instructions: text.trim() } : {}),
        sharing,
      }),
    ).then(
      (out) => {
        inflight.current = false;
        setBusy(false);
        const t = (out as { toolsCarried?: unknown } | null)?.toolsCarried;
        onSaved(n, typeof t === "string" ? t : undefined);
      },
      (e: unknown) => {
        inflight.current = false;
        setBusy(false);
        setErr(refusalWords(e, "save"));
      },
    );
  };
  return (
    <View testID="save-agent-form" style={st.form}>
      <Text style={st.formHead}>Save as an agent</Text>
      <TextField
        testID="save-agent-name"
        accessibilityLabel="Name"
        placeholder="Name"
        value={name}
        onChangeText={setName}
        maxLength={LIMITS.name}
        style={st.input}
      />
      <TextField
        testID="save-agent-role"
        accessibilityLabel="What it does"
        placeholder="What it does"
        value={role}
        onChangeText={setRole}
        maxLength={LIMITS.role}
        style={st.input}
      />
      <Text style={st.hint}>What it will be told</Text>
      <TextField
        testID="save-agent-instructions"
        accessibilityLabel="What it will be told"
        value={text}
        onChangeText={setText}
        multiline
        numberOfLines={6}
        maxLength={LIMITS.saveInstructions}
        style={st.area}
      />
      <Segmented
        label="Who can use it"
        testID="save-agent-sharing"
        value={sharing}
        onChange={setSharing}
        options={[
          { id: "me", label: "Only me" },
          { id: "everyone", label: "Everyone" },
        ]}
      />
      <Text style={st.hint}>It also keeps the model it ran on.</Text>
      {err ? (
        <Text testID="save-agent-error" style={st.err}>
          {err}
        </Text>
      ) : null}
      <View style={st.line}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || name.trim() === "" || text.trim() === "" }}
          testID="save-agent-go"
          onPress={go}
          style={[st.pill, st.pillOn, (busy || name.trim() === "" || text.trim() === "") && st.off]}
        >
          <Text style={[st.pillText, st.pillOnText]}>{busy ? "Saving" : "Save"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" testID="save-agent-cancel" onPress={onCancel} style={st.pill}>
          <Text style={st.pillText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const metaOf = (s: CompareSide): string =>
  [
    s.seconds !== undefined ? span(s.seconds * 1000) : null,
    s.tokens > 0 ? `${tokens(s.tokens)} tokens` : null,
    s.usdMicros > 0 ? money(s.usdMicros) : null,
    s.model ? modelName(s.model) : null,
  ]
    .filter((x): x is string => x !== null)
    .join(" · ");

/** The first run and every run again, side by side (stacked on a narrow pane), with what changed between them in plain facts. A side still going says so and fills in when it is done. */
export function CompareView({
  sides,
  onOpenThread,
}: {
  sides: readonly CompareSide[];
  onOpenThread?: (threadId: string) => void;
}): ReactElement {
  const first = sides[0];
  return (
    <View testID="compare-view" style={st.cmp}>
      <View style={st.cols}>
        {/* ui-rows-lint: not a list (the runs of one piece of work set side by side to read against each other; each is a column, not a row) */}
        {sides.map((s, i) => (
          <View key={s.runId ?? s.threadId ?? i} testID={`compare-side-${i}`} style={st.col}>
            <Text style={st.colHead}>{sideLabel(i)}</Text>
            {sideOpen(s) ? (
              <Text testID={`compare-side-${i}-open`} style={st.hint}>
                {s.status === "queued" ? "Starting" : "Working"}. It fills in here when it is done.
              </Text>
            ) : (
              <Text testID={`compare-side-${i}-result`} style={st.result}>
                {s.result ?? (s.status === "succeeded" ? "It returned nothing." : "It did not finish.")}
              </Text>
            )}
            {metaOf(s) !== "" ? <Text style={st.meta}>{metaOf(s)}</Text> : null}
            {s.threadId !== undefined && onOpenThread ? (
              <Pressable
                accessibilityRole="button"
                testID={`compare-open-${i}`}
                onPress={() => onOpenThread(s.threadId!)}
                style={st.pill}
              >
                <Text style={st.pillText}>Open chat</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>
      {first !== undefined
        ? sides.slice(1).map((s, i) => {
            const lines = compareDiff(first, s, { money, model: modelName });
            return lines.length === 0 ? null : (
              <View key={s.runId ?? s.threadId ?? i} testID={`compare-diff-${i + 1}`} style={st.diff}>
                <Text style={st.colHead}>
                  {sides.length > 2 ? `${sideLabel(i + 1)} against the first` : "What differs"}
                </Text>
                {/* ui-rows-lint: not a list (a few facts about what changed, a mark and a sentence each, nothing to press) */}
                {lines.map((l) => (
                  <View key={l} style={st.diffLine}>
                    <View style={st.dot} />
                    <Text style={st.diffText}>{l}</Text>
                  </View>
                ))}
              </View>
            );
          })
        : null}
    </View>
  );
}

const st = StyleSheet.create({
  form: { gap: 8, marginTop: 8, padding: 10, borderRadius: 12, backgroundColor: "var(--sunk)" as string },
  formHead: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  area: {
    minHeight: 96,
    padding: 8,
    borderRadius: 9,
    fontSize: 13,
    lineHeight: 19,
    color: "var(--ink)" as string,
    backgroundColor: "var(--raised)" as string,
  },
  input: {
    height: 32,
    paddingHorizontal: 9,
    borderRadius: 9,
    fontSize: 13,
    color: "var(--ink)" as string,
    backgroundColor: "var(--raised)" as string,
  },
  line: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  hint: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
  err: { fontSize: 12, lineHeight: 17, color: "var(--danger)" as string },
  pill: {
    height: 28,
    paddingHorizontal: 11,
    borderRadius: 9,
    justifyContent: "center",
    backgroundColor: "var(--hover)" as string,
  },
  pillText: { fontSize: 12.5, color: "var(--ink)" as string },
  pillOn: { backgroundColor: "var(--accent)" as string },
  pillOnText: { color: "var(--accent-ink)" as string },
  off: { opacity: 0.45 },
  cmp: { gap: 12, marginTop: 8 },
  cols: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  col: {
    flexGrow: 1,
    flexBasis: 240,
    minWidth: 0,
    gap: 6,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "var(--raised)" as string,
    boxShadow: "inset 0 0 0 1px var(--line)",
  } as object,
  colHead: { fontSize: 12, fontWeight: "600", color: "var(--ink-3)" as string },
  result: { fontSize: 13.5, lineHeight: 20, color: "var(--ink)" as string },
  meta: { fontSize: 12, color: "var(--ink-4)" as string, fontVariant: ["tabular-nums"] },
  diff: { gap: 4 },
  dot: { width: 4, height: 4, marginHorizontal: 4, borderRadius: 2, backgroundColor: "var(--ink-4)" as string },
  diffLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  diffText: { flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--ink-2)" as string },
});
