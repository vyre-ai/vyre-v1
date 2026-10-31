// The Automations place: the shell sidebar slot holds the list, and the body holds the open Automation or an operational view.
import { ResizableColumn } from "../../../../../ui/src/SidePane/resize.tsx";
import { useConnectVersion } from "../connect/context.ts";
import { useEffect, useMemo, useState } from "react";
import { useOpenedId, usePlaceHash } from "../hash/context.tsx";
import { NotFound } from "../hash/NotFound.tsx";
import { useMissing } from "../hash/useMissing.ts";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { scrubAskContext } from "../../places/automations/ask/bundle.ts";
import { connectorOpening } from "../../places/vault/itemenv/automations.ts";
import { openAsk } from "./ask.ts";
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
import { SideTask } from "./automations-task.tsx";
import { AutomationRuns, FailedView, JourneyNewView, JourneyView, RunView, configExtras, runsData, useDirectory } from "./automations-parts.tsx";
import { AllRuns, Dependencies, LiveEvents, NeedsYou, Packages, SpaceAnalytics, TemplateGallery } from "../../places/automations/operations/StudioViews.tsx";
import { AutomationsStart } from "../../places/automations/start/AutomationsStart.tsx";
import { AskPane } from "../../places/records/askpane/index.ts";
import { RecordsAssistant } from "./records-ask.tsx";
import type { AskScope } from "./records-ask.tsx";
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
  // a task a run made, beside the run: its thread, brief and baton buttons (the Back button returns to the run)
  const [sideTask, setSideTask] = useState<string | null>(null);
  // Ask Vyre opens a pane beside the body, in this tab; it never goes to Chats.
  const [asking, setAsking] = useState(false);
  const setView = (next: StudioView): void => { setOverlay(null); setViewRaw(next); };
  const [keys, setKeys] = useState<readonly KeyChoice[]>([]);
  const [keysStatus, setKeysStatus] = useState<KeysStatus>("loading");
  const [accounts, setAccounts] = useState<readonly AccountOption[]>([]);
  const connectVersion = useConnectVersion();
  const [lastPicks, setLastPicks] = useState<Readonly<Record<string, string>> | undefined>(undefined);
  // the Automations row in the sidebar leaves the open automation (the hash keeps naming it, so that id is remembered as left)
  const [left, setLeft] = useState<string | null>(null);
  const openId = picked ?? (hashed !== null && hashed === left ? null : hashed);
  const goHome = (): void => { setOpenId(null); setLeft(hashed); setStep(null); setSideRun(null); setSideTask(null); };
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
  }, [rt, connectVersion]);
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
  }, [rt, connectVersion]);
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
    setUpConnector: async (offer) => {
      // the offer holds an item id and a name; the handle comes from the Vault, which never sends a value
      const got = (await rt.call("vault.item.get", { itemId: offer.itemId })) as { item?: { handle?: string; name?: string } } | null;
      const handle = got?.item?.handle;
      if (!handle) throw new Error("Vyre could not find that Vault item. It may have moved to Trash.");
      openAsk(rt, "assistant", { kind: "vault_item", id: offer.itemId, title: offer.appName }, undefined, connectorOpening({ name: got?.item?.name ?? offer.appName, handle }));
    },
  }, keys, keysStatus, accounts, lastPicks), [rt, opened, keys, keysStatus, accounts, lastPicks]);
  const directory = useDirectory(rt);
  const extras = useMemo(() => configExtras(directory, {
    openAutomation: (id) => data.nav.openAutomation(id),
    openRuns: (id) => { data.nav.openAutomation(id); setSideRun(null); },
    // a Journey's records open in Records on their board
    openRecords: (type) => rt.open({ screen: "records.saved-views", args: { type, kind: "board" } }),
  }), [directory, data, rt]);
  const runs = useMemo(() => runsData(rt, {
    openAutomation: (id, stepId) => { data.nav.openAutomation(id); if (stepId) setStep(stepId); },
    openRun: (runId) => data.nav.openRun(runId),
    openRunSide: (runId) => { setSideTask(null); setSideRun(runId); },
    openTaskSide: (taskId) => setSideTask(taskId),
    ask: (id, context) => data.nav.ask(id, context),
  }), [rt, data]);
  const winW = useWindowDimensions().width;
  const phone = winW > 0 && winW < 720;   // the phone has no sidebar beside the body: the list is the first screen
  const sideTaskView = sideTask ? <SideTask rt={rt} taskId={sideTask} onBack={() => setSideTask(null)} onOpen={(type, id) => rt.open(type === "task" ? { screen: "tasks.page", args: { taskId: id } } : { subject: { type, id } })} /> : null;
  const canvas = openId ? (
    phone && sideRun ? (
      // on the phone a run takes the whole screen; Close goes back to the editor
      <View style={s.main}>
        <View style={s.sideHead}><TextButton label="Back" icon="x" testID="close-side-run" onPress={() => (sideTask ? setSideTask(null) : setSideRun(null))} /></View>
        {sideTask ? sideTaskView : <RunView runId={sideRun} />}
      </View>
    ) : <View style={s.withSide}>
      <View style={s.main}>
        <AutomationCanvas
          key={`${openId}:${step ?? ""}`} automationId={openId}
          tabBodies={{ runs: <AutomationRuns automationId={openId} selectedRunId={sideRun} /> }}
          {...(step ? { initialSelected: step, initialPanel: true } : {})}
        />
      </View>
      {sideRun ? <ResizableColumn paneKey="automation-run-side" defaultWidth={380} grow="left" min={280} style={s.side as never}><View style={s.sideHead}>{sideTask ? <TextButton label="Back to the run" icon="x" testID="close-side-task" onPress={() => setSideTask(null)} /> : null}<TextButton label="Close" icon="x" testID="close-side-run" onPress={() => { setSideTask(null); setSideRun(null); }} /></View>{sideTask ? sideTaskView : <RunView runId={sideRun} />}</ResizableColumn> : null}
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
    : <AutomationsStart onTemplates={() => setView("templates")} onAsk={() => setAsking(true)} />;
  return (
    <AutomationsDataProvider value={data}>
      <RunsDataProvider value={runs}>
        <ConfigExtrasProvider value={extras}>
          <View style={s.page} testID="automations-place">
            {phone ? null : <AutomationsSidebarSlot selectedId={openId} view={view} onView={setView} onHome={goHome} />}
            <View style={s.main}>
              {phone && view !== "automations" && !openId ? <Pressable accessibilityRole="button" testID="phone-back-to-list" onPress={() => setView("automations")} style={s.backChip}><Text style={s.backText}>{"‹ Automations"}</Text></Pressable> : null}
              {main}
            </View>
            {asking ? <AskPane about={{}} paneKey="automations-ask" idPrefix="automations-ask" hint="Say what you want to automate. I will draft it and you decide what to keep." onClose={() => setAsking(false)}><RecordsAssistant rt={rt} about={{}} scope={ASK_AUTOMATIONS} /></AskPane> : null}
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

/** What the in-tab Ask pane tells the assistant: it is in Automations, with the focus skill for it. Ids and names only. */
const ASK_AUTOMATIONS: AskScope = {
  type: "automations", id: "place", title: "Automations",
  context: { title: "Automations", actions: ["propose an automation", "suggest a template", "explain a failed run"], focus: "focus-automations" },
};

const s = StyleSheet.create({
  phoneList: { flex: 1, minHeight: 0 },
  phoneSearch: { height: 36, marginHorizontal: 12, marginTop: 10, paddingHorizontal: 12, borderRadius: 9, backgroundColor: "var(--sunk)" as string, color: "var(--ink)" as string, fontSize: 14 },
  backChip: { height: 36, justifyContent: "center", paddingHorizontal: 14 },
  backText: { fontSize: 14, color: "var(--accent)" as string },
  page: { flex: 1, flexDirection: "row", backgroundColor: "var(--win)" as string },
  main: { flex: 1, minWidth: 0 },
  withSide: { flex: 1, flexDirection: "row", minWidth: 0 },
  sideHead: { alignItems: "flex-end", padding: 6 },
  side: { width: 380, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string },
});
