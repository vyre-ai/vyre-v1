import { useState } from 'react';
import type { ReactElement } from 'react';
import { Text } from 'react-native';
import type { CapMap } from '../../../../../generated/types.ts';
import { Row } from '../../../../../ui/src/Row/index.tsx';
import { Group, Section } from '../shell/ui.tsx';
import { useConsoleData } from '../shell/data.tsx';
import { count } from '../shell/format.ts';
import { Actions, Button, Note, ReadState, attempt, useAction, useRead } from './shared.tsx';

type Server = CapMap['network.servers']['out']['servers'][number];
const OS: Record<string, string> = { linux: 'Linux', darwin: 'Mac', win32: 'Windows' };
const stateName = (state: string): string => state[0]!.toUpperCase() + state.slice(1);

/** What a waiting computer tells the person who approves it: what it is, what it runs on and the eight characters it prints itself. */
export function factsLine(server: Pick<Server, 'facts' | 'fingerprint'>): string {
  const f = server.facts;
  return [f ? `${OS[f.os] ?? f.os} ${f.arch}` : null, f ? (f.docker ? 'Docker ready' : 'No Docker (sandboxed CLI turns only)') : null, server.fingerprint ? `Fingerprint ${server.fingerprint}` : null].filter(Boolean).join(' · ');
}

/** What the person is told before a computer is taken out: the agent computers it hosts are named, because they stop. */
export function removalNote(name: string, hosted: readonly string[]): string {
  return hosted.length
    ? `Remove ${name}? It is hosting ${count(hosted.length, 'agent computer')}: ${hosted.join(', ')}. They stop and their local data on it is wiped. Its access ends at once.`
    : `Remove ${name}? Its access ends at once and it must be admitted again to come back.`;
}

/** The computers of the Space: the Space server, the ones that joined for compute, and the ones waiting for a person to say yes. */
export function Computers({ onChanged, part }: { onChanged?: () => void; part: 'waiting' | 'list' }): ReactElement | null {
  const data = useConsoleData();
  const servers = useRead<CapMap['network.servers']['out']>('network.servers');
  const hosted = useRead<CapMap['computers.list']['out']>('computers.list', {});
  const [code, setCode] = useState<{ value: string; expires: number } | null>(null);
  const [removing, setRemoving] = useState<Server | null>(null);
  const action = useAction(() => { servers.refresh(); hosted.refresh(); onChanged?.(); });
  if (!servers.data) return <ReadState error={servers.error} retry={servers.refresh} />;
  const waiting = servers.data.servers.filter((s) => s.enrollment === 'pending');
  const admitted = servers.data.servers.filter((s) => s.enrollment !== 'pending');
  const runningOn = (serverId: string): string[] => (hosted.data?.computers ?? []).filter((c) => c.host === serverId).map((c) => c.caption ?? c.computerId);
  const joinCommand = code ? `vyred --role compute --space ${(globalThis as unknown as { location?: { origin: string } }).location?.origin ?? data.space.name} --join ${code.value}` : '';
  if (part === 'waiting' && !waiting.length) return null;
  return <>
    {part === 'waiting' ? <Section title="Waiting for approval" count={waiting.length} testID="computers-waiting"><Group>{waiting.map((server) => <Row key={server.serverId} id={`computer-waiting-${server.serverId}`} title={server.name} note={factsLine(server)} tall trailing={<Actions><Button label="Approve" testID={`computer-approve-${server.serverId}`} disabled={action.busy} onPress={() => void action.run('network.server_approve', { serverId: server.serverId }, `${server.name} was admitted.`)} /><Button label="Decline" testID={`computer-decline-${server.serverId}`} disabled={action.busy} onPress={() => void action.run('network.server_decline', { serverId: server.serverId }, `${server.name} was turned away.`)} /></Actions>} />)}</Group><Note>Approve only a computer you recognise: its name and fingerprint should match what it printed when it asked to join.</Note></Section> : null}
    {part === 'list' ? <Section title="Computers" count={admitted.length} testID="computers-list"><Group>
      {admitted.map((server) => <Row key={server.serverId} id={`network-server-${server.serverId}`} title={server.name} note={`${stateName(server.state)} · ${server.role === 'space' ? 'Space server' : server.owner ? `Personal computer of ${data.name(server.owner)}` : 'Computer'}${server.facts ? ` · ${OS[server.facts.os] ?? server.facts.os}` : ''}${server.lastSeenAt ? ` · Last seen ${new Date(server.lastSeenAt).toLocaleString()}` : ''}`} trailing={<Actions><Button label="Reconnect" disabled={action.busy} onPress={() => void action.run('network.server_reconnect', { serverId: server.serverId }, 'Reconnect requested. Refresh to check the observed state.')} />{server.role !== 'space' ? <Button label="Remove…" testID={`computer-remove-${server.serverId}`} disabled={action.busy} onPress={() => setRemoving(server)} /> : null}</Actions>} />)}
      {removing ? <><Note>{removalNote(removing.name, runningOn(removing.serverId))}</Note><Actions><Button label="Cancel" onPress={() => setRemoving(null)} /><Button label="Confirm removal" testID="computer-remove-confirm" danger disabled={action.busy} onPress={() => void action.run('network.server_remove', { serverId: removing.serverId }, `${removing.name} was removed.`).then((out) => { if (out !== undefined) setRemoving(null); })} /></Actions></> : null}
      <Actions><Button label="Add a computer" testID="computer-add" disabled={action.busy} onPress={() => void action.run<CapMap['network.server_join_code']['out']>('network.server_join_code', { idempotencyKey: attempt() }, 'Join code made. It works once, for ten minutes.').then((out) => { if (out) setCode({ value: out.code, expires: out.expiresAt }); })} /></Actions>
      {code ? <><Note>Run this on the computer, a Mac, a PC or a Linux box. It works once and expires {new Date(code.expires).toLocaleTimeString()}.</Note><Text selectable testID="computer-join-command" style={{ fontFamily: 'var(--mono)' as string, fontSize: 12, padding: 8 }}>{joinCommand}</Text></> : <Note>A computer joins with a one-time code, then waits here until you approve it. It never holds your keys or data beyond the jobs it is given.</Note>}
      {action.note ? <Note>{action.note}</Note> : null}
    </Group></Section> : null}
  </>;
}
