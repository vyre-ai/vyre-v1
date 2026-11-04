// Mount for lane l-backup (owner, 4 Nov): the "Runs on" menu of an automation's AI step, where an account that cannot run an automation here is greyed (engine.accounts.list with place "automation" says
// which, and why: the reason is the hover text). Over the Northwind sample, with the step "Draft a personal reply" open; ?part=menu has the menu open.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { AutomationCanvas } from "../../../apps/app/src/places/automations/canvas/AutomationCanvas.tsx";
import { AutomationsDataProvider } from "../../../apps/app/src/places/automations/canvas/data.tsx";
import { createSampleAutomations, northwind } from "../../../apps/app/src/places/automations/sidebar/sample.ts";

export const title = "Automation AI step: Runs on";

export default function Mount(): ReactNode {
  const sample = useMemo(() => createSampleAutomations(northwind), []);
  const data = useMemo(() => ({
    ...sample.data,
    keys: [
      { id: "key_claude", name: "Your Claude sign-in", kind: "subscription" as const, usable: false, why: "Turn on \"Let the Space run work on my subscription\" for this account to use it here." },
      { id: "key_nw_openai", name: "Northwind OpenAI key", kind: "api" as const, usable: true },
      { id: "key_team_chat", name: "Team chat key", kind: "api" as const, usable: false, why: "An admin has not kept this account for this kind of work." },
      { id: "key_codex", name: "Codex", kind: "subscription" as const, usable: false, why: "Sign in to this account again." },
    ],
  }), [sample]);
  const { height } = useWindowDimensions();
  return (
    <AutomationsDataProvider value={data}>
      <View style={{ height, flexDirection: "row", backgroundColor: "var(--win)" as string }}>
        <AutomationCanvas automationId="aut_lead" initialSelected="draft" initialPanel />
      </View>
    </AutomationsDataProvider>
  );
}
