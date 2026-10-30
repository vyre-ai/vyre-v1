// Mounts the onboarding screen over the signed-in shell. It opens by itself the first time a person enters a Space (owner and member alike), once; after that only the Home checklist,
// the Console or the "Set up" entry reopen it. Every step can be put off. Steps whose real card is not built yet say so honestly instead of pretending.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { CapCall } from "../shell/session/caps.ts";
import { ConnectAiCard } from "./ConnectAiCard.tsx";
import { InterviewCard } from "./InterviewCard.tsx";
import { takeTeamNext } from "./doors.ts";
import { TeamBridgeCard } from "./TeamBridgeCard.tsx";
import { OPEN_TARGETS, OpenCard } from "./OpenCard.tsx";
import { PairPhoneCard } from "./PairPhoneCard.tsx";
import { KitPickCard } from "./KitPickCard.tsx";
import { SpaceAiCard } from "./SpaceAiCard.tsx";
import { AssistantThread } from "./AssistantThread.tsx";
import { PreviewPane } from "./PreviewPane.tsx";
import type { ShellRuntime } from "../shell/providers/runtime.tsx";
import { DirectoryCard, InvitesCard, SSO_SETUP_HASH, SignInDomainCard, WorkspaceCard } from "./SuiteCards.tsx";
import { shouldAutoOpen } from "./flow.ts";
import { scriptFor } from "./script.ts";
import type { CardKind, FlowKind, Progress, StepState } from "./flow.ts";
import { OnboardingScreen } from "./OnboardingScreen.tsx";
import type { CardContext } from "./OnboardingScreen.tsx";
import { flowOfSession, loadFlow, markSeen, markStep, publishProgress, registerOnboardingOpener, usedChecklistBefore } from "./store.ts";

export interface OnboardingHostProps {
  /** null until the session has opened; the shell below is mounted either way so nothing remounts */
  call: CapCall | null;
  space: { kind: "personal" | "team"; name: string };
  children: ReactNode;
  /** opens the Space entry to create or join another Space */
  onAddSpace?: () => void;
  /** the session runtime and the person, for the live Assistant (an Ask thread); without them the scripted words stay */
  runtime?: ShellRuntime | null;
  person?: string | null;
  /** the signed-in person's name, for the invite emails */
  personName?: string | null;
  /** a caller for the Personal Space on this device, when there is one (for "use the same AI account") */
  personalCall?: CapCall | null;
  /** the Space address, for a pairing link */
  address?: string;
  /** go to a place of the shell (the screen closes first) */
  onGo?: (place: string, hash?: string) => void;
  /** this is the desktop app on a Mac */
  mac?: boolean;
  /** extra cards, by kind, supplied as they are built */
  cards?: Partial<Record<CardKind, (ctx: CardContext) => ReactNode>>;
}

export function OnboardingHost({ call, space, children, cards, onAddSpace, mac = false, address, onGo, personalCall = null, runtime = null, person = null, personName = null }: OnboardingHostProps): ReactElement {
  const [flow, setFlow] = useState<FlowKind | null>(null);
  const [progress, setProgress] = useState<Progress>({});
  const [shown, setShown] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [aiProvider, setAiProvider] = useState<string | null>(null);
  const [hasAi, setHasAi] = useState(false);
  // the Assistant is live once an AI account of the person's exists here
  useEffect(() => {
    if (!call) return undefined;
    let off = false;
    void (call("providers.list", {}) as Promise<{ providers: unknown[] }>).then((r) => { if (!off) setHasAi(r.providers.length > 0); }).catch(() => undefined);
    return () => { off = true; };
  }, [call, aiProvider]);

  useEffect(() => {
    if (!call) return undefined;
    let off = false;
    void (async () => {
      try {
        const f = await flowOfSession(call, space.kind);
        const state = await loadFlow(call, f);
        if (off) return;
        setFlow(f); setProgress(state.progress); publishProgress({ flow: f, progress: state.progress });
        const before = state.seen ? true : await usedChecklistBefore(call).catch(() => false);
        if (off) return;
        // "Set up my team" made this Personal Space first: open straight on the team step
        if (f === "personal" && takeTeamNext()) { setStep("team"); setShown(true); void markSeen(call, f).catch(() => undefined); return; }
        if (shouldAutoOpen(f, state.progress, before)) { setShown(true); void markSeen(call, f).catch(() => undefined); }
      } catch { /* the app works without it; the checklist can reopen it */ }
    })();
    return () => { off = true; };
  }, [call, space.kind]);

  useEffect(() => registerOnboardingOpener((s) => { setStep(s ?? null); setShown(true); }), []);

  const onStep = useCallback((key: string, state: StepState): void => {
    if (!flow || !call) return;
    setProgress((p) => {
      const next = state === "open" ? Object.fromEntries(Object.entries(p).filter(([k]) => k !== key)) : { ...p, [key]: state };
      publishProgress({ flow, progress: next });
      return next;
    });
    void markStep(call, flow, key, state).catch(() => undefined);
  }, [call, flow]);

  const renderCard = useMemo(() => (card: CardKind, ctx: CardContext): ReactNode => {
    const given = cards?.[card];
    if (given) return given(ctx);
    if (card === "connect_ai" && call) return <ConnectAiCard call={call} connected={aiProvider !== null || progress["ai"] === "done"} onConnected={(id) => { setAiProvider(id); ctx.done(); }} />;
    if (card === "bridge_team" && onAddSpace) return <TeamBridgeCard mac={mac} onCreate={() => { onAddSpace(); ctx.later(); }} />;
    if (card === "phone" && call && address) return <PairPhoneCard call={call} address={address} onPaired={() => ctx.done()} />;
    const target = OPEN_TARGETS[card];
    if (target && onGo) return <OpenCard text={target.text} action={target.action} onOpen={() => { setShown(false); setStep(null); onGo(target.place); }} onDone={() => ctx.done()} />;
    if (card === "space_ai" && call) return <SpaceAiCard team={call} personal={personalCall} onConnected={() => ctx.done()} />;
    if (call && onGo) {
      const toConsole = (): void => { setShown(false); setStep(null); onGo("console"); };
      if (card === "google_microsoft") return <WorkspaceCard call={call} onOpenConsole={toConsole} onDone={() => ctx.done()} />;
      if (card === "sign_in_domain") return <SignInDomainCard call={call} onOpenConsole={toConsole} onSetUp={() => { setShown(false); setStep(null); onGo("console", SSO_SETUP_HASH); }} onDone={() => ctx.done()} />;
      if (card === "directory") return <DirectoryCard call={call} by={personName ?? "Your admin"} space={space.name} onOpenConsole={toConsole} onDone={() => ctx.done()} />;
    }
    if (card === "invites" && call) return <InvitesCard call={call} onDone={() => ctx.done()} />;
    if (card === "org" && call) return <KitPickCard call={call} onInstalled={() => ctx.done()} />;
    if (card === "interview" && call) return <InterviewCard call={call} onSaved={() => ctx.done()} />;
    return <Text testID="card-not-set-up" style={s.dim}>This part is not set up yet. You can do it later from the checklist on Home.</Text>;
  }, [call, cards, aiProvider, progress, onAddSpace, mac, address, onGo, personalCall, personName]);

  // the shell stays mounted underneath, so closing the screen returns to exactly where the person was
  return (
    <>
      {children}
      {shown && flow ? (
        <View style={s.fill}>
          <OnboardingScreen flow={flow} spaceName={space.name} progress={progress} stepKey={step} live={hasAi && runtime !== null && person !== null} {...(hasAi && runtime && person ? { liveChat: <AssistantThread rt={runtime} person={person} flow={flow} step={step} progress={progress} /> } : {})} onOpenStep={setStep} onStep={onStep} onClose={() => { setShown(false); setStep(null); }} renderCard={renderCard} renderPreview={(card) => <PreviewPane call={call} card={card} progress={progress} fallback={scriptFor(card, flow).preview} />} />
        </View>
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  fill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 50, backgroundColor: "var(--win)" as string },
  dim: { fontSize: 13, color: "var(--ink-3)" as string },
});
