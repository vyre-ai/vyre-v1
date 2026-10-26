// Mount for P-L9_34 (the real Chats place, ChatsMounted over its runtime, so the sidebar fills the shared slot with data; the call comes after the place has drawn): the whole shell with the phone wired in. The softphone dock wraps the shell, so a call rings over any place and, once answered while another place is open, is the green pill in
// the title bar. ?state=ring leaves the call ringing (the dock's incoming sheet); ?state=live answers it (the title-bar pill). The place is Chats, as in P-L9_14c. State is read after mount (rule 25).
import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { Shell } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import type { PlaceContext } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import { ChatsMounted } from "../../../apps/app/src/places/chats/mounts/ChatsMounted.tsx";
import { createMountSample } from "../../../apps/app/src/places/chats/mounts/sample.ts";
import { createSampleShell, samplePlace } from "../../../apps/app/src/shell/spaces/sample.tsx";
import { createUnmatchedSample } from "../../../apps/app/src/places/inbox/unmatched/sample.ts";
import { PHONE_OF } from "../../../apps/app/src/places/inbox/softphone/sample.ts";

export const title = "Shell with the phone";

interface RootLike {
  setAttribute(name: string, value: string): void;
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
}
type Doc = { querySelector(s: string): { click?: () => void } | null };
const click = (id: string): void => (globalThis as { document?: Doc }).document?.querySelector(`[data-testid="${id}"]`)?.click?.();

export default function Mount(): ReactNode {
  const height = useWindowDimensions().height;
  const made = useMemo(() => {
    const g = globalThis as { location?: { search?: string }; document?: { documentElement?: RootLike } };
    const query = new URLSearchParams(g.location?.search ?? "");
    const skin = query.get("skin") ?? "paper";
    const root = g.document?.documentElement;
    const themeRoot: ThemeRoot = {
      setAttribute: (n, v) => { root?.setAttribute(n, v); },
      setProperty: (n, v) => { root?.style.setProperty(n, v); },
      removeProperty: (n) => { root?.style.removeProperty(n); },
    };
    const theme = createThemeController({ personId: "irfad", spaceId: "nw", spaceSkin: { nw: skin, hb: skin, me: skin }, prefersDark: skin === "graphite", root: themeRoot, storage: null });
    return { hub: createSampleShell({ openId: "nw", theme }), theme, phone: createUnmatchedSample(), chats: createMountSample(), state: query.get("state") ?? "live" };
  }, []);
  useEffect(() => {
    const timers = [setTimeout(() => { made.phone.device.ring(PHONE_OF["elena"]!); }, 2000)];
    if (made.state === "live") timers.push(setTimeout(() => click("softphone-answer"), 2600));
    return () => { for (const t of timers) clearTimeout(t); };
  }, [made]);
  return (
    <View style={{ height }}>
      <Shell hub={made.hub} theme={made.theme} renderPlace={(ctx: PlaceContext): ReactNode => (ctx.place === "chats" ? <ChatsMounted key={ctx.spaceId} rt={made.chats.rt} window={{ start: 0, end: 500 }} /> : samplePlace(ctx))} phone={{ device: made.phone.device, data: made.phone.data }} />
    </View>
  );
}
