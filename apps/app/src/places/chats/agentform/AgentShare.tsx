// "Who can use it": the one Share sheet (ui/AccessSheet, share mode) over one agent, read from access.shares_of after every change. The Agent form and the agent's profile pane both open this, so the sheet,
// its levels and its calls live in one place.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ConfigDirectory } from "../../automations/config/data.tsx";
import { Overlay } from "../../automations/config/Overlay.tsx";
import { shareRows, sheetDirectory } from "../../../share/rows.ts";
import { AccessSheet } from "../../../../../../ui/src/AccessSheet/index.tsx";
import type { ShareInput, UnshareInput } from "../../../../../../ui/src/AccessSheet/index.tsx";

type Call = (cap: string, input: unknown) => Promise<unknown>;
type SharesOut = CapMap["access.shares_of"]["out"];

export interface AgentSharing { directory: ConfigDirectory; meName: string; meId: string; nameOf(id: string): string }

/** Reads who has access to an agent, and keeps it fresh: the form shows a count from the same read. */
export function useAgentShares(call: Call, agentId: string | null): { shares: SharesOut | null; reload(): void } {
  const [shares, setShares] = useState<SharesOut | null>(null);
  const reload = useCallback((): void => {
    if (agentId === null) return;
    void Promise.resolve(call("access.shares_of", { resource: { type: "agent", id: agentId } })).then((o) => setShares(o as SharesOut), () => undefined);
  }, [agentId, call]);
  useEffect(reload, [reload]);
  return { shares, reload };
}

export function AgentShareSheet({ agentId, name, call, newKey, say, sharing, shares, reload, onClose }: {
  agentId: string; name: string; call: Call; newKey(): string; say(text: string): void; sharing: AgentSharing; shares: SharesOut; reload(): void; onClose(): void;
}): ReactElement {
  return (
    <Overlay label="Who can use it" onClose={onClose} testID="agent-share-overlay">
      <AccessSheet
        mode="share" itemType="agent" resourceType="agent" resourceId={agentId} itemName={name} target="item" ownerName={sharing.meName} ownerId={sharing.meId} levels={["view", "use", "edit", "manage"]}
        shares={shareRows(shares, sharing.nameOf, agentId)} allowExternal={false} density="compact" newKey={newKey}
        {...(shares.agentsCanCall === undefined ? {} : { agentsOn: shares.agentsCanCall })}
        onAgents={(on) => { void Promise.resolve(call("access.agents_can_call.set", { agentId, on, idempotencyKey: newKey() })).then(reload, () => say("Could not change who can call this agent.")); }}
        directory={sheetDirectory(sharing.directory)}
        onShare={(i: ShareInput) => { void Promise.resolve(call("access.share", i)).then(reload, () => say("Could not change access.")); }}
        onUnshare={(i: UnshareInput) => { void Promise.resolve(call("access.unshare", i)).then(reload, () => say("Could not change access.")); }}
        onClose={onClose}
      />
    </Overlay>
  );
}

/** What the pane draws for Share: it reads the shares, then the sheet. Nothing shows until the Space has answered. */
export function AgentShareHost({ agentId, name, call, newKey, say, sharing, onClose }: { agentId: string; name: string; call: Call; newKey(): string; say(text: string): void; sharing: AgentSharing; onClose(): void }): ReactElement | null {
  const { shares, reload } = useAgentShares(call, agentId);
  if (shares === null) return null;
  return <AgentShareSheet agentId={agentId} name={name} call={call} newKey={newKey} say={say} sharing={sharing} shares={shares} reload={reload} onClose={onClose} />;
}
