// The Automations place in the shell (spec 3.7): the sidebar on the left, the open Automation's canvas on the right. The open Automation is this place's own state; a row opens it,
// and any other click (a run, the Failed runs row, Connections) goes out through the shell's door. Before the Space's runtime exists the place draws its loading frame.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AutomationsDataProvider } from "../../places/automations/canvas/data.tsx";
import type { AutomationsData } from "../../places/automations/canvas/data.tsx";
import { AutomationCanvas } from "../../places/automations/canvas/AutomationCanvas.tsx";
import { AutomationsSidebar } from "../../places/automations/sidebar/AutomationsSidebar.tsx";
import { nameOf } from "./misc-common.ts";
import { useOptionalShellRuntime } from "./runtime.tsx";
import type { ShellRuntime } from "./runtime.tsx";

export function automationsData(rt: ShellRuntime, nav: AutomationsData["nav"]): AutomationsData {
  return { screens: rt.screens, call: rt.call, me: { id: rt.me.id, name: rt.me.name }, name: nameOf(rt), keys: [], nav, clock: () => ({ now: rt.clock().now }) };
}

function Loading(): ReactElement {
  return <View style={s.page} testID="automations-loading"><View style={s.side} /></View>;
}

function Body({ rt }: { rt: ShellRuntime }): ReactElement {
  const [openId, setOpenId] = useState<string | null>(null);
  const data = useMemo(() => automationsData(rt, {
    openAutomation: (id) => setOpenId(id),
    openJourney: (id) => rt.open({ screen: "automations.sidebar", args: { journeyId: id } }),
    openFailedRuns: () => rt.open({ screen: "runs.failed" }),
    openRun: (runId) => rt.open({ subject: { type: "run", id: runId } }),
    ask: (id) => rt.open({ screen: "chats.conversation", args: { with: "assistant", about: id } }),
    connect: (service) => rt.open({ screen: "mail.connections", args: { service } }),
  }), [rt]);
  return (
    <AutomationsDataProvider value={data}>
      <View style={s.page} testID="automations-place">
        <View style={s.side}><AutomationsSidebar selectedId={openId} /></View>
        <View style={s.main}>{openId ? <AutomationCanvas key={openId} automationId={openId} /> : <Text style={s.hint}>Pick an Automation to see its steps.</Text>}</View>
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
  side: { width: 280, flexShrink: 0, borderRightWidth: 1, borderRightColor: "var(--line)" as string },
  main: { flex: 1, minWidth: 0 },
  hint: { padding: 24, fontSize: 13.5, color: "var(--ink-3)" as string },
});
