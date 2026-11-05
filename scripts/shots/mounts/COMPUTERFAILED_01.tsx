// Mount for the agent-computer failure states in the Chats right pane's Computer tab, from the real words the panel uses (actions.ts computerWords): a wake the server refused, and a provision the server
// refused, each as an admin and as a member.
//   ?part=wake-admin / wake-member (this server has no agent computers yet, by role), wake-refused (any other refusal, the server's words), provision-unavailable (computers.provision answered provider.unavailable)
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { FailedBody, NoneBody, RefusedBody } from "../../../apps/app/src/places/chats/rightpane/ComputerTab.tsx";
import { computerWords } from "../../../apps/app/src/places/chats/rightpane/actions.ts";

export const title = "Computer tab: a computer that could not start";

const NO_IMAGE = "The computer could not be created: This server can't start agent computers yet.\nDetails: the agent computer image vyre/computer:1 is not on this server and could not be fetched (offline). Load it with: docker pull vyre/computer:1";
const UNAVAILABLE = "The computer could not be created: The container runtime did not answer.";
const HOSTS = { state: "ready" as const, available: true, hosts: [{ hostId: "space", kind: "space" as const, name: "Northwind server", canRun: true, detail: "8 GB, 4 cores" }] };

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "wake-admin"), []);
  const { height, width } = useWindowDimensions();
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  const card = (n: ReactNode): ReactNode => (
    <View style={{ height, backgroundColor: "var(--win)" as string, alignItems: "center", paddingTop: 40 }}>
      <View style={{ width: Math.min(360, width - 24), borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 12, backgroundColor: "var(--side)" as string }}>{n}</View>
    </View>
  );
  if (part === "provision-unavailable") {
    const w = computerWords({ message: UNAVAILABLE, code: "provider.unavailable" }, true, "Dex");
    return card(<><RefusedBody name="Dex" sentence={w.sentence} details={w.details} onCopy={() => undefined} {...(w.server ? { onAction: () => undefined, actionLabel: "Open Console > Computers" } : {})} /><NoneBody name="Dex" hosts={HOSTS} canProvision onProvision={() => undefined} /></>);
  }
  const raw = part === "wake-refused" ? "A computer reaches only the Vault channel." : NO_IMAGE;
  const admin = part !== "wake-member";
  const w = computerWords({ message: raw }, admin, "Dex");
  const again = w.server ? (admin ? { onAgain: () => undefined, againLabel: "Open Console > Computers" } : {}) : { onAgain: () => undefined };
  return card(<FailedBody name="Dex" reason={w.sentence} details={`Dex's computer cmp_demo\nstate: asleep\nreason: ${w.details}`} onCopy={() => undefined} {...again} />);
}
