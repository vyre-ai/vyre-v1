// Mount for P-L7b_11: the Console shell on the Northwind sample. ?page=overview (default) or ?page=audit picks the page; ?open=aud_001 opens an audit entry in the side sheet; ?viewer=member
// shows the locked state. Everything works against the sample replica (apps/console/src/shell/sample.ts).
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ConsoleShell } from "../../../apps/console/src/shell/ConsoleShell.tsx";
import { ConsoleDataProvider } from "../../../apps/console/src/shell/data.tsx";
import { createSampleConsole } from "../../../apps/console/src/shell/sample.ts";
import type { Viewer } from "../../../apps/console/src/shell/sample.ts";

export const title = "Console shell, Overview and Audit log";

export default function Mount(): ReactNode {
  // The query is read after mount: the static export renders the first frame without it, and the client must render that same frame or React leaves the exported markup behind.
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const params = useMemo(() => new URLSearchParams(search ?? ""), [search]);
  const viewer = (["owner", "developer", "member"] as const).find((v) => v === params.get("viewer")) ?? "owner";
  const sample = useMemo(() => createSampleConsole({ viewer: viewer as Viewer }), [viewer]);
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  const open = params.get("open");
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}>
      <ConsoleDataProvider value={sample.data}>
        <ConsoleShell key={`${viewer}-${params.get("page") ?? ""}`} initialPage={params.get("page") ?? "overview"} initialAudit={{ open: open ?? null }} skin={params.get("skin") ?? "system"} />
      </ConsoleDataProvider>
    </View>
  );
}
