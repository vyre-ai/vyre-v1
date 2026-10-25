// Mount for P-L9_16: the Report a problem sheet over the Northwind sample window, "What is sent" expanded.
// ?state=sent shows the sheet after Send; ?state=offline shows it offline (Send queues).
import { useMemo } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ReportController, ReportSheet } from "../../../apps/app/src/shell/report/index.ts";
import { createSampleDeps } from "../../../apps/app/src/shell/report/sample.ts";

export const title = "Report a problem";

export default function Mount(): ReactNode {
  const state = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("state") ?? "";
  const ctl = useMemo(() => {
    const run = createSampleDeps({ online: state !== "offline" });
    const c = new ReportController(run.deps);
    c.open({ place: "records", itemId: "Referral fee log", hash: "table" });
    c.setNote("The intake form would not send");
    c.toggleExpanded();
    if (state === "sent") void c.send();
    return c;
  }, [state]);
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)" }}>
      <ReportSheet controller={ctl} online={state !== "offline"} autoFocus={false} />
    </View>
  );
}
