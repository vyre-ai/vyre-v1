// Mount for the agent-computer job: an agent that has no computer yet, in the Chats right pane's Computer tab, in each state the Space can be in. The button is there only when a host can run a
// computer; otherwise the real reason and the next step are, in words.
//   ?part=can (a host can run one), checking (the Space is being asked), runner (the server's container runner is not running), mac (Docker is not running on this Mac), space (no machine can run
//   one yet), picks (two machines, the one with most room preselected), setup1 / setup3 (setting up, at a step), failed (the real reason, Copy details), ready / asleep (the whole pane on Computer: the picture is the open, one state chip, one footer line), about (About, with the Computer tab), nocomputer (About of an agent without one: one quiet row and the offer, no Computer or Terminal tab), member (a member: who sets it up), error (the Space did not answer)
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { FailedBody, NoneBody, SettingUp } from "../../../apps/app/src/places/chats/rightpane/ComputerTab.tsx";
import { ChatRightPane } from "../../../apps/app/src/places/chats/rightpane/ChatRightPane.tsx";
import { PersonProfile } from "../../../apps/app/src/places/chats/rightpane/PersonProfile.tsx";
import { createSample } from "../../../apps/app/src/places/chats/rightpane/sample.ts";
import type { ChatRightPaneData } from "../../../apps/app/src/places/chats/rightpane/data.tsx";
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

const HOSTS = { available: true, hosts: [
  { hostId: "space", kind: "space", name: "Northwind server", canRun: true, detail: "8 GB, 4 cores", room: { fits: 3, freeMb: 6144, totalMb: 8192 } },
  { hostId: "mac", kind: "this", name: "Maya's MacBook", canRun: true, detail: "16 GB, 8 cores", room: { fits: 1, freeMb: 2048, totalMb: 16384 } },
] };

function Pane({ withComputer, tab, asleep = false }: { withComputer: boolean; tab: "about" | "computer"; asleep?: boolean }): ReactNode {
  const s = useMemo(() => createSample(asleep ? "asleep" : "northwind"), [asleep]);
  const data: ChatRightPaneData = useMemo(() => ({
    ...s.data,
    agent: withComputer ? s.data.agent : { agentId: s.data.agent.agentId, name: s.data.agent.name },
    call: ((cap: string, input: unknown) => cap === "computers.hosts" ? Promise.resolve(HOSTS) : s.data.call(cap as never, input as never)) as ChatRightPaneData["call"],
  }), [s, withComputer]);
  return <View style={{ flex: 1, alignItems: "flex-end", backgroundColor: "var(--win)" as string }}><ChatRightPane data={data} open onToggle={() => undefined} initialTab={tab} window={{ start: 0, end: 500 }} /></View>;
}

const NOW = Date.UTC(2026, 10, 4, 21, 41);
const answer = (away: boolean) => (cap: string): Promise<unknown> => Promise.resolve(
  cap === "devices.presence" ? { people: [{ personId: "usr_sara", state: away ? "away" : "online", lastSeenAt: NOW - 4 * 60_000 }] }
  : cap === "settings.public_of" ? { timezone: "Europe/Berlin", hours: { days: [1, 2, 3, 4, 5], from: "09:00", to: "17:30" }, pronouns: away ? undefined : "they/them", title: "Account lead" }
  : cap === "threads.list" ? { threads: [{ threadId: "t1", kind: "chat", title: "Renewal redline", members: [{ kind: "person", id: "usr_sara" }, { kind: "person", id: "usr_irfad" }] }, { threadId: "t2", kind: "chat", title: "Portal launch", members: [{ kind: "person", id: "usr_sara" }] }] }
  : cap === "files.shared_with_me" ? { files: [{ fileId: "f1", name: "Renewal redline.docx", ownerId: "usr_sara" }, { fileId: "f2", name: "Portal launch plan", ownerId: "usr_sara" }], folders: [] }
  : cap === "tasks.list" ? { tasks: [{ id: "k1", title: "Check the renewal before Friday" }] } : {});

function Person({ away, tab }: { away: boolean; tab: "about" | "chats" | "files" | "tasks" }): ReactNode {
  return (
    <View style={{ flex: 1, alignItems: "flex-end", backgroundColor: "var(--win)" as string }}>
      <View style={{ width: 340, flex: 1, backgroundColor: "var(--side)" as string }}>
        <PersonProfile id="usr_sara" name="Sara Malik" call={answer(away)} now={() => NOW} onMessage={() => undefined} onMention={() => undefined} onCall={away ? undefined : () => undefined} copy={() => undefined}
          roles={[{ project: "Client portal launch", role: "Lead" }, { project: "Northwind renewal", role: "Reviewer" }]} openThread={() => undefined} openFile={() => undefined} openTask={() => undefined} initialTab={tab} />
      </View>
    </View>
  );
}

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "can"), []);
  const { height, width } = useWindowDimensions();
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  if (part === "person" || part === "away" || part === "personchats") return <Person away={part === "away"} tab={part === "personchats" ? "chats" : "about"} />;
  const a = ANSWERS[part] ?? ANSWERS["can"]!;
  if (part === "ready" || part === "asleep") return <Pane withComputer tab="computer" asleep={part === "asleep"} />;
  if (part === "about" || part === "nocomputer") return <Pane withComputer={part === "about"} tab="about" />;
  const card = (n: ReactNode): ReactNode => (
    <View style={{ height, backgroundColor: "var(--win)" as string, alignItems: "center", paddingTop: 40 }}>
      <View style={{ width: Math.min(360, width - 24), borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 12, backgroundColor: "var(--side)" as string }}>{n}</View>
    </View>
  );
  if (part === "setup1" || part === "setup3") return card(<SettingUp name="Dex" step={part === "setup1" ? 1 : 3} where="Northwind server" />);
  if (part === "failed") return card(<FailedBody name="Dex" reason="Docker could not pull the image: the server has no route to the registry. Check the server's network, then try again." details="Dex's computer cmp_demo\nstate: error\nruns on: Northwind server" onCopy={() => undefined} onAgain={() => undefined} />);
  if (part === "picks") return card(<NoneBody name="Dex" hosts={{ state: "ready", ...HOSTS }} canProvision onProvision={() => undefined} />);
  return (
    <View style={{ height, backgroundColor: "var(--win)" as string, alignItems: "center", paddingTop: 40 }}>
      <View style={{ width: Math.min(360, width - 24), borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 12, backgroundColor: "var(--side)" as string }}>
        <NoneBody hosts={a.hosts} canProvision={a.can} onProvision={() => undefined} />
      </View>
    </View>
  );
}
