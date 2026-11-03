// Settings > Connected > Outside agents: the apps you let in from outside Vyre, under your own things because each one is yours alone. Each row opens the agent; Remove ends its sign-in at once. Connecting one is the same sheet
// as a channel's: one link to paste. Setup is the grant "Act for me, including setup" (owner ruling 3 Nov): on, it sets the Space up as you with no card; off, what only you can do waits for your yes.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { CapMap } from "../../../../../generated/types.ts";
import { agoLabel } from "../chats/rightpane/model.ts";
import { ConnectOutsideAgent } from "../chats/mounts/ConnectOutsideAgent.tsx";
import { Glyph, Section, SettingsRow, SmallButton, Switch, Value } from "./ui.tsx";
import { useSettingsData } from "./data.tsx";
import { useSaved } from "./saved.tsx";

type Connected = CapMap["mcp.connected.list"]["out"]["agents"][number];

export function OutsideAgents(): ReactElement {
  const data = useSettingsData();
  const saved = useSaved();
  const [rows, setRows] = useState<readonly Connected[] | null>(null);
  const [sheet, setSheet] = useState(false);
  const read = useCallback(() => { void data.call("mcp.connected.list", {}).then((o) => setRows((o as CapMap["mcp.connected.list"]["out"]).agents), () => setRows([])); }, [data]);
  useEffect(read, [read]);
  const clock = data.clock();
  const setSetup = (agentId: string, on: boolean): void => {
    void data.call("mcp.setup.set", { agentId, setup: on })
      .then(() => { saved.saved(on ? "It can now set things up as you." : "It asks you first again."); read(); })
      .catch((e: unknown) => saved.failed((e as { error?: { message?: string } } | null)?.error?.message ?? "That did not change."));
  };
  const list: ReactElement[] = [];
  (rows ?? []).forEach((a, i) => list.push(
    <SettingsRow
      key={a.agentId} id={`outside.${a.agentId}`} label={a.clientName} first={i === 0} sub={a.lastSeenAt === undefined ? "Has not done anything yet" : `Last active ${agoLabel(a.lastSeenAt, { now: clock.now, offsetMin: clock.offsetMin })}, ${a.calls} ${a.calls === 1 ? "call" : "calls"}`}
      lead={<Glyph name="link" size={15} />}
      {...(data.nav.openAgent ? { onPress: () => data.nav.openAgent?.(a.agentId) } : {})}
      control={<>
        {a.redirectHost ? <Value text={a.redirectHost} /> : null}
        <Value text="Setup" />
        <Switch on={a.setup === true} label={`${a.clientName} acts for you, including setup`} testID={`outside-setup-${a.agentId}`} onChange={(on) => setSetup(a.agentId, on)} />
        <SmallButton label="Remove" testID={`outside-remove-${a.agentId}`} onPress={() => void data.call("mcp.connected.remove", { agentId: a.agentId }).then(() => { saved.saved("Removed. Its sign-in has ended."); read(); }).catch(() => saved.failed("That did not remove it."))} />
      </>}
    />,
  ));
  return (
    <Section title="Outside agents" testID="outside-agents">
      {list}
      <SettingsRow id="connect-outside" label="Connect an outside agent" sub="Claude Code, Cursor or any MCP app" first={list.length === 0} lead={<Glyph name="plus" size={15} />} onPress={() => setSheet(true)} control={<Glyph name="chevR" size={13} />} />
      {sheet ? <ConnectOutsideAgent call={data.call} onClose={() => { setSheet(false); read(); }} say={(t) => saved.saved(t)} /> : null}
    </Section>
  );
}
