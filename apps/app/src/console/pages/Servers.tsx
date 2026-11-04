// Console > Computers > Servers: the servers the Space runs on, each opening that machine, the one shared Add a server flow (apps/app/src/machines/AddServer.tsx, the same sheet the Machines page uses)
// and the Updates line. The sheet's calls are network.server_join_code and network.server_approve.
import { useCallback } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { AddServerSheet, copyText, useAddServer } from "../../machines/AddServer.tsx";
import { Glyph } from "../shell/glyphs.tsx";
import { Empty, Group, Lead, Section } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Button, ReadState, useRead } from "./shared.tsx";

type Servers = CapMap["network.servers"]["out"]["servers"];

/** A server is online unless the Space has lost it. */
export const serverLine = (s: Servers[number]): string => s.enrollment === "pending" ? "Waiting for approval" : s.state === "down" ? "Offline" : s.state === "degraded" ? "Online, needs a look" : "Online";

export function ServersPage(): ReactElement {
  const data = useConsoleData();
  const servers = useRead<CapMap["network.servers"]["out"]>("network.servers");
  const update = useRead<CapMap["updates.status"]["out"]>("updates.status");
  const reload = useCallback((): void => { servers.refresh(); }, [servers.refresh]);
  const add = useAddServer({ call: data.call as never, scope: "space", personal: false, reload, clock: () => data.clock().now });
  if (!servers.data) return <ReadState error={servers.error} retry={servers.refresh} />;
  const list = servers.data.servers;
  const info = list.map((s) => ({ serverId: s.serverId, name: s.name, state: s.state, enrollment: s.enrollment ?? ("approved" as const), ...(s.fingerprint ? { fingerprint: s.fingerprint } : {}), ...(s.lastSeenAt ? { lastSeenAt: s.lastSeenAt } : {}), ...(s.requestedAt ? { requestedAt: s.requestedAt } : {}), ...(s.facts ? { facts: s.facts } : {}) }));
  const up = update.data;
  const behind = up?.available !== undefined && up.available !== up.current;
  return (
    <View testID="console-servers">
      <Section title="Servers" count={list.length} right={<Button label="Add server" testID="servers-add" onPress={add.open} />}>
        <Group testID="servers-list">
          {list.map((s) => (
            <Row key={s.serverId} id={`server-${s.serverId}`} title={s.name} note={serverLine(s)} leading={<Lead><Glyph name="server" size={16} color={s.state === "down" ? "var(--ink-3)" : "var(--ok)"} /></Lead>}
              {...(s.enrollment === "pending" ? {} : { onPress: () => data.nav.openPage("machines", { machineId: s.serverId }) })} />
          ))}
          {!list.length ? <Empty icon="server" testID="servers-empty" action={{ label: "Add server", onPress: add.open }}>No servers yet. Add one to run agents around the clock.</Empty> : null}
        </Group>
      </Section>
      <Section title="Updates">
        <Group>
          <Row id="server-update" title="Vyre server" note={up ? behind ? `Version ${up.current}. ${up.available} is ready` : `Version ${up.current}. Up to date` : "Checking"}
            {...(behind ? { trailing: <Button label="Review update" testID="servers-review-update" onPress={() => data.nav.openPage("updates")} /> } : {})} />
        </Group>
      </Section>
      {add.sheet ? <AddServerSheet sheet={add.sheet} servers={info} busy={add.busy} error={add.error} now={add.now} onNickname={add.setNickname} onMake={add.make} onApprove={add.approve} onDecline={add.decline} onCopy={copyText} onClose={add.close} /> : null}
    </View>
  );
}
