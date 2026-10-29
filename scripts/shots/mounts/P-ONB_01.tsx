// Mount for P-ONB_01: the onboarding screens (owner flowchart): first launch doors, then the step rail, chat and preview for a Personal Space, a Team owner and a member.
//   /m/P-ONB_01?view=doors | personal-ai | personal-key | personal-interview | personal-phone | personal-team | team-org | team-ai | member-own | member-ai | finished
// The query is read after mount (the static export keeps first-render markup), so the first frame is the blank page.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { ConnectAiCard } from "../../../apps/app/src/onboarding/ConnectAiCard.tsx";
import { FirstLaunch } from "../../../apps/app/src/onboarding/FirstLaunch.tsx";
import { InterviewCard } from "../../../apps/app/src/onboarding/InterviewCard.tsx";
import { OnboardingScreen } from "../../../apps/app/src/onboarding/OnboardingScreen.tsx";
import type { CardContext } from "../../../apps/app/src/onboarding/OnboardingScreen.tsx";
import { PairPhoneCard } from "../../../apps/app/src/onboarding/PairPhoneCard.tsx";
import { SameAccountOffer } from "../../../apps/app/src/onboarding/SameAccountOffer.tsx";
import { TeamBridgeCard } from "../../../apps/app/src/onboarding/TeamBridgeCard.tsx";
import { stepsOf } from "../../../apps/app/src/onboarding/flow.ts";
import type { CardKind, FlowKind, Progress } from "../../../apps/app/src/onboarding/flow.ts";

export const title = "Onboarding";

const call = (async () => ({})) as never;
const noop = (): void => undefined;
const acct = [{ providerId: "prv_1", providerKey: "anthropic", name: "Anthropic", itemId: "itm_1" }];

function card(kind: CardKind, view: string, ctx: CardContext): ReactNode {
  void ctx;
  if (kind === "connect_ai") return <ConnectAiCard call={call} onConnected={noop} />;
  if (kind === "interview") return <InterviewCard call={call} onSaved={noop} />;
  if (kind === "phone") return <PairPhoneCard call={call} address="https://space.example" />;
  if (kind === "bridge_team") return <TeamBridgeCard mac onCreate={noop} />;
  if (kind === "space_ai") return <View style={{ gap: 14 }}><SameAccountOffer personal={call} team={call} accounts={acct} onCopied={noop} /><ConnectAiCard call={call} onConnected={noop} /></View>;
  return <Text style={{ fontSize: 13, color: "var(--ink-3)" as string }}>{view}</Text>;
}

const SCREENS: Record<string, { flow: FlowKind; step: string | null; progress?: Progress; space: string }> = {
  "personal-ai": { flow: "personal", step: "ai", space: "Personal" },
  "personal-interview": { flow: "personal", step: "interview", progress: { ai: "done" }, space: "Personal" },
  "personal-phone": { flow: "personal", step: "phone", progress: { ai: "done", interview: "done", sessions: "later", folders: "later", chrome: "done" }, space: "Personal" },
  "personal-team": { flow: "personal", step: "team", progress: { ai: "done", interview: "done", sessions: "done", folders: "later", chrome: "done", phone: "done", win: "done" }, space: "Personal" },
  "team-org": { flow: "team", step: "org", space: "Northwind" },
  "team-ai": { flow: "team", step: "space_ai", progress: { org: "done" }, space: "Northwind" },
  "member-own": { flow: "member", step: "mine", space: "Northwind" },
  "member-ai": { flow: "member", step: "ai", progress: { mine: "done" }, space: "Northwind" },
};

export default function Mount(): ReactNode {
  const [view, setView] = useState<string | null>(null);
  useEffect(() => setView(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("view") ?? "personal-ai"), []);
  if (view === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  if (view === "doors") return <FirstLaunch onDoor={async () => undefined} existing={null} />;
  if (view === "finished") {
    const all = Object.fromEntries(stepsOf("member").map((s) => [s.key, "done" as const]));
    return <OnboardingScreen key={view} flow="member" spaceName="Northwind" progress={all} onStep={noop} onClose={noop} />;
  }
  const s = SCREENS[view] ?? SCREENS["personal-ai"]!;
  const live = view === "personal-interview" || view === "team-ai";
  return <OnboardingScreen key={view} flow={s.flow} spaceName={s.space} progress={s.progress ?? {}} stepKey={s.step} live={live} onStep={noop} onClose={noop} renderCard={(k, ctx) => card(k, view, ctx)} />;
}
