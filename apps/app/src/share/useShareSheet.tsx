// One host for the Access sheet in share mode, for any item a row menu can share (an agent, and the other kinds as their menus come): `open` reads who has access and the Space's directory, and the sheet over the
// place changes it with access.share and access.unshare, reading again after each. Draw `element` once in the place; it is null while nothing is open.
import { useCallback, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { CapMap } from "../../../../generated/types.ts";
import { AccessSheet } from "../../../../ui/src/AccessSheet/index.tsx";
import type { ShareInput, UnshareInput } from "../../../../ui/src/AccessSheet/index.tsx";
import { Overlay } from "../places/automations/config/Overlay.tsx";
import { shareRows, sheetDirectory } from "./rows.ts";

type Share = CapMap["access.share"]["in"]["resource"]["type"];
export interface ShareTarget {
  /** The resource the grants are on (access.share's resource.type). */
  resourceType: Share;
  resourceId: string;
  /** What the sheet calls it ("agent", "file", "note" ...): the sheet's own item kinds. */
  itemType: "agent" | "file" | "note" | "record" | "rtype" | "artifact" | "project" | "vault" | "automation";
  name: string;
}
export interface ShareDeps {
  call(cap: string, input: unknown): Promise<unknown>;
  me: { id: string; name: string };
  nameOf(id: string): string;
  spaceName?: string | undefined;
  newKey(): string;
  toast(text: string): void;
}
export interface ShareSheetApi { open(t: ShareTarget): void; element: ReactElement | null }

type Out<C extends keyof CapMap> = CapMap[C]["out"];

/** The sheet's directory from the Space: its people, groups, roles and agents. A list that cannot be read is left empty. */
export async function loadDirectory(call: ShareDeps["call"], me: string): Promise<ReturnType<typeof sheetDirectory>> {
  const get = async <T,>(cap: string): Promise<T | null> => { try { return (await call(cap, {})) as T; } catch { return null; } };
  const [pr, gr, ro, ag] = await Promise.all([get<Out<"access.principals.list">>("access.principals.list"), get<Out<"access.groups.list">>("access.groups.list"), get<Out<"access.roles.list">>("access.roles.list"), get<Out<"agents.list">>("agents.list")]);
  return sheetDirectory({
    people: (pr?.principals ?? []).filter((p) => p.kind === "person" && p.id !== me && p.status !== "removed").map((p) => ({ id: p.id, name: p.name })),
    groups: (gr?.groups ?? []).map((g) => ({ id: g.id, name: g.name })),
    roles: (ro?.roles ?? []).map((r) => ({ id: r.id, name: r.name })),
    agents: (ag?.agents ?? []).map((a) => ({ id: a.agentId, name: a.name })),
  });
}

export function useShareSheet(deps: ShareDeps): ShareSheetApi {
  const d = useRef(deps);
  d.current = deps;
  const [s, setS] = useState<{ t: ShareTarget; shares: Out<"access.shares_of">; directory: Awaited<ReturnType<typeof loadDirectory>> } | null>(null);
  const read = useCallback(async (t: ShareTarget): Promise<Out<"access.shares_of"> | null> => {
    try { return (await d.current.call("access.shares_of", { resource: { type: t.resourceType, id: t.resourceId } })) as Out<"access.shares_of">; } catch { return null; }
  }, []);
  const open = useCallback((t: ShareTarget): void => {
    void Promise.all([read(t), loadDirectory(d.current.call, d.current.me.id)]).then(([shares, directory]) => {
      if (shares === null) { d.current.toast("Could not open sharing. Try again."); return; }
      setS({ t, shares, directory });
    });
  }, [read]);
  const again = (t: ShareTarget): void => { void read(t).then((shares) => { if (shares) setS((cur) => (cur ? { ...cur, shares } : cur)); }); };
  const fail = (text: string) => (): void => d.current.toast(text);
  let element: ReactElement | null = null;
  if (s) {
    const { t } = s;
    element = (
      <Overlay label={`Share ${t.name}`} onClose={() => setS(null)} testID="share-overlay">
        <AccessSheet
          mode="share" itemType={t.itemType} resourceType={t.resourceType} resourceId={t.resourceId} itemName={t.name} target="item" ownerName={deps.me.name} ownerId={deps.me.id}
          {...(deps.spaceName ? { spaceName: deps.spaceName } : {})} levels={["view", "use", "edit", "manage"]}
          shares={shareRows(s.shares, deps.nameOf, t.resourceId)} allowExternal={false} density="compact" newKey={deps.newKey}
          {...(s.shares.agentsCanCall === undefined || t.itemType !== "agent" ? {} : { agentsOn: s.shares.agentsCanCall })}
          {...(t.itemType === "agent" ? { onAgents: (on: boolean) => { void Promise.resolve(deps.call("access.agents_can_call.set", { agentId: t.resourceId, on, idempotencyKey: deps.newKey() })).then(() => again(t), fail("Could not change who can call this agent.")); } } : {})}
          directory={s.directory}
          onShare={(i: ShareInput) => { void Promise.resolve(deps.call("access.share", i)).then(() => again(t), fail("Could not change access.")); }}
          onUnshare={(i: UnshareInput) => { void Promise.resolve(deps.call("access.unshare", i)).then(() => again(t), fail("Could not change access.")); }}
          onClose={() => setS(null)}
        />
      </Overlay>
    );
  }
  return { open, element };
}
