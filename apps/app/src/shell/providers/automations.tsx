// The Automations place: the shell sidebar slot holds the list, and the body holds the open Automation or an operational view.
import { useEffect, useMemo, useState } from "react";
import { useOpenedId, usePlaceHash } from "../hash/context.tsx";
import { NotFound } from "../hash/NotFound.tsx";
import { useMissing } from "../hash/useMissing.ts";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { scrubAskContext } from "../../places/automations/ask/bundle.ts";
import { AutomationsDataProvider } from "../../places/automations/canvas/data.tsx";
import type { AutomationsData, KeysStatus } from "../../places/automations/canvas/data.tsx";
import type { KeyChoice } from "../../places/automations/canvas/model.ts";
import { AutomationCanvas } from "../../places/automations/canvas/AutomationCanvas.tsx";
import { connectionRoute } from "../../places/automations/connect/route.ts";
import { AllRuns, Dependencies, LiveEvents, NeedsYou, Packages } from "../../places/automations/operations/StudioViews.tsx";
import { AutomationsSidebarSlot } from "../../places/automations/sidebar/AutomationsSidebarSlot.tsx";
import type { StudioView } from "../../places/automations/sidebar/AutomationsSidebarSlot.tsx";
import { keysFromProviders } from "../../places/automations/values/typed.ts";
import { nameOf } from "./misc-common.ts";
import { useOptionalShellRuntime } from "./runtime.tsx";
import type { ShellRuntime } from "./runtime.tsx";

export function automationsData(rt: ShellRuntime, nav: AutomationsData["nav"], keys: readonly KeyChoice[] = [], keysStatus?: KeysStatus): AutomationsData {
  return { screens: rt.screens, call: rt.call, me: { id: rt.me.id, name: rt.me.name }, name: nameOf(rt), keys, ...(keysStatus ? { keysStatus } : {}), nav, clock: () => ({ now: rt.clock().now }) };
}

function Loading(): ReactElement {
  return <View style={s.page} testID="automations-loading" />;
}

function Body({ rt }: { rt: ShellRuntime }): ReactElement {
  const { opened } = usePlaceHash();
  const hashed = useOpenedId(["automation"], ["automationId"]);
  const [picked, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<StudioView>("automations");
  const [keys, setKeys] = useState<readonly KeyChoice[]>([]);
  const [keysStatus, setKeysStatus] = useState<KeysStatus>("loading");
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
  const data = useMemo(() => automationsData(rt, {
    openAutomation: (id) => { setView("automations"); setOpenId(id); opened({ subject: { type: "automation", id } }); },
    openJourney: (id) => rt.open({ screen: "automations.sidebar", args: { journeyId: id } }),
    openFailedRuns: () => rt.open({ screen: "runs.failed" }),
    openRun: (runId) => rt.open({ subject: { type: "run", id: runId } }),
    ask: (id, context) => {
      const bundle = scrubAskContext({ ...(context ?? {}), resource: context?.resource ?? id });
      rt.open({ screen: "chats.conversation", args: { with: "assistant", about: id, context: bundle } });
    },
    connect: (target) => {
      const route = connectionRoute(target);
      rt.open({ screen: route.screen, args: route.args });
    },
    openKeys: () => rt.open({ screen: "vault.providers" }),
  }, keys, keysStatus), [rt, opened, keys, keysStatus]);
  const main = view === "needs" ? <NeedsYou />
    : view === "runs" ? <AllRuns />
    : view === "events" ? <LiveEvents />
    : view === "dependencies" ? <Dependencies />
    : view === "packages" ? <Packages />
    : openId && missing ? <NotFound what="automation" />
    : openId ? <AutomationCanvas key={openId} automationId={openId} />
    : <Text style={s.hint}>Pick an Automation to see its steps.</Text>;
  return (
    <AutomationsDataProvider value={data}>
      <View style={s.page} testID="automations-place">
        <AutomationsSidebarSlot selectedId={openId} view={view} onView={setView} />
        <View style={s.main}>{main}</View>
      </View>
    </AutomationsDataProvider>
  );
}

export default function AutomationsPlace(_props: { place: string }): ReactElement {
  const rt = useOptionalShellRuntime();
  return rt ? <Body rt={rt} /> : <Loading />;
}

const s = StyleSheet.create({
  page: { flex: 1, flexDirection: "row", backgroundColor: "var(--win)" as string },
  main: { flex: 1, minWidth: 0 },
  hint: { padding: 24, fontSize: 13.5, color: "var(--ink-3)" as string },
});
