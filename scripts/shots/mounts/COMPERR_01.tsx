// Mount for the l-comp221 changes: the setup checklist of an agent computer (no sign-in step) and the engine error card for a server setup cause, a bare crash as the Space owner, and the same as a member.
//   ?part=setup-chrome / err-sandbox-admin / err-sandbox-member / err-crash-admin / err-crash-member
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { SettingUp } from "../../../apps/app/src/places/chats/rightpane/ComputerTab.tsx";
import { ErrorRowView } from "../../../apps/app/src/places/chats/conversation/MessageView.tsx";
import { statusView } from "../../../apps/app/src/places/chats/conversation/status.ts";

export const title = "Agent computer setup and the engine error card";

const stub = { showMenu: () => undefined, copy: () => undefined, retryTurn: () => undefined, errorNext: () => undefined } as never;

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "setup-chrome"), []);
  const { height, width } = useWindowDimensions();
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  const frame = (n: ReactNode): ReactNode => (
    <View style={{ height, backgroundColor: "var(--win)" as string, alignItems: "center", paddingTop: 40 }}>
      <View style={{ width: Math.min(420, width - 24), borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 12, backgroundColor: "var(--side)" as string, padding: 12 }}>{n}</View>
    </View>
  );
  if (part === "setup-chrome") return frame(<SettingUp name="Dex" step={2} where="the Northwind server" />);
  const admin = part.endsWith("admin");
  const data = part.startsWith("err-sandbox") ? { why: "sandbox" } : { exit: "1" };
  const v = statusView({ id: "b1", type: "turn_status", v: 1, traceId: "", data: { state: "failed", turnId: "trn_1", code: "engine.cli_error", ...data } } as never, { admin });
  if (v.kind !== "error") return frame(null);
  return frame(<ErrorRowView block={v.block} actions={stub} />);
}
