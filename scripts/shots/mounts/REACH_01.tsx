// Mount for reach (lane l-chrome2a): the agent computer popup with "on <machine>" under it, as a member and as an admin, in the real popup over the sample computer. ?part=
//   member       the person is a member: the machine name is a link that shows a peek, never the Console
//   member-open  the same, with the link pressed: name, Offline, the agents there, whose it is, Tell an admin
//   member-sent  the same after Tell an admin: one quiet line
//   admin        the person is an admin: the same label opens Console, Computers with the machine selected (the line under the shot says where)
//   owner        the machine is the person's own: it opens Settings, This device
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { ComputerPopup } from "../../../apps/app/src/places/chats/computer/ComputerPopup.tsx";
import { PopupDataProvider } from "../../../apps/app/src/places/chats/computer/data.tsx";
import { createSample } from "../../../apps/app/src/places/chats/computer/sample.ts";
import { PAGES } from "../../../apps/app/src/console/shell/nav.ts";
import type { Target, Viewer } from "../../../apps/app/src/shell/reach/reach.ts";

export const title = "Reach: where a machine link goes";

const NAMES: Record<string, string> = { usr_maya: "Maya", usr_ada: "Ada Reed", agt_scout: "Scout", agt_intake: "Intake" };
const ROW = { machineId: "srv_mac", kind: "computer", name: "Studio Mac", ownerId: "usr_maya", mine: false, online: false, draining: false, restricted: false, runs: { turns: 0, agentComputers: 1, sites: 0, automations: 0 }, can: ["claude_code"], limits: { maxTurns: 4, maxAgentComputers: 2 }, pinned: [{ agentId: "agt_scout" }], room: { score: 0, tightest: "offline" } };

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "member"), []);
  const [went, setWent] = useState("");
  const sample = useMemo(() => createSample("working"), []);
  const data = useMemo(() => {
    const kind = part ?? "member";
    const viewer: Viewer = kind === "admin"
      ? { id: "usr_ada", spaceId: "spc_1", consolePages: new Set(PAGES.map((p) => p.id)) }
      : kind === "owner" ? { id: "usr_maya", spaceId: "spc_1", consolePages: new Set() } : { id: "usr_sam", spaceId: "spc_1", consolePages: new Set() };
    const row = { ...ROW, mine: kind === "owner", online: kind === "owner" || kind === "admin" ? true : false };
    return {
      ...sample.data,
      call: async (cap: string, input: unknown): Promise<unknown> => {
        if (cap === "network.servers") return { servers: [{ serverId: "srv_mac", name: "Studio Mac" }] };
        if (cap === "machines.list") return { machines: [row] };
        if (cap === "machines.alerts") return { alerts: [] };
        if (cap === "access.request") return { request: { id: "arq_1" } };
        return sample.data.call(cap, input);
      },
      reach: { viewer, nameOf: (id: string) => NAMES[id] ?? id, open: (t: Target) => setWent(t.place === "console" ? `Opened Console › Computers, machine ${t.args?.["machineId"]}` : `Opened Settings › This device`) },
    };
  }, [part, sample]);
  useEffect(() => {
    sample.replica.put("computers", [{ id: "cmp_intake", computerId: "cmp_intake", agentId: "agt_intake", state: "working", tabs: 3, tabLimit: 8, host: "node", nodeId: "srv_mac", recording: false, caption: "Filling the county records form" }] as never);
  }, [sample]);
  useEffect(() => {
    if (part !== "member-open" && part !== "member-sent" && part !== "admin" && part !== "owner") return undefined;
    const doc = (globalThis as { document?: { querySelector(s: string): { click(): void } | null } }).document;
    let step = 0;
    const t = setInterval(() => {
      const host = doc?.querySelector("[data-testid='popup-host']");
      if (step === 0 && host && part !== "admin" && part !== "owner") { host.click(); step = 1; return; }
      if (step === 1 && part === "member-sent") { const tell = doc?.querySelector("[data-testid='popup-host-tell']"); if (tell) { tell.click(); step = 2; } return; }
      if (step === 0 && host && (part === "admin" || part === "owner")) { host.click(); step = 2; }
    }, 300);
    return () => clearInterval(t);
  }, [part]);
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return (
    <View style={{ flex: 1, minHeight: 700, backgroundColor: "var(--win)" as string }}>
      <PopupDataProvider value={data as never}><ComputerPopup data={data as never} /></PopupDataProvider>
      {went !== "" ? <Text testID="reach-went" style={{ position: "absolute", left: 24, bottom: 96, fontSize: 14, color: "#fff", backgroundColor: "#111", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}>{went}</Text> : null}
    </View>
  );
}
