// The onboarding screen: a step rail on the left (ticks and "later"), a chat with the Assistant in the middle, a live preview on the right. It is driven entirely by props, so the same
// screen serves a Personal Space, a Team Space owner and a member, with the scripted Assistant (no AI yet) or the live one. Every step can be skipped; "Not now" puts it on the rail as
// later and moves on. Colours come from the Space theme variables, so light and dark both work.
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
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

function Mark({ state }: { state: StepState }): ReactElement {
  return <View testID={`mark-${state}`} style={[s.mark, state === "done" && s.markDone, state === "later" && s.markLater]}>{state === "done" ? <Text style={s.tick}>{"✓"}</Text> : null}</View>;
}

function Rail({ flow, progress, current, onOpen }: { flow: FlowKind; progress: Progress; current: string | null; onOpen(key: string): void }): ReactElement {
  const c = counts(flow, progress);
  return (
    <View testID="onboarding-rail" style={s.rail}>
      <Text style={s.railHead} accessibilityRole="header">{`Set up  ${c.done} of ${c.total}`}</Text>
      {stepsOf(flow).map((st) => {
        const state = stateOf(progress, st.key);
        const on = st.key === current;
        return (
          <Pressable key={st.key} testID={`step-${st.key}`} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onOpen(st.key)} style={[s.railRow, on && s.railRowOn]}>
            <Mark state={state} />
            <View style={s.flex}>
              <Text style={[s.railTitle, state === "done" && s.dim]}>{st.title}</Text>
              {state === "later" ? <Text style={s.later}>Later</Text> : on ? <Text style={s.dim}>{st.line}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function Bubble({ line }: { line: ChatLine }): ReactElement {
  const mine = line.from === "you";
  return <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleTheirs]} testID={`line-${line.id}`}><Text style={[s.bubbleText, mine && s.bubbleTextMine]}>{line.text}</Text></View>;
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
  const lines: ChatLine[] = [{ id: "hello", from: "assistant", text: greeting(p.flow, p.spaceName) }];
  if (words) lines.push(...words.lines.map((text, i) => ({ id: `${def!.key}-${i}`, from: "assistant" as const, text })));
  const chat = p.live && p.lines ? [lines[0]!, ...p.lines] : lines;
  const card = def && ctx ? (p.renderCard ? p.renderCard(def.card, ctx) : <Text style={s.dim}>{def.title}</Text>) : null;
  const preview = def && ctx ? (p.renderPreview ? p.renderPreview(def.card, ctx) : <Text style={s.previewText}>{words!.preview}</Text>) : null;
  return (
    <View testID="onboarding" style={[s.page, narrow && s.pageNarrow]}>
      {narrow ? <Text style={s.railHead} testID="onboarding-progress">{`Set up  ${counts(p.flow, p.progress).done} of ${counts(p.flow, p.progress).total}`}</Text> : <Rail flow={p.flow} progress={p.progress} current={current} onOpen={open} />}
      <View testID="onboarding-chat" style={s.chat}>
        <ScrollView style={s.flex} contentContainerStyle={s.chatBody}>
          {finished ? <Text testID="onboarding-finished" style={s.title}>You are all set.</Text> : <Text style={s.title}>{def!.title}</Text>}
          {chat.map((l) => <Bubble key={l.id} line={l} />)}
          {!p.live && !finished && def?.card !== "connect_ai" ? <Text style={s.dim} testID="scripted-note">Connect an AI account to talk to me. The steps work without it.</Text> : null}
          {card ? <View testID="onboarding-card" style={s.card}>{card}</View> : null}
        </ScrollView>
        <View style={s.actions}>
          {def && ctx ? <>
            <Pressable testID="step-later" accessibilityRole="button" onPress={ctx.later} style={s.ghost}><Text style={s.ghostText}>Not now</Text></Pressable>
            <Text style={[s.dim, s.flex]}>{words!.skipHint}</Text>
          </> : <View style={s.flex} />}
          {p.onClose ? <Pressable testID="onboarding-close" accessibilityRole="button" onPress={p.onClose} style={s.primary}><Text style={s.primaryText}>{finished ? "Open Home" : "Continue to Home"}</Text></Pressable> : null}
        </View>
      </View>
      {narrow ? null : <View testID="onboarding-preview" style={s.preview}><Text style={s.railHead}>Preview</Text>{preview}</View>}
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, flexDirection: "row", backgroundColor: "var(--win)" as string },
  pageNarrow: { flexDirection: "column" },
  flex: { flex: 1, minWidth: 0 },
  rail: { width: 264, paddingVertical: 28, paddingHorizontal: 14, borderRightWidth: 1, borderRightColor: "var(--line)" as string, gap: 2 },
  railHead: { fontSize: 12, fontWeight: "500", color: "var(--ink-3)" as string, paddingHorizontal: 8, paddingVertical: 6 },
  railRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8 },
  railRowOn: { backgroundColor: "var(--accent-wash)" as string },
  railTitle: { fontSize: 13.5, fontWeight: "500", color: "var(--ink)" as string },
  dim: { fontSize: 12.5, color: "var(--ink-3)" as string, lineHeight: 18 },
  later: { fontSize: 12, color: "var(--ink-3)" as string },
  mark: { width: 18, height: 18, borderRadius: 99, borderWidth: 1.5, borderColor: "var(--line-2)" as string, alignItems: "center", justifyContent: "center", marginTop: 1 },
  markDone: { backgroundColor: "var(--ok)" as string, borderWidth: 0 },
  markLater: { borderStyle: "dashed" },
  tick: { fontSize: 10, lineHeight: 11, color: "#fff", fontWeight: "700" },
  chat: { flex: 1, minWidth: 0 },
  chatBody: { width: "100%", maxWidth: 640, alignSelf: "center", paddingTop: 40, paddingHorizontal: 20, paddingBottom: 24, gap: 12 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: "600", letterSpacing: -0.4, color: "var(--ink)" as string, marginBottom: 6 },
  bubble: { maxWidth: "88%", paddingVertical: 10, paddingHorizontal: 14, borderRadius: 14 },
  bubbleTheirs: { alignSelf: "flex-start", backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  bubbleMine: { alignSelf: "flex-end", backgroundColor: "var(--accent)" as string },
  bubbleText: { fontSize: 14.5, lineHeight: 21, color: "var(--ink)" as string },
  bubbleTextMine: { color: "#fff" },
  card: { padding: 16, borderRadius: 12, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string, gap: 10 },
  actions: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 20, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  ghost: { height: 34, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: "var(--line-2)" as string, alignItems: "center", justifyContent: "center" },
  ghostText: { fontSize: 13.5, color: "var(--ink)" as string },
  primary: { height: 34, paddingHorizontal: 16, borderRadius: 8, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center" },
  primaryText: { fontSize: 13.5, fontWeight: "500", color: "#fff" },
  preview: { width: 320, padding: 20, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string, gap: 10 },
  previewText: { fontSize: 14, lineHeight: 20, color: "var(--ink-2)" as string, paddingHorizontal: 8 },
});
