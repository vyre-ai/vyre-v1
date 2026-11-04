// Mount for plain activity wording (lane l-learn2, owner 4 Nov): the Console over the Northwind sample. ?part=audit (the audit log) | overview (the last admin acts). The shell's own pages, so what shows is what ships.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { ConsoleDataProvider } from "../../../apps/app/src/console/shell/data.tsx";
import { createSampleConsole } from "../../../apps/app/src/console/shell/sample.ts";
import { ConsoleShell } from "../../../apps/app/src/console/shell/ConsoleShell.tsx";

export const title = "Plain activity wording";

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "audit"), []);
  const { width } = useWindowDimensions();
  const sample = useMemo(() => createSampleConsole(), []);
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return <ConsoleDataProvider value={sample.data}><View style={{ flex: 1, backgroundColor: "var(--win)" as string }}><ConsoleShell width={width} initialPage={part === "audit" ? "audit" : "overview"} /></View></ConsoleDataProvider>;
}
