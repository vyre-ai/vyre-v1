// Mount for Artifacts (lane l-artifacts): the card in a chat, the Artifacts grid inside Chats, and one artifact in its tab, over scripted sites capabilities. ?part=
//   card (default) the artifact card as a chat shows it   list   the grid, Mine   shared   Shared with me   empty   nothing published   view   one artifact open   loading   the page still loading   error   the page could not load
// The query is read after mount (the static export keeps the first frame's markup), so the first frame is empty and the client draws the same one.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { ChatsMounted } from "../../../apps/app/src/places/chats/mounts/ChatsMounted.tsx";
import { SidebarSlot, SidebarSlotProvider } from "../../../apps/app/src/shell/sidebar/index.ts";
import { createMountSample } from "../../../apps/app/src/places/chats/mounts/sample.ts";
import { START, step } from "../../../apps/app/src/places/chats/mounts/route.ts";
import type { ShellRuntime } from "../../../apps/app/src/shell/providers/runtime.tsx";
import { ArtifactBlock } from "../../../ui/src/blocks/impl-a/index.tsx";
import type { BlockHost } from "../../../ui/src/blocks/impl-a/index.tsx";

export const title = "Artifacts";

const ME = "usr_irfad";
const NOW = Date.UTC(2026, 10, 4, 16, 0);
const at = (d: number, h: number, m: number): number => Date.UTC(2026, 10, d, h, m);
interface Row { chatId?: string; chatTitle?: string; sharedWith?: string[]; siteId: string; name: string; kind: "artifact"; owner: string; state: "ready"; access: "private" | "space"; updatedAt: number }
const ROWS: Row[] = [
  { chatId: "t_portal", chatTitle: "Client portal launch", sharedWith: ["usr_sara"], siteId: "sit_pr", name: "Pricing comparison", kind: "artifact", owner: ME, state: "ready", access: "space", updatedAt: at(4, 15, 53) },
  { chatId: "t_nums", chatTitle: "Monthly numbers", siteId: "sit_q3", name: "Q3 revenue dashboard", kind: "artifact", owner: ME, state: "ready", access: "private", updatedAt: at(4, 10, 12) },
  { siteId: "sit_ob", name: "Onboarding checklist", kind: "artifact", owner: ME, state: "ready", access: "private", updatedAt: at(3, 14, 2) },
  { siteId: "sit_rn", name: "Renewal brief", kind: "artifact", owner: ME, state: "ready", access: "private", updatedAt: at(2, 9, 30) },
  { siteId: "sit_tl", name: "Launch timeline", kind: "artifact", owner: "usr_sara", state: "ready", access: "space", updatedAt: at(3, 11, 40) },
];
const PAGE = encodeURIComponent('<!doctype html><meta charset="utf-8"><body style="margin:0;font:15px -apple-system,Helvetica,sans-serif;color:#17141F"><div style="max-width:720px;margin:56px auto;padding:0 24px"><h1 style="font-size:28px;margin:0 0 6px">Choose a plan</h1><p style="color:#6A6578;margin:0 0 24px">Annual billing takes 15% off every plan.</p><div style="display:flex;gap:12px"><div style="flex:1;border:1px solid #ddd;border-radius:14px;padding:16px"><b>Starter</b><div style="font-size:26px;font-weight:600">$29</div>3 people, 1 agent</div><div style="flex:1;border:2px solid #5A3FF0;border-radius:14px;padding:16px"><b>Team</b><div style="font-size:26px;font-weight:600">$99</div>12 people, 5 agents</div><div style="flex:1;border:1px solid #ddd;border-radius:14px;padding:16px"><b>Studio</b><div style="font-size:26px;font-weight:600">$249</div>Unlimited people</div></div></div>');

function runtime(part: string): ShellRuntime {
  const base = createMountSample({ who: "member" }).rt;
  const rows = part === "empty" ? [] : ROWS;
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    const i = input as { siteId?: string; artifactId?: string };
    switch (cap) {
      case "sites.list": return { sites: rows };
      case "sites.get": { const s = ROWS.find((r) => r.siteId === i.siteId) ?? ROWS[0]!; return { site: s }; }
      case "sites.artifact_open":
        if (part === "error") throw new Error("This page couldn’t load here.");
        if (part === "loading") return new Promise(() => undefined);
        return { path: `/x/${"a".repeat(48)}`, url: `data:text/html;charset=utf-8,${PAGE}` };
      default: return base.call(cap, input);
    }
  };
  const people = { status: "ready" as const, data: [...(base.principals.getSnapshot() as { data?: { id: string; name: string; kind: "person" | "agent" }[] }).data ?? [], { id: "usr_sara", name: "Sara Malik", kind: "person" as const }] };
  return { ...base, call: call as ShellRuntime["call"], me: { ...base.me, id: ME, name: "Irfad Imtiaz" }, principals: { subscribe: () => () => undefined, getSnapshot: () => people } as ShellRuntime["principals"], clock: () => ({ now: NOW, offsetMin: 0 }) };
}

function Card({ rt }: { rt: ShellRuntime }): ReactNode {
  const host: BlockHost = { invoke: (cap, input) => rt.call(cap as never, input as never), open: () => undefined, meId: ME, nameOf: (id) => (id === ME ? "You" : "Sara") };
  const block = { type: "artifact", v: 1, id: "blk1", traceId: "tr_1", data: { artifactId: "sit_pr", title: "Pricing comparison" } } as never;
  return (
    <View style={{ flex: 1, alignItems: "center", backgroundColor: "var(--win)" as string, paddingTop: 80 }}>
      <View style={{ width: "100%", maxWidth: 660, paddingHorizontal: 16, gap: 14 }}>
        <View style={{ alignSelf: "flex-end", paddingVertical: 10, paddingHorizontal: 16, borderRadius: 18, backgroundColor: "var(--me)" as string }}><Text style={{ color: "var(--ink)" as string, fontSize: 15 }}>Compare our three plans on one page and publish it so Sara can see it.</Text></View>
        <Text style={{ color: "var(--ink)" as string, fontSize: 15, lineHeight: 23 }}>Done. It is live at northwind.vyre.run/a/pricing. Sara can open it with her own sign-in.</Text>
        <ArtifactBlock block={block} host={host} />
      </View>
    </View>
  );
}

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "card"), []);
  const rt = useMemo(() => (part === null ? null : runtime(part)), [part]);
  // a phone shows one column: the page without the sidebar, as the shell stacks it
  const narrow = useWindowDimensions().width < 560;
  if (part === null || rt === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  if (part === "card") return <Card rt={rt} />;
  const initial = part === "view" || part === "loading" || part === "error" ? step(START, { t: "artifact", artifactId: "sit_pr" }) : step(START, { t: "artifacts" });
  return (
    <SidebarSlotProvider deviceId="d1" personId={ME} spaceId="mla" place="chats" epoch={1} compact={false} storage={{ getItem: () => null, setItem: () => undefined }}>
      <View style={{ flex: 1, flexDirection: "row", minHeight: 0, backgroundColor: "var(--win)" as string }}>
        {narrow ? null : <SidebarSlot />}
        <View style={{ flex: 1, minWidth: 0 }}><ChatsMounted key={part} rt={rt} initial={initial} window={{ start: 0, end: 500 }} openInNewTab={() => undefined} /></View>
      </View>
    </SidebarSlotProvider>
  );
}
