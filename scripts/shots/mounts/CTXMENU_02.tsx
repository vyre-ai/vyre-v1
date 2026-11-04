// Mount for CTXMENU_02 (lane l-calendar): the Artifacts page over scripted sites capabilities, so the shoot can right-click a row. The query is not read: one page.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ArtifactsPage } from "../../../apps/app/src/places/chats/mounts/ArtifactsPage.tsx";
import type { ShellRuntime } from "../../../apps/app/src/shell/providers/runtime.tsx";

export const title = "Right-click menu on an artifact";

const T = Date.UTC(2026, 10, 3, 4, 0);
const SITES = [
  { siteId: "sit_funnel", name: "Intake funnel", kind: "artifact", owner: "usr_irfad", state: "ready", updatedAt: T - 3_600_000 },
  { siteId: "sit_timeline", name: "Rivera case timeline", kind: "artifact", owner: "usr_dana", state: "ready", updatedAt: T - 86_400_000 },
  { siteId: "sit_pricing", name: "GT+ pricing calculator", kind: "artifact", owner: "usr_irfad", state: "ready", updatedAt: T - 3 * 86_400_000 },
];

export default function Mount(): ReactNode {
  const rt = useMemo(() => ({
    call: async (cap: string): Promise<unknown> => (cap === "sites.list" ? { sites: SITES } : {}),
    me: { id: "usr_irfad", name: "Irfad Imtiaz" }, space: { id: "spc_1", kind: "team", name: "My Legal Academy" }, open: () => undefined,
  }) as unknown as ShellRuntime, []);
  return <View style={{ flex: 1 }}><ArtifactsPage rt={rt} /></View>;
}
