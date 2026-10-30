// The Automations place: the shell sidebar slot holds the list, and the body holds the open Automation or an operational view.
import { useEffect, useMemo, useState } from "react";
import { useOpenedId, usePlaceHash } from "../hash/context.tsx";
import { NotFound } from "../hash/NotFound.tsx";
import { useMissing } from "../hash/useMissing.ts";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { scrubAskContext } from "../../places/automations/ask/bundle.ts";
import { AutomationsDataProvider } from "../../places/automations/canvas/data.tsx";
import type { AutomationsData, KeysStatus } from "../../places/automations/canvas/data.tsx";
import type { KeyChoice } from "../../places/automations/canvas/model.ts";
import { TextButton } from "../../places/automations/canvas/parts.tsx";
import { AutomationCanvas } from "../../places/automations/canvas/AutomationCanvas.tsx";
import { accountsFromVault, picksByApp } from "../../places/automations/connect/accounts.ts";
import type { AccountOption } from "../../places/automations/connect/accounts.ts";
import { connectionRoute } from "../../places/automations/connect/route.ts";
import { ConfigExtrasProvider } from "../../places/automations/config/data.tsx";
import { RunsDataProvider } from "../../places/automations/runs/data.tsx";
import { AutomationRuns, FailedView, JourneyNewView, JourneyView, RunView, configExtras, runsData, useDirectory } from "./automations-parts.tsx";
import { AllRuns, Dependencies, LiveEvents, NeedsYou, Packages, SpaceAnalytics, TemplateGallery } from "../../places/automations/operations/StudioViews.tsx";
import { Empty } from "../../places/automations/operations/parts.tsx";
import { AutomationsSidebarSlot, StudioNav } from "../../places/automations/sidebar/AutomationsSidebarSlot.tsx";
import { AutomationsSidebar } from "../../places/automations/sidebar/AutomationsSidebar.tsx";
import type { StudioView } from "../../places/automations/sidebar/AutomationsSidebarSlot.tsx";
import { keysFromProviders } from "../../places/automations/values/typed.ts";
import { nameOf } from "./misc-common.ts";
import { useOptionalShellRuntime } from "./runtime.tsx";
import type { ShellRuntime } from "./runtime.tsx";

export function automationsData(rt: ShellRuntime, nav: AutomationsData["nav"], keys: readonly KeyChoice[] = [], keysStatus?: KeysStatus, accounts?: readonly AccountOption[], lastPicks?: Readonly<Record<string, string>>): AutomationsData {
  return { screens: rt.screens, call: rt.call, me: { id: rt.me.id, name: rt.me.name }, name: nameOf(rt), keys, ...(keysStatus ? { keysStatus } : {}), ...(accounts ? { accounts } : {}), ...(lastPicks ? { lastPicks } : {}), nav, clock: () => ({ now: rt.clock().now }) };
}

type Overlay = { kind: "failed" } | { kind: "run"; id: string } | { kind: "journey"; id: string } | { kind: "journeyNew" };

function Loading(): ReactElement {
  return <View style={s.page} testID="automations-loading" />;
}

function Body({ rt }: { rt: ShellRuntime }): ReactElement {
  const { opened } = usePlaceHash();
  const hashed = useOpenedId(["automation"], ["automationId"]);
  const [picked, setOpenId] = useState<string | null>(null);
  const [view, setViewRaw] = useState<StudioView>("automations");
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [sideRun, setSideRun] = useState<string | null>(null);
  const setView = (next: StudioView): void => { setOverlay(null); setViewRaw(next); };
  const [keys, setKeys] = useState<readonly KeyChoice[]>([]);
  const [keysStatus, setKeysStatus] = useState<KeysStatus>("loading");
  const [accounts, setAccounts] = useState<readonly AccountOption[]>([]);
  const [lastPicks, setLastPicks] = useState<Readonly<Record<string, string>> | undefined>(undefined);
  const openId = picked ?? hashed;
  const missing = useMissing(rt.screens, "automations.canvas", "automation", openId ? { automationId: openId, route: { automationId: openId } } : null);
  useEffect(() => {
    let live = true;
    void rt.call("providers.list", {}).then((out) => {
      if (!live) return;
      const parsed = keysFromProviders(out);
      if (!parsed) { setKeys([]); setKeysStatus("unavailable"); return; }
      setKeys(parsed);
      setKeysStatus(parsed.length > 0 ? "ready" : "empty");
    }).catch(() => { if (live) { setKeys([]); setKeysStatus("unavailable"); } });
    return () => { live = false; };
  }, [rt]);
  useEffect(() => {
    let live = true;
    void Promise.all([
      rt.call("connections.list", { whose: "all" }),
      rt.call("mail.mailbox.list", { scope: "all" }),
      rt.call("automations.account_picks", {}),
    ]).then(([connectionsOut, mailOut, picksOut]) => {
      if (!live) return;
      const nextAccounts = accountsFromVault(connectionsOut, mailOut);
      const nextPicks = picksByApp(picksOut);
      if (!nextAccounts || !nextPicks) {
        setAccounts([]);
        setLastPicks(undefined);
        return;
      }
      setAccounts(nextAccounts);
      setLastPicks(nextPicks);
    }).catch(() => {
      if (!live) return;
      setAccounts([]);
      setLastPicks(undefined);
    });
    return () => { live = false; };
  }, [rt]);
  const data = useMemo(() => automationsData(rt, {
    openAutomation: (id) => { setView("automations"); setStep(null); setOpenId(id); opened({ subject: { type: "automation", id } }); },
    openJourney: (id) => { setViewRaw("automations"); setOverlay({ kind: "journey", id }); },
    newJourney: () => { setViewRaw("automations"); setOverlay({ kind: "journeyNew" }); },
    openFailedRuns: () => { setViewRaw("automations"); setOverlay({ kind: "failed" }); },
    openTemplates: () => setView("templates"),
    openRun: (runId) => { setViewRaw("automations"); setOverlay({ kind: "run", id: runId }); },
    ask: (id, context) => {
      const bundle = scrubAskContext({ ...(context ?? {}), resource: context?.resource ?? id });
      rt.open({ screen: "chats.conversation", args: { with: "assistant", about: id, context: bundle } });
    },
    connect: (target) => {
      const route = connectionRoute(target);
      rt.open({ screen: route.screen, args: route.args });
    },
    openKeys: () => rt.open({ screen: "vault.providers" }),
  }, keys, keysStatus, accounts, lastPicks), [rt, opened, keys, keysStatus, accounts, lastPicks]);
  const directory = useDirectory(rt);
  const extras = useMemo(() => configExtras(directory, {
    openAutomation: (id) => data.nav.openAutomation(id),
    openRuns: (id) => { data.nav.openAutomation(id); setSideRun(null); },
  }), [directory, data]);
  const runs = useMemo(() => runsData(rt, {
    openAutomation: (id, stepId) => { data.nav.openAutomation(id); if (stepId) setStep(stepId); },
    openRun: (runId) => data.nav.openRun(runId),
    openRunSide: (runId) => setSideRun(runId),
    ask: (id, context) => data.nav.ask(id, context),
  }), [rt, data]);
  const winW = useWindowDimensions().width;
  const phone = winW > 0 && winW < 720;   // the phone has no sidebar beside the body: the list is the first screen
  const canvas = openId ? (
    <View style={s.withSide}>
      <View style={s.main}>
        <AutomationCanvas
          key={`${openId}:${step ?? ""}`} automationId={openId}
          tabBodies={{ runs: <AutomationRuns automationId={openId} selectedRunId={sideRun} /> }}
          {...(step ? { initialSelected: step, initialPanel: true } : {})}
        />
      </View>
      {sideRun ? <View style={s.side}><View style={s.sideHead}><TextButton label="Close" icon="x" testID="close-side-run" onPress={() => setSideRun(null)} /></View><RunView runId={sideRun} /></View> : null}
    </View>
  ) : null;
  const main = overlay?.kind === "failed" ? <FailedView selectedRunId={sideRun} />
    : overlay?.kind === "run" ? <RunView runId={overlay.id} />
    : overlay?.kind === "journey" ? <JourneyView journeyId={overlay.id} />
    : overlay?.kind === "journeyNew" ? <JourneyNewView onClose={() => setOverlay(null)} />
    : view === "needs" ? <NeedsYou />
    : view === "runs" ? <AllRuns />
    : view === "events" ? <LiveEvents />
    : view === "analytics" ? <SpaceAnalytics />
    : view === "dependencies" ? <Dependencies />
    : view === "packages" ? <Packages />
    : view === "templates" ? <TemplateGallery />
    : openId && missing ? <NotFound what="automation" />
    : canvas
    ? canvas
    : phone ? <PhoneList view={view} onView={setView} />
    : <View style={s.hintWrap}><Empty testID="automations-start" title="Pick an automation" next="Choose one from the list to see its steps. To make a new one, use the plus beside Personal, or start from a working template." action="Start from a template" onAction={() => setView("templates")} /></View>;
  return (
    <AutomationsDataProvider value={data}>
      <RunsDataProvider value={runs}>
        <ConfigExtrasProvider value={extras}>
          <View style={s.page} testID="automations-place">
            {phone ? null : <AutomationsSidebarSlot selectedId={openId} view={view} onView={setView} />}
            <View style={s.main}>
              {phone && view !== "automations" && !openId ? <Pressable accessibilityRole="button" testID="phone-back-to-list" onPress={() => setView("automations")} style={s.backChip}><Text style={s.backText}>{"‹ Automations"}</Text></Pressable> : null}
              {main}
            </View>
          </View>
        </ConfigExtrasProvider>
      </RunsDataProvider>
    </AutomationsDataProvider>
  );
}

export default function AutomationsPlace(_props: { place: string }): ReactElement {
  const rt = useOptionalShellRuntime();
  return rt ? <Body rt={rt} /> : <Loading />;
}

/** The phone's first Automations screen: search, the list (Failed runs, Personal, Shared with me, Space), and the studio views (Templates, All runs ...) under it. A row opens that Automation. */
function PhoneList({ view, onView }: { view: StudioView; onView(next: StudioView): void }): ReactElement {
  const [q, setQ] = useState("");
  return (
    <View style={s.phoneList} testID="automations-phone-list">
      <TextInput value={q} onChangeText={setQ} placeholder="Search automations" placeholderTextColor="var(--ink-3)" accessibilityLabel="Search automations" style={s.phoneSearch} testID="automations-phone-search" />
      <AutomationsSidebar hosted query={q} selectedId={null} onChoose={() => onView("automations")} />
      <StudioNav view={view} onView={onView} />
    </View>
  );
}

const s = StyleSheet.create({
  phoneList: { flex: 1, minHeight: 0 },
  phoneSearch: { height: 36, marginHorizontal: 12, marginTop: 10, paddingHorizontal: 12, borderRadius: 9, backgroundColor: "var(--sunk)" as string, color: "var(--ink)" as string, fontSize: 14 },
  backChip: { height: 36, justifyContent: "center", paddingHorizontal: 14 },
  backText: { fontSize: 14, color: "var(--accent)" as string },
  page: { flex: 1, flexDirection: "row", backgroundColor: "var(--win)" as string },
  main: { flex: 1, minWidth: 0 },
  hintWrap: { padding: 24 },
  withSide: { flex: 1, flexDirection: "row", minWidth: 0 },
  sideHead: { alignItems: "flex-end", padding: 6 },
  side: { width: 380, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string },
});
