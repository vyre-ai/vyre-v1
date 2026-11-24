// The Test pane (rc.41, prototype vyre-v1.html#automations,at:clear.dry): a test is a dry run on something real. Pick a record (the newest things that happened, or any record by name) or open
// Last week; the steps tick on the page as they run; what would have gone out is listed here as Held, with its real content, and nothing is sent or changed. Last week says how many times it would
// have started, and each of those can be tried. The pane decides nothing: the page starts the test and hands the trace back.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Glyph } from "../canvas/icons.tsx";
import { look } from "../screens/look.ts";
import { traceSummary, tryOn, weekHead } from "./model.ts";
import type { TraceStep, WeekStart, WouldRun } from "./model.ts";

/** What a test is tried on: a thing that happened (eventId) or a record as it stands. */
export interface TestTarget {
  eventId?: string;
  recordId?: string;
  recordType?: string;
  name: string;
  /** "Stage became Signed · Tue 9:12 AM" */ sub: string;
  /** false: the trigger's own filter would not have started it, and `why` says what stopped it */ starts?: boolean;
  why?: string;
}

export interface TestPaneProps {
  /** The Automation's name, under the title. */
  name: string;
  /** Last week, from the server; null while it is being read, and for a trigger no event starts it stays unsupported. */
  would: WouldRun | null;
  /** The trace of the running or finished test, in step order; null when no test has started. */
  steps: readonly TraceStep[] | null;
  finished: boolean;
  /** What the test on the page is being tried on. */
  target: TestTarget | null;
  whenText(at: number): string;
  onStart(target: TestTarget): void;
  /** Records by name, for "Find a customer". Absent when the trigger is not about a record type. */
  search?(q: string): Promise<readonly { recordId: string; recordType: string; name: string }[]>;
  onWhy?(target: TestTarget): void;
  onClose(): void;
  /** Open on Last week (an Automation's Runs tab asks "Why didn't it run?"). */
  initialStage?: "pick" | "week";
}

function Mark({ tone, glyph }: { tone: "ok" | "warn" | "quiet"; glyph: "check" | "x" | "clock" }): ReactElement {
  const color = tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : "var(--ink-3)";
  return (
    <View style={[s.mark, { backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)` as string }]}>
      <Glyph name={glyph} size={11} color={color} />
    </View>
  );
}

function Face({ name }: { name: string }): ReactElement {
  return (
    <View style={s.face}>
      <Text style={s.faceText}>{name.trim().charAt(0).toUpperCase() || "?"}</Text>
    </View>
  );
}

const targetOf = (st: WeekStart, when: string): TestTarget => ({
  eventId: st.eventId,
  ...(st.recordId ? { recordId: st.recordId } : {}),
  ...(st.type ? { recordType: st.type } : {}),
  name: st.name,
  sub: [st.change, when].filter((x) => x !== "").join(" · "),
  starts: st.starts,
  ...(st.why ? { why: st.why } : {}),
});

export function TestPane(p: TestPaneProps): ReactElement {
  const [stage, setStage] = useState<"pick" | "week" | "trace">(p.target ? "trace" : (p.initialStage ?? "pick"));
  const [from, setFrom] = useState<"pick" | "week">("pick");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<readonly { recordId: string; recordType: string; name: string }[] | null>(null);
  const [open, setOpen] = useState<readonly string[]>([]);
  // a record that would not have started it is not run until the person says so
  const [anyway, setAnyway] = useState(false);
  // what the person picked: shown at once, before the test has started
  const [chosen, setChosen] = useState<TestTarget | null>(p.target);
  const search = p.search;
  useEffect(() => {
    const text = q.trim();
    if (text === "" || !search) {
      setHits(null);
      return undefined;
    }
    let live = true;
    const t = setTimeout(() => {
      void search(text).then(
        (rows) => live && setHits(rows),
        () => live && setHits([]),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, search]);

  const pick = (t: TestTarget, origin: "pick" | "week"): void => {
    setFrom(origin);
    setOpen([]);
    setAnyway(false);
    setChosen(t);
    setStage("trace");
    // one the trigger's own filter would not have started is shown with its reason first; nothing runs until the person says so
    if (t.starts !== false) p.onStart(t);
  };
  const shown = stage === "trace" ? chosen : null;
  const week = p.would && p.would.supported ? weekHead(p.would) : null;
  const weekRow = week ? (
    <>
      <Text style={[look.heading, s.gap]}>Last week</Text>
      <Pressable testID="tp-week" accessibilityRole="button" onPress={() => setStage("week")} style={s.weekRow}>
        <Text style={s.num}>{week.n}</Text>
        <View style={s.grow}>
          <Text style={s.strong}>{week.title}</Text>
          <Text style={look.quiet}>{week.sub}</Text>
        </View>
      </Pressable>
    </>
  ) : null;

  const head = (title: string, sub: string, back: (() => void) | null): ReactElement => (
    <View style={s.head}>
      {back ? (
        <Pressable testID="tp-back" accessibilityRole="button" accessibilityLabel="Back" onPress={back} style={s.icon}>
          <Text style={s.chev}>{"‹"}</Text>
        </Pressable>
      ) : null}
      <View style={s.grow}>
        <Text accessibilityRole="header" style={s.title} numberOfLines={1}>
          {title}
        </Text>
        {sub ? (
          <Text style={look.quiet} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      <Pressable
        testID="tp-close"
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={p.onClose}
        style={s.icon}
      >
        <Glyph name="x" size={14} color="var(--ink-2)" />
      </Pressable>
    </View>
  );

  if (stage === "week" && p.would) {
    return (
      <View style={s.pane} testID="test-pane">
        {head("Last week", `${p.would.n} of ${p.would.of} would have started`, () => setStage("pick"))}
        <ScrollView contentContainerStyle={s.body}>
          {p.would.starts.map((st) => (
            <Row
              key={st.eventId}
              id={`tp-week-${st.eventId}`}
              title={st.name}
              note={`${p.whenText(st.at)} · ${st.starts ? st.change : (st.why ?? st.change)}`}
              leading={<Mark tone={st.starts ? "ok" : "quiet"} glyph={st.starts ? "check" : "x"} />}
              onPress={() => pick(targetOf(st, p.whenText(st.at)), "week")}
            />
          ))}
          {p.would.starts.length === 0 ? <Text style={look.quiet}>Nothing of its kind happened last week.</Text> : null}
        </ScrollView>
      </View>
    );
  }

  if (stage === "trace" && shown) {
    const back = (): void => setStage(from);
    const notStarted = shown.starts === false && !anyway;
    const sum = !notStarted && p.steps ? traceSummary(p.steps, p.finished) : null;
    return (
      <View style={s.pane} testID="test-pane">
        {head(shown.name, shown.sub, back)}
        <ScrollView contentContainerStyle={s.body}>
          {notStarted ? (
            <>
              <View style={s.status} testID="tp-status">
                <Mark tone="warn" glyph="x" />
                <Text style={s.strong}>Would not have started</Text>
              </View>
              {shown.why ? <Text style={s.why}>{shown.why}</Text> : null}
            </>
          ) : sum ? (
            <>
              <View style={s.status} testID="tp-status">
                {sum.state === "running" ? (
                  <View style={s.dot} />
                ) : (
                  <Mark tone={sum.state === "ok" ? "ok" : "warn"} glyph={sum.state === "ok" ? "check" : "x"} />
                )}
                <Text style={s.strong}>{sum.head}</Text>
                {sum.quiet ? <Text style={look.quiet}>{sum.quiet}</Text> : null}
              </View>
              {sum.why ? <Text style={s.why}>{sum.why}</Text> : null}
              {sum.held.length > 0 ? <Text style={[look.heading, s.gap]}>Held, not sent</Text> : null}
              {/* ui-rows-lint: not a list (cards that open in place to show what would have gone out) */}
              {sum.held.map((st) => {
                const on = open.includes(st.id);
                return (
                  <View key={st.id} style={s.card} testID={`tp-held-${st.id}`}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: on }}
                      onPress={() => setOpen(on ? open.filter((x) => x !== st.id) : [...open, st.id])}
                      style={s.cardHead}
                    >
                      <Text style={[s.strong, s.grow]} numberOfLines={2}>
                        {st.text}
                      </Text>
                      <Text style={s.chev}>{on ? "⌄" : "›"}</Text>
                    </Pressable>
                    {on ? (
                      <View style={s.kv}>
                        {/* ui-rows-lint: not a list (the values one held step would have sent) */}
                        {st.values.map(([k, v]) => (
                          <View key={k} style={s.kvRow}>
                            <Text style={[look.quiet, s.k]}>{k}</Text>
                            <Text style={s.v}>{v}</Text>
                          </View>
                        ))}
                        {st.values.length === 0 ? <Text style={look.quiet}>Nothing to show for this step.</Text> : null}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </>
          ) : (
            <View style={s.status} testID="tp-status">
              <View style={s.dot} />
              <Text style={s.strong}>Starting</Text>
            </View>
          )}
          {notStarted || (sum && sum.state !== "running") ? weekRow : null}
          {notStarted ? (
            <View style={s.ways}>
              <Pressable
                testID="tp-again"
                accessibilityRole="button"
                onPress={() => {
                  setAnyway(true);
                  p.onStart(shown);
                }}
                style={[look.btn, look.outlined]}
              >
                <Text style={look.btnText}>Run it anyway</Text>
              </Pressable>
              {p.onWhy && shown.recordId ? (
                <Pressable
                  testID="tp-why"
                  accessibilityRole="button"
                  onPress={() => p.onWhy!(shown)}
                  style={[look.btn, look.outlined]}
                >
                  <Text style={look.btnText}>Why didn’t it start?</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  const recent = tryOn(p.would);
  const noun = p.would?.noun;
  return (
    <View style={s.pane} testID="test-pane">
      {head("Test", p.name, null)}
      <ScrollView contentContainerStyle={s.body}>
        <Text style={look.quiet} testID="tp-note">
          Nothing is sent and nothing is changed. What would go out is held here for you to read.
        </Text>
        <Text style={[look.heading, s.gap]}>Try it on</Text>
        {search && noun ? (
          <TextInput
            testID="tp-search"
            value={q}
            onChangeText={setQ}
            placeholder={`Find ${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`}
            placeholderTextColor="var(--ink-3)"
            accessibilityLabel={`Find ${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`}
            style={s.search}
          />
        ) : null}
        {hits !== null
          ? hits.map((h) => (
              <Row
                key={h.recordId}
                id={`tp-hit-${h.recordId}`}
                title={h.name}
                leading={<Face name={h.name} />}
                onPress={() =>
                  pick({ recordId: h.recordId, recordType: h.recordType, name: h.name, sub: "As it is now" }, "pick")
                }
              />
            ))
          : recent.map((st) => (
              <Row
                key={st.eventId}
                id={`tp-try-${st.eventId}`}
                title={st.name}
                note={[st.change, p.whenText(st.at)].filter((x) => x !== "").join(" · ")}
                leading={<Face name={st.name} />}
                onPress={() => pick(targetOf(st, p.whenText(st.at)), "pick")}
              />
            ))}
        {hits !== null && hits.length === 0 ? <Text style={look.quiet}>{`Nothing called “${q.trim()}”.`}</Text> : null}
        {hits === null && recent.length === 0 ? (
          <Pressable
            testID="tp-sample"
            accessibilityRole="button"
            onPress={() => pick({ name: "An example", sub: "Made-up values" }, "pick")}
            style={[look.btn, look.outlined, s.start]}
          >
            <Text style={look.btnText}>{p.would === null ? "Reading what happened…" : "Try it on an example"}</Text>
          </Pressable>
        ) : null}
        {weekRow}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  pane: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  head: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 14, paddingBottom: 8 },
  title: { fontSize: 17, fontWeight: "600", color: "var(--ink)" as string },
  icon: { width: 32, height: 32, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  chev: { fontSize: 18, lineHeight: 20, color: "var(--ink-3)" as string },
  body: { paddingHorizontal: 12, paddingBottom: 24, gap: 4 },
  grow: { flex: 1, minWidth: 0 },
  gap: { marginTop: 18, marginBottom: 4, paddingHorizontal: 4 },
  strong: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  why: { fontSize: 13.5, lineHeight: 19, color: "var(--ink-2)" as string, paddingHorizontal: 4 },
  status: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 36, paddingHorizontal: 4 },
  dot: { width: 10, height: 10, borderRadius: 5, marginHorizontal: 5, backgroundColor: "var(--accent)" as string },
  mark: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  face: {
    width: 26,
    height: 26,
    borderRadius: 8,
    marginRight: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "var(--accent-wash)" as string,
  },
  faceText: { fontSize: 12, fontWeight: "600", color: "var(--accent)" as string },
  search: {
    height: 32,
    paddingHorizontal: 10,
    marginBottom: 4,
    fontSize: 13,
    color: "var(--ink)" as string,
    borderRadius: 12,
    backgroundColor: "var(--sunk)" as string,
  },
  weekRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  num: {
    minWidth: 28,
    textAlign: "center",
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "600",
    color: "var(--ink)" as string,
  },
  card: { borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string, marginBottom: 6, overflow: "hidden" },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  kv: { paddingHorizontal: 12, paddingBottom: 12, gap: 4 },
  kvRow: { flexDirection: "row", gap: 8 },
  k: { width: 72 },
  v: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18, color: "var(--ink-2)" as string },
  ways: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  start: { alignSelf: "flex-start" },
});
