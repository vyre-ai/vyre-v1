// Console > Space > Billing: the plan, what AI cost this month against the Space cap (the Spend and limits page sets it), and how much of the server's disk the Space uses.
import type { ReactElement } from "react";
import { View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Group, Lead, Section } from "../shell/ui.tsx";
import { Glyph } from "../shell/glyphs.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Button, useRead } from "./shared.tsx";

const GB = 1024 ** 3;
export const dollars = (micros: number): string => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: micros % 1e6 === 0 ? 0 : 2, maximumFractionDigits: micros % 1e6 === 0 ? 0 : 2 }).format(micros / 1e6);
export const spendLine = (spent: number, cap: number | undefined): string => cap === undefined ? `${dollars(spent)}, no limit set` : `${dollars(spent)} of ${dollars(cap)}`;
export function storageLine(machine: { diskFreeBytes?: number; diskTotalBytes?: number } | undefined): string {
  if (!machine || machine.diskTotalBytes === undefined || machine.diskFreeBytes === undefined) return "Not reported yet";
  const used = Math.max(0, machine.diskTotalBytes - machine.diskFreeBytes);
  return `${Math.round(used / GB)} of ${Math.round(machine.diskTotalBytes / GB)} GB`;
}

export function BillingPage(): ReactElement {
  const data = useConsoleData();
  const spend = useRead<CapMap["engine.spend.get"]["out"]>("engine.spend.get", { scope: "space" });
  const overview = useRead<CapMap["console.overview"]["out"]>("console.overview");
  return (
    <View testID="console-billing">
      <Section title="Plan">
        <Group>
          <Row id="billing-plan" title="Vyre design beta" note="Contact Clearfield Labs for plans and pricing" leading={<Lead><Glyph name="coins" size={16} color="var(--ink-3)" /></Lead>} />
          <Row id="billing-spend" title="AI spend this month" note={spend.data ? spendLine(spend.data.monthMicros, spend.data.caps.monthMicros) : spend.error ? "Not available" : "Checking"} leading={<Lead><Glyph name="chart" size={16} color="var(--ink-3)" /></Lead>}
            trailing={<Button label="Spend and limits" testID="billing-spend-open" onPress={() => data.nav.openPage("spend")} />} />
          <Row id="billing-storage" title="Storage" note={overview.data ? storageLine(overview.data.machine) : overview.error ? "Not available" : "Checking"} leading={<Lead><Glyph name="box" size={16} color="var(--ink-3)" /></Lead>} />
        </Group>
      </Section>
    </View>
  );
}
