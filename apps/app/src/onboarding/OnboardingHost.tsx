// Mounts the onboarding screen over the signed-in shell. It opens by itself the first time a person enters a Space (owner and member alike), once; after that only the Home checklist,
// the Console or the "Set up" entry reopen it. Every step can be put off. Steps whose real card is not built yet say so honestly instead of pretending.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { CapCall } from "../shell/session/caps.ts";
import { ConnectAiCard } from "./ConnectAiCard.tsx";
import { InterviewCard } from "./InterviewCard.tsx";
import { shouldAutoOpen } from "./flow.ts";
import type { CardKind, FlowKind, Progress, StepState } from "./flow.ts";
import { OnboardingScreen } from "./OnboardingScreen.tsx";
import type { CardContext } from "./OnboardingScreen.tsx";
import { flowOfSession, loadFlow, markSeen, markStep, registerOnboardingOpener, usedChecklistBefore } from "./store.ts";

export interface OnboardingHostProps {
  /** null until the session has opened; the shell below is mounted either way so nothing remounts */
  call: CapCall | null;
  space: { kind: "personal" | "team"; name: string };
  children: ReactNode;
  /** extra cards, by kind, supplied as they are built */
  cards?: Partial<Record<CardKind, (ctx: CardContext) => ReactNode>>;
}

export function OnboardingHost({ call, space, children, cards }: OnboardingHostProps): ReactElement {
  const [flow, setFlow] = useState<FlowKind | null>(null);
  const [progress, setProgress] = useState<Progress>({});
  const [shown, setShown] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [aiProvider, setAiProvider] = useState<string | null>(null);

  useEffect(() => {
    if (!call) return undefined;
    let off = false;
    void (async () => {
      try {
        const f = await flowOfSession(call, space.kind);
        const state = await loadFlow(call, f);
        if (off) return;
        setFlow(f); setProgress(state.progress);
        const before = state.seen ? true : await usedChecklistBefore(call).catch(() => false);
        if (off) return;
        if (shouldAutoOpen(f, state.progress, before)) { setShown(true); void markSeen(call, f).catch(() => undefined); }
      } catch { /* the app works without it; the checklist can reopen it */ }
    })();
    return () => { off = true; };
  }, [call, space.kind]);

  useEffect(() => registerOnboardingOpener((s) => { setStep(s ?? null); setShown(true); }), []);

  const onStep = useCallback((key: string, state: StepState): void => {
    if (!flow || !call) return;
    setProgress((p) => state === "open" ? Object.fromEntries(Object.entries(p).filter(([k]) => k !== key)) : { ...p, [key]: state });
    void markStep(call, flow, key, state).catch(() => undefined);
  }, [call, flow]);

  const renderCard = useMemo(() => (card: CardKind, ctx: CardContext): ReactNode => {
    const given = cards?.[card];
    if (given) return given(ctx);
    if (card === "connect_ai" && call) return <ConnectAiCard call={call} connected={aiProvider !== null || progress["ai"] === "done"} onConnected={(id) => { setAiProvider(id); ctx.done(); }} />;
    if (card === "interview" && call) return <InterviewCard call={call} onSaved={() => ctx.done()} />;
    return <Text testID="card-not-set-up" style={s.dim}>This part is not set up yet. You can do it later from the checklist on Home.</Text>;
  }, [call, cards, aiProvider, progress]);

  // the shell stays mounted underneath, so closing the screen returns to exactly where the person was
  return (
    <>
      {children}
      {shown && flow ? (
        <View style={s.fill}>
          <OnboardingScreen flow={flow} spaceName={space.name} progress={progress} stepKey={step} onOpenStep={setStep} onStep={onStep} onClose={() => { setShown(false); setStep(null); }} renderCard={renderCard} />
        </View>
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  fill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 50, backgroundColor: "var(--win)" as string },
  dim: { fontSize: 13, color: "var(--ink-3)" as string },
});
