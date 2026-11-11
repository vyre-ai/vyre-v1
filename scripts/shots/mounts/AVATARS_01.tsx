// Mount for the agent faces (lane l-artifacts):  the real Chats place (ChatsMounted over the sample Space's runtime) inside the whole shell, so its sidebar is drawn by the shared place sidebar slot (title, collapse, search
// field, and on a phone the list before the chat). ?screen=chat (default, Rivera intake open) or needs (the Needs you page). The query is read after mount (rule 25), so the first frame is empty
// and the client draws the same one.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { Shell } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import type { PlaceContext } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import { createSampleShell, samplePlace } from "../../../apps/app/src/shell/spaces/sample.tsx";
import { ChatsMounted } from "../../../apps/app/src/places/chats/mounts/ChatsMounted.tsx";
import { createMountSample } from "../../../apps/app/src/places/chats/mounts/sample.ts";
import { ConsoleDataProvider } from "../../../apps/app/src/console/shell/data.tsx";
import { createSampleConsole } from "../../../apps/app/src/console/shell/sample.ts";
import { AgentsRegister } from "../../../apps/app/src/console/pages/Agents.tsx";
import { START, step } from "../../../apps/app/src/places/chats/mounts/route.ts";
import type { Shown } from "../../../apps/app/src/places/chats/mounts/route.ts";
import { FacePicker } from "../../../ui/src/FacePicker/index.tsx";
import { Avatar, setAgentFaces, resetAssistant } from "../../../ui/src/Avatar/index.tsx";
import { formatFace } from "../../../ui/src/Avatar/agentface.ts";
import type { FaceSpec } from "../../../ui/src/Avatar/agentface.ts";

export const title = "Agent faces";

interface RootLike {
  setAttribute(name: string, value: string): void;
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
}


/** The faces the sample agents wear: one of each family, so a list shows them all. */
const FACES: Record<string, FaceSpec> = {
  agt_intake: { fam: "friends", i: 3, tint: 1 }, agt_docs: { fam: "faces", i: 10, tint: 4 }, agt_billing: { fam: "blobs", i: 2, tint: 2 },
  agt_research: { fam: "glass", i: 5, tint: 0 }, agt_scout: { fam: "emoji", e: "🦊", tint: 3 },
};
const wear = (): void => { resetAssistant(); setAgentFaces(Object.entries(FACES).map(([id, f]) => ({ id, face: formatFace(f) }))); };

function Page({ search }: { search: string }): ReactNode {
  const height = useWindowDimensions().height;
  const part = new URLSearchParams(search).get("part") ?? "chat";
  const skin = new URLSearchParams(search).get("skin") ?? "paper";
  const made = useMemo(() => {
    wear();
    const root = (globalThis as { document?: { documentElement?: RootLike } }).document?.documentElement;
    const themeRoot: ThemeRoot = { setAttribute: (n, v) => { root?.setAttribute(n, v); }, setProperty: (n, v) => { root?.style.setProperty(n, v); }, removeProperty: (n) => { root?.style.removeProperty(n); } };
    const theme = createThemeController({ personId: "irfad", spaceId: "nw", spaceSkin: { nw: skin, hb: skin, me: skin }, prefersDark: skin === "graphite", root: themeRoot, storage: null });
    const hub = createSampleShell({ openId: "nw", theme });
    hub.go("chats");
    // the agent page shows its Change the face button only to a person who may edit the agent: the owner
    const sample = createMountSample(part === "agent" ? { who: "owner" } : {});
    const shown: Shown = part === "agent" ? step(START, { t: "agent", agentId: "agt_intake" }) : part === "newagent" ? step(START, { t: "agent-form" }) : part === "tasks" ? step(START, { t: "tasks" }) : step(START, { t: "chat", threadId: "c1" });
    return { hub, theme, sample, shown };
  }, [part, skin]);
  if (part.startsWith("picker-")) {
    const fam = part.slice(7);
    const start = fam === "friends" ? "av1:friends:3:1" : fam === "faces" ? "av1:faces:10:4" : fam === "blobs" ? "av1:blobs:2:2" : fam === "glass" ? "av1:glass:5:0" : fam === "emoji" ? "av1:emoji:🦊:3" : "av1:faces:10:4";
    return <View style={{ height, backgroundColor: "var(--win)" as string }}><FacePicker key={fam} name="Intake" value={start} taken={[]} onDone={() => undefined} testID="face-picker" /></View>;
  }
  if (part === "console") {
    const agents = ["Intake", "Docs", "Billing", "Research", "Scout", "Assistant"].map((name, i) => ({ agentId: i === 5 ? "agt_assistant" : `agt_${name.toLowerCase()}`, name, role: i === 5 ? "assistant" : "Does the work", kind: i === 5 ? "assistant" : "agent", status: i === 1 ? "working" : i === 3 ? "asleep" : "awake", ownerId: "usr_irfad", hasComputer: i % 2 === 0, face: i === 5 ? "assistant" : formatFace(Object.values(FACES)[i % 5]!), accountPolicy: "asker", accountFallback: [], toolsAllowed: [], toolsDenied: [], vaultKeys: [], limits: {}, captureMode: "auto", templateVersion: 1, createdAt: 0, folderId: "fld_a" }));
    const base = createSampleConsole().data;
    const data = { ...base, screens: { ...base.screens, capQuery: (cap: string) => { const value = { status: "ready", data: cap === "agents.list" ? { agents } : { people: [] } }; return { subscribe: () => () => undefined, getSnapshot: () => value }; } } as never };
    return <View style={{ height, backgroundColor: "var(--win)" as string, padding: 24 }}><ConsoleDataProvider value={data}><AgentsRegister /></ConsoleDataProvider></View>;
  }
  if (part === "states") {
    const states = ["idle", "working", "asleep", "done"] as const;
    return (
      <View style={{ height, backgroundColor: "var(--win)" as string, padding: 32, gap: 20 }}>
        {(["faces", "friends", "blobs", "glass"] as const).map((fam) => (
          <View key={fam} style={{ flexDirection: "row", gap: 24, alignItems: "center" }}>
            {[20, 32, 96].map((size) => states.map((s) => <Avatar key={`${size}${s}`} name={`${fam} ${s}`} seedId="states" kind="agent" size={size} face={formatFace({ fam, i: fam === "glass" ? 5 : 3, tint: 4 })} state={s === "idle" ? undefined : s} testID={`state-${fam}-${size}-${s}`} />))}
          </View>
        ))}
      </View>
    );
  }
  const renderPlace = (ctx: PlaceContext): ReactNode => (ctx.place === "chats" ? <ChatsMounted key={ctx.spaceId} rt={made.sample.rt} initial={made.shown} window={{ start: 0, end: 500 }} /> : samplePlace(ctx));
  return <View style={{ height }}><Shell hub={made.hub} theme={made.theme} renderPlace={renderPlace} /></View>;
}

export default function Mount(): ReactNode {
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return <Page search={search} />;
}
