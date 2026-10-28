import { useState } from 'react';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import type { CapMap } from '../../../../../generated/types.ts';
import budgets from '../../../../../perf/budgets.json' with { type: 'json' };
import { Row } from '../../../../../ui/src/Row/index.tsx';
import { Group, Section } from '../shell/ui.tsx';
import { useConsoleData } from '../shell/data.tsx';
import { Actions, Button, Note, ReadState, Select, useRead } from './shared.tsx';

export function speedValue(id: string, value: number): string {
  const unit = budgets.budgets.find((budget) => budget.id === id)?.unit;
  return `${value}${unit === 'percent' ? '%' : unit === 'ms' ? ' ms' : unit === 'count' ? ' items' : unit === 'cls' ? ' CLS' : ''}`;
}
function WorstTrace({ id }: { id: string }): ReactElement {
  const result = useRead<CapMap['logs.trace']['out']>('logs.trace', { traceId: id });
  return <Section title="Worst trace"><Group><Note>{id}</Note>{result.data ? <>{result.data.spans.map((span) => <Row key={span.spanId} id={`speed-span-${span.spanId}`} title={span.name} note={`${(span.durUs / 1000).toFixed(1)} ms`} />)}{!result.data.spans.length ? <Note>No retained spans for this trace.</Note> : null}</> : <ReadState error={result.error} retry={result.refresh} />}</Group></Section>;
}
export function Speed(): ReactElement {
  const data = useConsoleData();
  const [window, setWindow] = useState('60'), [trace, setTrace] = useState('');
  const result = useRead<CapMap['console.speed']['out']>('console.speed', { windowMinutes: Number(window) });
  return <View testID="console-speed-infra"><Section title="Speed"><Group><Select label="Sample window" value={window} options={[{ key: '15', title: 'Last 15 minutes' }, { key: '60', title: 'Last hour' }, { key: '1440', title: 'Last day' }]} onChange={(value) => { setWindow(value); setTrace(''); }} /><Note>Median and bad-end percentile compared with each performance budget. Missing samples do not establish server health.</Note><Actions><Button label="Refresh speed" onPress={result.refresh} /></Actions>{result.data ? result.data.rows.length ? result.data.rows.map((row) => {
    const budget = budgets.budgets.find((item) => item.id === row.budgetId);
    return <Row key={row.budgetId} id={`speed-${row.budgetId}`} title={row.budgetId.replaceAll('_', ' ')} note={`${row.over ? 'Outside budget' : 'Within budget'} · Median ${speedValue(row.budgetId, row.p50)} · ${budget?.sense === 'min' ? 'Low-end p5' : 'p95'} ${speedValue(row.budgetId, row.p95)} · Target ${budget?.sense === 'min' ? 'at least' : budget?.sense === 'exact' ? 'exactly' : 'at most'} ${speedValue(row.budgetId, row.budgetP95)}`} trailing={row.worstTraceId && data.can('server.logs') ? <Button label="Worst trace" onPress={() => setTrace(row.worstTraceId!)} /> : undefined} />;
  }) : <Note>No speed samples in this window.</Note> : <ReadState error={result.error} retry={result.refresh} />}{!data.can('server.logs') ? <Note>Viewing individual traces requires server log access.</Note> : null}</Group></Section>{trace ? <WorstTrace id={trace} /> : null}</View>;
}
export function Usage(): ReactElement {
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day'), [by, setBy] = useState<'agent' | 'person' | 'model'>('person');
  const result = useRead<CapMap['console.usage']['out']>('console.usage', { period, by });
  return <View testID="console-usage-infra"><Section title="Usage"><Group><Select label="Period" value={period} options={[{ key: 'day', title: 'Last day' }, { key: 'week', title: 'Last 7 days' }, { key: 'month', title: 'Last 30 days' }]} onChange={(value) => setPeriod(value as typeof period)} /><Select label="Group usage by" value={by} options={[{ key: 'person', title: 'Person' }, { key: 'agent', title: 'Agent' }, { key: 'model', title: 'Model' }]} onChange={(value) => setBy(value as typeof by)} /><Actions><Button label="Refresh usage" onPress={result.refresh} /></Actions>{result.data ? <>{result.data.rows.map((row) => <Row key={row.key} id={`usage-${row.key}`} title={row.name} note={`${row.turns.toLocaleString()} turns · ${row.tokensIn.toLocaleString()} input tokens · ${row.tokensOut.toLocaleString()} output tokens · $${(row.costMicros / 1e6).toFixed(4)}`} />)}{!result.data.rows.length ? <Note>No usage in this period.</Note> : null}<Note>{result.data.note}</Note></> : <ReadState error={result.error} retry={result.refresh} />}</Group></Section></View>;
}
