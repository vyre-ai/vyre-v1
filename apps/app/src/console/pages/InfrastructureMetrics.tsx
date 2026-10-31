import { useState } from 'react';
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';
import type { CapMap } from '../../../../../generated/types.ts';
import { Row } from '../../../../../ui/src/Row/index.tsx';
import { Group, Section } from '../shell/ui.tsx';
import { useConsoleData } from '../shell/data.tsx';
import { InfraTrace } from './Infrastructure.tsx';
import { Help,  Actions, Button, Note, ReadState, Select, useRead } from './shared.tsx';

export function speedValue(unit: string, value: number): string {
  return `${value}${unit === 'percent' ? '%' : unit === 'ms' ? ' ms' : unit === 'count' ? ' items' : unit === 'cls' ? ' CLS' : ''}`;
}
export function Speed(): ReactElement {
  const data = useConsoleData();
  const [window, setWindow] = useState('60'), [trace, setTrace] = useState('');
  const result = useRead<CapMap['console.speed']['out']>('console.speed', { windowMinutes: Number(window) });
  return <View testID="console-speed-infra"><Section title="Speed"><Group><Select label="Sample window" value={window} options={[{ key: '15', title: 'Last 15 minutes' }, { key: '60', title: 'Last hour' }, { key: '1440', title: 'Last day' }]} onChange={(value) => { setWindow(value); setTrace(''); }} /><Help>Median and bad-end percentile against each budget.</Help><Actions><Button label="Refresh speed" onPress={result.refresh} /></Actions>{result.data ? result.data.rows.length ? result.data.rows.map((row) => {
    const sense = row.sense;
    return <Row key={row.budgetId} id={`speed-${row.budgetId}`} tall title={row.budgetId.replaceAll('_', ' ')} note={`${row.over ? 'Outside budget' : 'Within budget'} · Median ${speedValue(row.unit, row.p50)} · ${sense === 'min' ? 'Low-end p5' : 'p95'} ${speedValue(row.unit, row.p95)} · Target ${sense === 'min' ? 'at least' : sense === 'exact' ? 'exactly' : 'at most'} ${speedValue(row.unit, row.budgetP95)}`} trailing={row.worstTraceId && data.can('server.logs') ? <Button label="Worst trace" onPress={() => setTrace(row.worstTraceId!)} /> : undefined} />;
  }) : <Note>No speed samples in this window.</Note> : <ReadState error={result.error} retry={result.refresh} />}{!data.can('server.logs') ? <Help>Viewing individual traces requires server log access.</Help> : null}</Group></Section>{trace ? <InfraTrace id={trace} title="Worst trace" /> : null}</View>;
}
function UsageLimits(): ReactElement {
  const data = useConsoleData();
  const [scope, setScope] = useState<'person' | 'space'>('person');
  const result = useRead<CapMap['engine.spend.get']['out']>('engine.spend.get', { scope });
  const money = (value: number): string => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(value / 1e6);
  const cap = (value: number | undefined): string => value === undefined ? 'No cap set' : money(value);
  return <Section title={scope === 'person' ? 'Your limits' : 'Space limits'}><Group>{data.can('ai.spend') ? <Select label="Limits scope" value={scope} options={[{ key: 'person', title: 'Your limits' }, { key: 'space', title: 'Space limits' }]} onChange={value => setScope(value as typeof scope)} /> : null}{result.data ? <><Row id="usage-daily-limit" title="Daily spend" note={`${money(result.data.todayMicros)} used · ${cap(result.data.caps.dayMicros)}`} /><Row id="usage-monthly-limit" title="Monthly spend" note={`${money(result.data.monthMicros)} used · ${cap(result.data.caps.monthMicros)}`} /><Row id="usage-run-limit" title="Per run" note={cap(result.data.caps.run)} /><Row id="usage-turn-limit" title="Daily turns" note={`${result.data.turnsToday} used · ${result.data.caps.turnsPerDay === undefined ? 'No cap set' : result.data.caps.turnsPerDay}`} /><Row id="usage-time-limit" title="Time per run" note={result.data.caps.timeMinutesPerRun === undefined ? 'No cap set' : `${result.data.caps.timeMinutesPerRun} minutes`} /><Row id="usage-paused" title="AI spending" note={result.data.paused ? 'Paused' : 'Running'} />{scope === 'person' ? <Help>These are your personal caps. Space and agent caps can also stop a turn.</Help> : null}</> : <ReadState error={result.error} retry={result.refresh} />}<Actions><Button label="Refresh limits" onPress={result.refresh} />{data.can('ai.spend') ? <Button label="Manage limits" onPress={() => data.nav.openPage('spend')} /> : null}</Actions></Group></Section>;
}
export function Usage(): ReactElement {
  const data = useConsoleData();
  const principals = useRead<CapMap['access.principals.list']['out']>('access.principals.list', {});
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day'), [by, setBy] = useState<'agent' | 'person' | 'model'>('person');
  const result = useRead<CapMap['console.usage']['out']>('console.usage', { period, by });
  return <View testID="console-usage-infra"><Section title="Usage"><Group><Select label="Period" value={period} options={[{ key: 'day', title: 'Last day' }, { key: 'week', title: 'Last 7 days' }, { key: 'month', title: 'Last 30 days' }]} onChange={(value) => setPeriod(value as typeof period)} /><Select label="Group usage by" value={by} options={[{ key: 'person', title: 'Person' }, { key: 'agent', title: 'Agent' }, { key: 'model', title: 'Model' }]} onChange={(value) => setBy(value as typeof by)} /><Actions><Button label="Refresh usage" onPress={result.refresh} /></Actions>{result.data ? <>{result.data.rows.map((row) => <Row key={row.key} id={`usage-${row.key}`} title={by === 'model' ? row.name : row.key === data.me.id ? data.me.name : principals.data?.principals.find(person => person.id === row.key)?.name ?? (row.name === row.key ? (by === 'agent' ? 'Agent name unavailable' : 'Person name unavailable') : row.name)} note={`${row.turns.toLocaleString()} turns · ${row.tokensIn.toLocaleString()} input tokens · ${row.tokensOut.toLocaleString()} output tokens`} trailing={<Text style={{ fontVariant: ['tabular-nums'], textAlign: 'right', minWidth: 84, color: 'var(--ink)' as string }}>${(row.costMicros / 1e6).toFixed(4)}</Text>} />)}{!result.data.rows.length ? <Note>No usage in this period.</Note> : null}<Note>{result.data.note}</Note></> : <ReadState error={result.error} retry={result.refresh} />}</Group></Section><UsageLimits /></View>;
}
