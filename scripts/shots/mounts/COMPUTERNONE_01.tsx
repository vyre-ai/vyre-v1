// Mount for the agent-computer job: an agent that has no computer yet, in the Chats right pane's Computer tab, in each state the Space can be in. The button is there only when a host can run a
// computer; otherwise the real reason and the next step are, in words.
//   ?part=can (a host can run one), checking (the Space is being asked), runner (the server's container runner is not running), mac (Docker is not running on this Mac), space (no machine can run
//   one yet), member (a member: who sets it up), error (the Space did not answer)
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { NoneBody } from "../../../apps/app/src/places/chats/rightpane/ComputerTab.tsx";
import type { HostsAnswer } from "../../../apps/app/src/places/chats/rightpane/ComputerTab.tsx";

export const title = "Computer tab: no computer yet";

const ANSWERS: Record<string, { hosts: HostsAnswer; can: boolean }> = {
  can: { hosts: { state: "ready", available: true, hosts: [{ hostId: "space", name: "The Space", canRun: true }] }, can: true },
  checking: { hosts: { state: "loading" }, can: true },
  runner: { hosts: { state: "ready", available: false, hosts: [{ hostId: "space", name: "The Space", canRun: false, reason: "This server's container runner is not running, so agent computers cannot start. Start it: docker compose up -d sites-runner." }] }, can: true },
  mac: { hosts: { state: "ready", available: false, hosts: [{ hostId: "this", name: "This computer", canRun: false, reason: "Docker is not running on this Mac. Start Docker Desktop or Colima, then set up the computer." }] }, can: true },
  space: { hosts: { state: "ready", available: false, hosts: [] }, can: true },
  member: { hosts: { state: "ready", available: true, hosts: [{ hostId: "space", name: "The Space", canRun: true }] }, can: false },
  error: { hosts: { state: "error", message: "the Space did not answer" }, can: true },
};

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "can"), []);
  const { height, width } = useWindowDimensions();
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  const a = ANSWERS[part] ?? ANSWERS["can"]!;
  return (
    <View style={{ height, backgroundColor: "var(--win)" as string, alignItems: "center", paddingTop: 40 }}>
      <View style={{ width: Math.min(360, width - 24), borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 12, backgroundColor: "var(--side)" as string }}>
        <NoneBody hosts={a.hosts} canProvision={a.can} onProvision={() => undefined} />
      </View>
    </View>
  );
}
