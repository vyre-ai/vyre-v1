// The onboarding screen: a step rail on the left (one row per step on a fixed grid: a circle, the title and, for the step on show or one put off, one plain line), the Assistant in the middle (its words as one calm message group, then the card that is the thing to do), and what is set up so far on the right. It is driven entirely by props, so the same
// screen serves a Personal Space, a Team Space owner and a member, with the scripted Assistant (no AI yet) or the live one. Every step can be skipped; "Not now" puts it on the rail as
// later and moves on. Colours come from the Space theme variables, so light and dark both work.
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Avatar } from "../../../../ui/src/Avatar/index.tsx";
import { counts, nextAfter, resumeAt, stateOf, stepsOf } from "./flow.ts";
import type { CardKind, FlowKind, Progress, StepDef, StepState } from "./flow.ts";
import { greeting, scriptFor } from "./script.ts";

export interface ChatLine { id: string; from: "assistant" | "you"; text: string }
export interface CardContext { step: StepDef; flow: FlowKind; done(): void; later(): void }

export interface OnboardingScreenProps {
  flow: FlowKind;
  spaceName: string;
  progress: Progress;
  /** the step on show; defaults to where the person left off */
  stepKey?: string | null;
  /** an AI account is connected, so the Assistant is live and `lines` come from the chat */
  live?: boolean;
  /** the live Assistant's lines for this step; ignored while the scripted words are used */
  lines?: readonly ChatLine[];
  onStep(key: string, state: StepState): void;
  onOpenStep?(key: string): void;
  onClose?(): void;
  /** the real card for a step; the default is a quiet placeholder so the screen renders without any backend */
  renderCard?(card: CardKind, ctx: CardContext): ReactNode;
  /** the right pane for a step; defaults to the scripted description */
  renderPreview?(card: CardKind, ctx: CardContext): ReactNode;
}

const BREAK = 900;
const COLUMN = 640;

/** The circle of a step: empty while open, ringed for the step on show, a tick when done, dashed when put off. */
function Mark({ state, on }: { state: StepState; on: boolean }): ReactElement {
  return (
    <View testID={`mark-${state}`} style={[s.mark, on && state === "open" && s.markOn, state === "done" && s.markDone, state === "later" && s.markLater]}>
      {state === "done" ? <Text style={s.tick}>{"\u2713"}</Text> : on && state === "open" ? <View style={s.markDot} /> : null}
    </View>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }): ReactElement {
  return <View style={s.bar} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: done }}><View style={[s.barFill, { width: `${total === 0 ? 0 : Math.round((done / total) * 100)}%` as `${number}%` }]} /></View>;
}

function Rail({ flow, progress, current, onOpen }: { flow: FlowKind; progress: Progress; current: string | null; onOpen(key: string): void }): ReactElement {
  const c = counts(flow, progress);
  const rows: ReactElement[] = [];
  for (const st of stepsOf(flow)) {
    const state = stateOf(progress, st.key);
    const on = st.key === current;
    const sub = state === "later" ? "Later" : on ? st.line : "";
    rows.push(
      <Pressable
        key={st.key} testID={`row-step-${st.key}`} accessibilityRole="button" accessibilityLabel={`${st.title}${state === "done" ? ", done" : state === "later" ? ", later" : ""}`} accessibilityState={{ selected: on }}
        onPress={() => onOpen(st.key)} style={({ hovered }: { hovered?: boolean }) => [s.step, on && s.stepOn, hovered === true && !on && s.stepOver]}
      >
        <Mark state={state} on={on} />
        <View style={s.stepText}>
          <Text style={[s.stepTitle, !on && state !== "done" && s.stepTitleQuiet, on && s.stepTitleOn]}>{st.title}</Text>
          {sub ? <Text style={s.stepSub}>{sub}</Text> : null}
        </View>
      </Pressable>,
    );
  }
  return (
    <View testID="onboarding-rail" style={s.rail}>
      <View style={s.railHeadRow}>
        <Text style={s.railHead} accessibilityRole="header">{`Set up  ${c.done} of ${c.total}`}</Text>
      </View>
      <ProgressBar done={c.done} total={c.total} />
      <View style={s.steps}>{rows}</View>
    </View>
  );
}

/** The Assistant's words as one message group: its face and name once, then the paragraphs. */
function Said({ lines }: { lines: readonly ChatLine[] }): ReactElement {
  const paras: ReactElement[] = [];
  for (const l of lines) paras.push(<Text key={l.id} testID={`line-${l.id}`} style={[s.said, l.from === "you" && s.saidYou]}>{l.text}</Text>);
  return (
    <View testID="assistant-said" style={s.group}>
      <Avatar name="Assistant" kind="agent" size={28} />
      <View style={s.groupText}>
        <Text style={s.who}>Assistant</Text>
        {paras}
      </View>
    </View>
  );
}

/** What is set up so far, on the right: the step on show says what it will do, then what is done and what was put off. */
function Preview({ flow, progress, current, body }: { flow: FlowKind; progress: Progress; current: string | null; body: ReactNode }): ReactElement {
  const done: ReactElement[] = [], later: ReactElement[] = [];
  for (const st of stepsOf(flow)) {
    const state = stateOf(progress, st.key);
    if (state === "done") done.push(<View key={st.key} style={s.pRow}><View style={[s.pMark, s.pMarkDone]}><Text style={s.pTick}>{"\u2713"}</Text></View><Text style={s.pText}>{st.title}</Text></View>);
    else if (state === "later") later.push(<View key={st.key} style={s.pRow}><View style={[s.pMark, s.markLater]} /><Text style={s.pTextQuiet}>{st.title}</Text></View>);
  }
  return (
    <ScrollView testID="onboarding-preview" style={s.preview} contentContainerStyle={s.previewIn}>
      <Text style={s.pHead}>{current ? "This step" : "Your setup"}</Text>
      {body ? <View style={s.pCard}>{body}</View> : null}
      <Text style={s.pHead}>{`Done so far  ${done.length}`}</Text>
      {done.length > 0 ? <View style={s.pList}>{done}</View> : <Text style={s.pEmpty}>Nothing yet. Steps you finish appear here.</Text>}
      {later.length > 0 ? <><Text style={s.pHead}>{`For later  ${later.length}`}</Text><View style={s.pList}>{later}</View></> : null}
    </ScrollView>
  );
}

export function OnboardingScreen(p: OnboardingScreenProps): ReactElement {
  const width = useWindowDimensions().width;
  const narrow = width > 0 && width < BREAK;
  const [shown, setShown] = useState<string | null>(p.stepKey ?? null);
  const current = p.stepKey ?? shown ?? resumeAt(p.flow, p.progress);
  const open = (key: string): void => { setShown(key); p.onOpenStep?.(key); };
  const def = stepsOf(p.flow).find((x) => x.key === current);
  const finished = current === null || def === undefined;
  const words = def ? scriptFor(def.card, p.flow) : null;
  const ctx: CardContext | null = def ? {
    step: def, flow: p.flow,
    done: () => { p.onStep(def.key, "done"); const n = nextAfter(p.flow, { ...p.progress, [def.key]: "done" }, def.key); if (n) open(n); },
    later: () => { p.onStep(def.key, "later"); const n = nextAfter(p.flow, { ...p.progress, [def.key]: "later" }, def.key); if (n) open(n); },
  } : null;
  // Next moves on without changing the step; on the last step it becomes Done and finishes
  const steps = stepsOf(p.flow);
  const at = def ? steps.findIndex((x) => x.key === def.key) : -1;
  const isLast = at === steps.length - 1;
  const next = (): void => {
    if (!def) return;
    if (isLast) { if (stateOf(p.progress, def.key) !== "done") p.onStep(def.key, "done"); p.onClose?.(); return; }
    open(steps[at + 1]!.key);
  };
  // the welcome is said once, at the first step; later steps start with their own words
  const welcome = at <= 0 && counts(p.flow, p.progress).done === 0;
  const lines: ChatLine[] = welcome ? [{ id: "hello", from: "assistant", text: greeting(p.flow, p.spaceName) }] : [];
  if (words) lines.push(...words.lines.map((text, i) => ({ id: `${def!.key}-${i}`, from: "assistant" as const, text })));
  const chat = p.live && p.lines ? [...lines.slice(0, 1), ...p.lines] : lines;
  const card = def && ctx ? (p.renderCard ? p.renderCard(def.card, ctx) : <Text style={s.dim}>{def.title}</Text>) : null;
  const previewBody = def && ctx ? (p.renderPreview ? p.renderPreview(def.card, ctx) : <Text style={s.previewText}>{words!.preview}</Text>) : null;
  const c = counts(p.flow, p.progress);
  const head = finished
    ? <Text testID="onboarding-finished" style={s.title}>You are all set.</Text>
    : <View style={s.head}><Text style={s.overline}>{`Step ${at + 1} of ${steps.length}`}</Text><Text style={s.title} accessibilityRole="header">{def!.title}</Text></View>;
  return (
    <View testID="onboarding" style={[s.page, narrow && s.pageNarrow]}>
      {narrow
        ? <View style={s.narrowHead}><Text style={s.railHead} testID="onboarding-progress">{`Set up  ${c.done} of ${c.total}`}</Text><ProgressBar done={c.done} total={c.total} /></View>
        : <Rail flow={p.flow} progress={p.progress} current={current} onOpen={open} />}
      <View testID="onboarding-chat" style={s.chat}>
        {p.live && p.liveChat ? (
          <View style={[s.flex, s.body, s.liveCol]}>
            {head}
            {card ? <View testID="onboarding-card" style={s.card}>{card}</View> : null}
            <View testID="onboarding-live" style={s.live}>{p.liveChat}</View>
          </View>
        ) : (
          <ScrollView style={s.flex} contentContainerStyle={s.body}>
            {head}
            {finished ? <Said lines={[{ id: "all-set", from: "assistant", text: "That is everything on the list. Steps you put off stay on the checklist on Home, and you can open any of them again whenever you want to change something." }]} /> : <Said lines={chat} />}
            {!p.live && !finished && def?.card !== "connect_ai" ? <Text style={s.dim} testID="scripted-note">Connect an AI account to talk to me. The steps work without it.</Text> : null}
            {card ? <View testID="onboarding-card" style={s.card}>{card}</View> : null}
          </ScrollView>
        )}
        <View style={s.footer}>
          <View style={s.actions}>
            {p.onClose && !finished ? <Pressable testID="onboarding-close" accessibilityRole="link" onPress={p.onClose} style={({ hovered }: { hovered?: boolean }) => [s.later, hovered === true && s.laterOver]}><Text style={s.finishLater}>Finish later</Text></Pressable> : null}
            <View style={s.flex} />
            {def && ctx ? <>
              <Pressable testID="step-later" accessibilityRole="button" onPress={ctx.later} style={({ hovered }: { hovered?: boolean }) => [s.ghost, hovered === true && s.ghostOver]}><Text style={s.ghostText}>Skip for now</Text></Pressable>
              <Pressable testID="step-next" accessibilityRole="button" onPress={next} style={({ hovered }: { hovered?: boolean }) => [s.primary, hovered === true && s.primaryOver]}><Text style={s.primaryText}>{isLast ? "Done" : "Next"}</Text></Pressable>
            </> : p.onClose ? <Pressable testID="onboarding-close" accessibilityRole="button" onPress={p.onClose} style={s.primary}><Text style={s.primaryText}>Open Home</Text></Pressable> : null}
          </View>
        </View>
      </View>
      {narrow ? null : <Preview flow={p.flow} progress={p.progress} current={finished ? null : current} body={previewBody} />}
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, flexDirection: "row", backgroundColor: "var(--win)" as string },
  pageNarrow: { flexDirection: "column" },
  flex: { flex: 1, minWidth: 0 },
  // the rail: a fixed 264 px column, a 4 px progress line, then one row per step
  rail: { width: 264, paddingTop: 24, paddingBottom: 20, paddingHorizontal: 16, borderRightWidth: 1, borderRightColor: "var(--line)" as string, backgroundColor: "var(--side)" as string },
  railHeadRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, marginBottom: 10 },
  railHead: { fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string, letterSpacing: 0.1 },
  bar: { height: 4, borderRadius: 2, backgroundColor: "var(--line)" as string, marginHorizontal: 8, marginBottom: 14, overflow: "hidden" },
  barFill: { height: 4, borderRadius: 2, backgroundColor: "var(--accent)" as string },
  steps: { gap: 2 },
  step: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 9, paddingHorizontal: 8, minHeight: 40, borderRadius: 8 },
  stepOn: { backgroundColor: "var(--accent-wash)" as string },
  stepOver: { backgroundColor: "var(--hover)" as string },
  stepText: { flex: 1, minWidth: 0, gap: 2 },
  stepTitle: { fontSize: 13.5, lineHeight: 20, fontWeight: "500", color: "var(--ink)" as string },
  stepTitleQuiet: { color: "var(--ink-2)" as string },
  stepTitleOn: { fontWeight: "600", color: "var(--ink)" as string },
  stepSub: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
  mark: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: "var(--line-2)" as string, alignItems: "center", justifyContent: "center", marginTop: 0, flexShrink: 0 },
  markOn: { borderColor: "var(--accent)" as string },
  markDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "var(--accent)" as string },
  markDone: { backgroundColor: "var(--ok)" as string, borderWidth: 0 },
  markLater: { borderStyle: "dashed" },
  tick: { fontSize: 11, lineHeight: 13, color: "#fff", fontWeight: "700" },
  narrowHead: { paddingTop: 14, paddingBottom: 4, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, gap: 8 },
  // the middle: one column of 640 px
  chat: { flex: 1, minWidth: 0 },
  body: { width: "100%", maxWidth: COLUMN, alignSelf: "center", paddingTop: 44, paddingHorizontal: 24, paddingBottom: 32, gap: 20 },
  head: { gap: 6 },
  overline: { fontSize: 11.5, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase", color: "var(--ink-3)" as string },
  title: { fontSize: 26, lineHeight: 32, fontWeight: "600", letterSpacing: -0.5, color: "var(--ink)" as string },
  group: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  groupText: { flex: 1, minWidth: 0, gap: 8, paddingTop: 2 },
  who: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  said: { fontSize: 15, lineHeight: 23, color: "var(--ink-2)" as string },
  saidYou: { color: "var(--ink)" as string },
  dim: { fontSize: 12.5, color: "var(--ink-3)" as string, lineHeight: 18 },
  liveCol: { flex: 1 },
  live: { flex: 1, minHeight: 240, borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string, overflow: "hidden" },
  card: { padding: 20, borderRadius: 14, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line-2)" as string, gap: 14, boxShadow: "var(--sh-1)" } as object,
  // the footer sits in the same column as the content
  footer: { borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  actions: { width: "100%", maxWidth: COLUMN, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 14, paddingHorizontal: 24 },
  later: { height: 34, paddingHorizontal: 8, marginLeft: -8, borderRadius: 8, justifyContent: "center" },
  laterOver: { backgroundColor: "var(--hover)" as string },
  finishLater: { fontSize: 13.5, color: "var(--ink-3)" as string },
  ghost: { height: 34, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: "var(--line-2)" as string, alignItems: "center", justifyContent: "center" },
  ghostOver: { backgroundColor: "var(--hover)" as string },
  ghostText: { fontSize: 13.5, color: "var(--ink)" as string },
  primary: { height: 34, paddingHorizontal: 18, borderRadius: 8, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center" },
  primaryOver: { opacity: 0.9 },
  primaryText: { fontSize: 13.5, fontWeight: "500", color: "#fff" },
  // the preview: what the step does, then what is done
  preview: { width: 320, flexGrow: 0, flexShrink: 0, flexBasis: 320, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string, backgroundColor: "var(--side)" as string },
  previewIn: { paddingTop: 24, paddingBottom: 24, paddingHorizontal: 20, gap: 12 },
  pHead: { fontSize: 12, fontWeight: "600", color: "var(--ink-3)" as string, marginTop: 4 },
  pCard: { padding: 14, borderRadius: 12, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  previewText: { fontSize: 14, lineHeight: 21, color: "var(--ink)" as string },
  pList: { gap: 8 },
  pRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  pMark: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: "var(--line-2)" as string, alignItems: "center", justifyContent: "center" },
  pMarkDone: { backgroundColor: "var(--ok)" as string, borderWidth: 0 },
  pTick: { fontSize: 9, lineHeight: 10, color: "#fff", fontWeight: "700" },
  pText: { fontSize: 13.5, color: "var(--ink)" as string },
  pTextQuiet: { fontSize: 13.5, color: "var(--ink-3)" as string },
  pEmpty: { fontSize: 13, lineHeight: 19, color: "var(--ink-3)" as string },
});
