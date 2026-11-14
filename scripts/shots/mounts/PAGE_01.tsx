// Mount for ui/Page: ?v=page (head, subtitle, tabs, action, status line), ?v=failed (a failed child still has its head and its tabs), ?v=side (a side pane that opens on Details).
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { Page } from "../../../ui/src/Page/index.tsx";
import { LoadFailed } from "../../../ui/src/States/Loads.tsx";

export const title = "Page";
const tabs = [
  { id: "details", label: "Details" },
  { id: "activity", label: "Activity", count: 3 },
  { id: "files", label: "Files" },
];

export default function Mount(): ReactNode {
  const v =
    new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("v") ?? "page";
  const none = (): void => undefined;
  return (
    <View style={{ flex: 1, maxWidth: v === "side" ? 420 : undefined, backgroundColor: "var(--win)" as string }}>
      <Page
        title={v === "side" ? "Launch the new plan" : "Spend"}
        subtitle="What each agent cost this month, and who set the limit"
        tabs={tabs}
        tab="details"
        onTab={none}
        kind={v === "side" ? "side" : "page"}
        action={<Text style={{ color: "var(--accent)" as string, fontSize: 13 }}>Export</Text>}
        {...(v === "page" ? { status: { tone: "warn" as const, text: "Offline, showing your saved copy" } } : {})}
      >
        {v === "failed" ? (
          <LoadFailed what="spend" failure={{ message: "The server did not answer." }} />
        ) : (
          <Text style={{ color: "var(--ink)" as string }}>The content of the page.</Text>
        )}
      </Page>
    </View>
  );
}
