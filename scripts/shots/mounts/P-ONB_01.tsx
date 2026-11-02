// Mount for P-ONB_01: the onboarding screens (owner flowchart): first launch doors, then the step rail, chat and preview for a Personal Space, a Team owner and a member.
//   /m/P-ONB_01?view=doors | personal-ai | personal-interview | personal-sessions | personal-folders | personal-folders-live | personal-chrome | personal-phone | personal-win
//                  | personal-team | personal-skipped | team-org | team-ai | team-ai-mine | team-workspace | team-signin | team-people | team-invites | team-agents | team-shared
//                  | team-win | member-own | member-ai | finished
// The desktop app is faked for the sessions and folders steps (a __TAURI__ invoke that finds six sessions and picks ~/Claude/Orgs/Vyre), so those cards draw as on a Mac.
// The query is read after mount (the static export keeps first-render markup), so the first frame is the blank page.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { Composer } from "../../../ui/src/Composer/index.tsx";
import { ChromeCard } from "../../../apps/app/src/onboarding/ChromeCard.tsx";
import { FirstWinCard } from "../../../apps/app/src/onboarding/FirstWinCard.tsx";
import { FoldersCard } from "../../../apps/app/src/onboarding/FoldersCard.tsx";
import { PreviewPane } from "../../../apps/app/src/onboarding/PreviewPane.tsx";
import { SessionsCard } from "../../../apps/app/src/onboarding/SessionsCard.tsx";
import { StepAsk } from "../../../apps/app/src/onboarding/StepAsk.tsx";
import { KitPickCard } from "../../../apps/app/src/onboarding/KitPickCard.tsx";
import { SpaceAiCard } from "../../../apps/app/src/onboarding/SpaceAiCard.tsx";
import { DirectoryCard, InvitesCard, SignInDomainCard, WorkspaceCard } from "../../../apps/app/src/onboarding/SuiteCards.tsx";
import { ConnectAiCard } from "../../../apps/app/src/onboarding/ConnectAiCard.tsx";
import { FirstLaunch } from "../../../apps/app/src/onboarding/FirstLaunch.tsx";
import { InterviewCard } from "../../../apps/app/src/onboarding/InterviewCard.tsx";
import { OnboardingScreen } from "../../../apps/app/src/onboarding/OnboardingScreen.tsx";
import type { CardContext } from "../../../apps/app/src/onboarding/OnboardingScreen.tsx";
import { PairPhoneCard } from "../../../apps/app/src/onboarding/PairPhoneCard.tsx";
import { TeamBridgeCard } from "../../../apps/app/src/onboarding/TeamBridgeCard.tsx";
import { stepsOf } from "../../../apps/app/src/onboarding/flow.ts";
import type { CardKind, FlowKind, Progress } from "../../../apps/app/src/onboarding/flow.ts";

export const title = "Onboarding";

const call = (async () => ({})) as never;
let mounted = false;
// the Space a Mac app talks to, as far as these cards ask: this computer, the Personal top folder, and the folder once it is added
const desk = (async (cap: string) => {
  if (cap === "devices.mine") return { devices: [{ id: "dev_1", name: "This Mac", class: "desktop", current: true }] };
  if (cap === "files.tree") return { roots: [{ key: "personal", title: "Personal", kind: "folder", folderId: "fld_top", count: 0 }] };
  if (cap === "files.list") return { folders: [] };
  if (cap === "mounts.add") { mounted = true; return { mountId: "mnt_1", folderId: "fld_m", runId: "run_1" }; }
  if (cap === "mounts.list") return { mounts: mounted ? [{ mountId: "mnt_1", name: "Vyre", kind: "local" }] : [] };
  return {};
}) as never;
// a fresh Team Space: the shipped sample Kits are in the catalog (setup must not offer them), no Space AI key yet, the Space AI providers OpenCode Go first
const teamCall = (async (cap: string) => {
  if (cap === "kits.list") return { kits: [{ kitId: "kit_h", key: "harbor-studio", title: "Harbor Studio", installed: false }, { kitId: "kit_l", key: "law-firm-intake", title: "Law firm intake", installed: false }, { kitId: "kit_d", key: "default", title: "Default Kit", installed: true }] };
  if (cap === "providers.space_key.get") return { set: false, models: [], mayManage: true };
  if (cap === "providers.catalog") return { providers: [["anthropic", "Anthropic"], ["opencode-go", "OpenCode Go"], ["openai", "OpenAI"], ["openrouter", "OpenRouter"], ["xai", "xAI"]].map(([key, name]) => ({ key, name, connections: ["api_key"], modelsSource: "", engine: key })) };
  if (cap === "providers.list") return { providers: [] };
  if (cap === "members.invites.list") return { invites: [] };
  return {};
}) as never;
const HOUR = 3_600_000;
const SESSIONS = [
  ["claude", "a1", "/Users/maya/Claude/Orgs/Vyre", "Onboarding step bar", 1],
  ["codex", "b2", "/Users/maya/code/site", "Fix the login redirect", 5],
  ["claude", "c3", "/Users/maya/Claude/Orgs/Vyre", "Release notes for rc.14", 27],
  ["claude", "d4", "/Users/maya/code/api", "Rate limits on the public API", 50],
  ["codex", "e5", "/Users/maya/code/site", "Dark mode for the pricing page", 120],
  ["claude", "f6", "/Users/maya/Claude/Orgs/Vyre", "Folder sync notes", 400],
] as const;
function fakeDesktop(): void {
  const now = Date.now();
  const found = SESSIONS.map(([provider, id, cwd, title, h]) => ({ provider, sessionId: id, sessionKey: `${provider}:${id}`, projectKey: cwd, cwd, title, updatedAt: String(now - h * HOUR) }));
  (globalThis as { __TAURI__?: unknown }).__TAURI__ = { core: { invoke: async (cmd: string) => (cmd === "discover_session_sources" ? found : cmd === "pick_paths" ? ["/Users/maya/Claude/Orgs/Vyre"] : {}) } };
}
const pickVyre = async (cmd: string): Promise<unknown> => (cmd === "pick_paths" ? ["/Users/maya/Claude/Orgs/Vyre"] : {});

/** The Assistant chat as it sits under a step once an AI account is connected: the step's own line and suggestions, then the composer. A stand-in for the live thread, which needs a Space. */
function LiveStandIn({ prompt, suggestions }: { prompt: string; suggestions: readonly string[] }): ReactNode {
  return (
    <View style={{ flex: 1, justifyContent: "space-between" }}>
      <StepAsk ask={{ prompt, suggestions }} onPick={noop} />
      <View style={{ padding: 8 }}><Composer whoWillAnswer="Assistant will reply" placeholder="Ask about this step" density="compact" /></View>
    </View>
  );
}
const noop = (): void => undefined;

function card(kind: CardKind, view: string, ctx: CardContext): ReactNode {
  void ctx;
  if (kind === "connect_ai") return <ConnectAiCard call={call} onConnected={noop} />;
  if (kind === "interview") return <InterviewCard call={call} onSaved={noop} />;
  if (kind === "phone") return <PairPhoneCard call={call} address="https://space.example" />;
  if (kind === "bridge_team") return <TeamBridgeCard mac onCreate={noop} />;
  if (kind === "import_sessions") return <SessionsCard call={call} onDone={ctx.done} gate={ctx.gate} />;
  if (kind === "local_folders") return <FoldersCard call={desk} gate={ctx.gate} invoke={pickVyre} />;
  if (kind === "chrome") return <ChromeCard call={call} device="mac" onConnected={noop} gate={ctx.gate} />;
  if (kind === "first_win") return <FirstWinCard call={call} hasAi gate={ctx.gate} />;
  if (kind === "space_ai") return <SpaceAiCard team={teamCall} personal={view === "team-ai-mine" ? call : null} onConnected={noop} gate={ctx.gate} initial={view === "team-ai-mine" ? "mine" : "space"} />;
  if (kind === "org") return <KitPickCard call={teamCall} spaceName="" onInstalled={noop} gate={ctx.gate} />;
  if (kind === "google_microsoft") return <WorkspaceCard call={teamCall} onOpenConsole={noop} onDone={noop} gate={ctx.gate} />;
  if (kind === "sign_in_domain") return <SignInDomainCard call={teamCall} onOpenConsole={noop} onDone={noop} gate={ctx.gate} />;
  if (kind === "directory") return <DirectoryCard call={teamCall} by="Dana" space="Northwind" onOpenConsole={noop} onDone={noop} gate={ctx.gate} />;
  if (kind === "invites") return <InvitesCard call={teamCall} onDone={noop} gate={ctx.gate} />;
  return <Text style={{ fontSize: 13, color: "var(--ink-3)" as string }}>{view}</Text>;
}

const SCREENS: Record<string, { flow: FlowKind; step: string | null; progress?: Progress; space: string }> = {
  "personal-ai": { flow: "personal", step: "ai", space: "Personal" },
  "personal-interview": { flow: "personal", step: "interview", progress: { ai: "done" }, space: "Personal" },
  "personal-sessions": { flow: "personal", step: "sessions", progress: { ai: "done", interview: "done" }, space: "Personal" },
  "personal-folders": { flow: "personal", step: "folders", progress: { ai: "done", interview: "done", sessions: "done" }, space: "Personal" },
  "personal-folders-live": { flow: "personal", step: "folders", progress: { ai: "done", interview: "done", sessions: "done" }, space: "Personal" },
  "personal-chrome": { flow: "personal", step: "chrome", progress: { ai: "done", interview: "done", sessions: "later", folders: "done" }, space: "Personal" },
  "personal-skipped": { flow: "personal", step: "chrome", progress: { ai: "done", interview: "later", sessions: "later", folders: "later" }, space: "Personal" },
  "personal-win": { flow: "personal", step: "win", progress: { ai: "done", interview: "done", sessions: "done", folders: "done", chrome: "later", phone: "later" }, space: "Personal" },
  "personal-phone": { flow: "personal", step: "phone", progress: { ai: "done", interview: "done", sessions: "later", folders: "later", chrome: "done" }, space: "Personal" },
  "personal-team": { flow: "personal", step: "team", progress: { ai: "done", interview: "done", sessions: "done", folders: "later", chrome: "done", phone: "done", win: "done" }, space: "Personal" },
  "team-org": { flow: "team", step: "org", space: "spc_2a7c98c337e1dfd2e05e1aab" },
  "team-ai": { flow: "team", step: "space_ai", progress: { org: "done" }, space: "Northwind" },
  "team-ai-mine": { flow: "team", step: "space_ai", progress: { org: "done" }, space: "Northwind" },
  "team-workspace": { flow: "team", step: "workspace", progress: { org: "done", space_ai: "done" }, space: "Northwind" },
  "team-signin": { flow: "team", step: "sign_in", progress: { org: "done", space_ai: "done", workspace: "later" }, space: "Northwind" },
  "team-people": { flow: "team", step: "people", progress: { org: "done", space_ai: "done", workspace: "later", sign_in: "later" }, space: "Northwind" },
  "team-invites": { flow: "team", step: "invites", progress: { org: "done", space_ai: "done", workspace: "later", sign_in: "later", people: "later" }, space: "Northwind" },
  "team-agents": { flow: "team", step: "agents", progress: { org: "done", space_ai: "done", invites: "done" }, space: "Northwind" },
  "team-shared": { flow: "team", step: "shared", progress: { org: "done", space_ai: "done", invites: "done" }, space: "Northwind" },
  "team-win": { flow: "team", step: "win", progress: { org: "done", space_ai: "done", invites: "done" }, space: "Northwind" },
  "member-own": { flow: "member", step: "mine", space: "Northwind" },
  "member-ai": { flow: "member", step: "ai", progress: { mine: "done" }, space: "Northwind" },
};

export default function Mount(): ReactNode {
  const [view, setView] = useState<string | null>(null);
  const width = useWindowDimensions().width;
  useEffect(() => { fakeDesktop(); setView(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("view") ?? "personal-ai"); }, []);
  if (view === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  if (view === "doors") return <FirstLaunch onDoor={async () => undefined} existing={null} />;
  if (view === "finished") {
    const all = Object.fromEntries(stepsOf("member").map((s) => [s.key, "done" as const]));
    return <OnboardingScreen key={view} flow="member" spaceName="Northwind" progress={all} onStep={noop} onClose={noop} />;
  }
  const s = SCREENS[view] ?? SCREENS["personal-ai"]!;
  const live = view === "personal-interview" || view === "team-ai" || view === "personal-folders-live";
  // a computer runs the desktop steps; a phone-sized window is the phone
  const device = width > 0 && width <= 520 ? "phone" as const : "mac" as const;
  return (
    <OnboardingScreen
      key={view} flow={s.flow} spaceName={s.space} progress={s.progress ?? {}} stepKey={s.step} live={live} device={device} onStep={noop} onClose={noop} renderCard={(k, ctx) => card(k, view, ctx)}
      renderLive={(_st, ask) => <LiveStandIn prompt={ask.prompt} suggestions={ask.suggestions} />}
      renderPreview={(k) => (k === "local_folders" ? <PreviewPane call={desk} card={k} progress={s.progress ?? {}} fallback="" /> : null)}
    />
  );
}
