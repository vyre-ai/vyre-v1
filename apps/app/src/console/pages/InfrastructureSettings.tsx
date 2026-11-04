import { SpaceImage } from './SpaceImage.tsx';
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import type { CapMap } from '../../../../../generated/types.ts';
import { Row } from '../../../../../ui/src/Row/index.tsx';
import { Empty, Group, Lead, Section } from '../shell/ui.tsx';
import { Glyph } from '../shell/glyphs.tsx';
import { useConsoleData } from '../shell/data.tsx';
import { Actions, Button, Field, Note, ReadState, Select, useAction, useRead } from './shared.tsx';
import { skins, system } from '../../../../../ui/src/tokens/skins.ts';
export function Updates(): ReactElement {
    const data = useConsoleData(), status = useRead<CapMap['updates.status']['out']>('updates.status'), history = useRead<CapMap['updates.history']['out']>('updates.history');
    const [channel, setChannel] = useState('stable'), [checked, setChecked] = useState<CapMap['updates.check']['out'] | null>(null), [review, setReview] = useState<{
        kind: 'apply' | 'rollback';
        to: string;
    } | null>(null);
    const action = useAction(() => { status.refresh(); history.refresh(); });
    useEffect(() => { if (status.data)
        setChannel(status.data.channel); }, [status.data]);
    if (!status.data || !history.data)
        return <ReadState error={status.error ?? history.error} retry={() => { status.refresh(); history.refresh(); }}/>;
    const apply = async (): Promise<void> => { if (!review)
        return; const chosen = review; await action.run(`updates.${chosen.kind}`, { to: chosen.to }, async () => { const observed = await data.call('updates.status', {}) as CapMap['updates.status']['out']; const recent = await data.call('updates.history', {}) as CapMap['updates.history']['out']; const record = recent.updates[0]; return observed.current === chosen.to && record?.to === chosen.to && record.result !== 'failed' ? `Server now runs ${observed.current}. ${record.result === 'rolled_back' ? 'Rollback verified.' : 'Update health check passed.'}` : record?.result === 'failed' ? 'The update failed. Review history and current server health.' : `Request returned. Observed version is ${observed.current}; refresh history before retrying.`; }); setReview(null); };
    return <View testID="console-updates-infra"><Section title="Server updates"><Group><Row id="updates-current" title="Running version" note={status.data.managedElsewhere ? 'This server is updated outside Vyre' : status.data.current ?? 'Unknown'}/><Row id="updates-last" title="Last result" note={status.data.lastResult ?? 'No update recorded'}/><Select label="Release channel" value={channel} onChange={setChannel} options={['stable', 'beta', 'nightly'].map(key => ({ key, title: key[0]!.toUpperCase() + key.slice(1) }))}/><Actions><Button label="Save channel" disabled={action.busy || channel === status.data.channel} onPress={() => void action.run('updates.channel_set', { channel }, () => { setChecked(null); return 'Release channel saved. Check for updates on this channel.'; })}/><Button label="Check for updates" testID="infra-updates-check" disabled={action.busy} onPress={() => void action.run<CapMap['updates.check']['out']>('updates.check', {}, out => { setChecked(out); return out.available ? `Version ${out.available} is available.` : 'No newer version is available.'; })}/>{checked?.available || status.data.available ? <Button label="Review update…" testID="infra-update-review" disabled={action.busy} onPress={() => setReview({ kind: 'apply', to: checked?.available ?? status.data!.available! })}/> : null}</Actions>{checked ? <><Note>{checked.notes ?? 'No release notes supplied.'}</Note><Note>Supported apps: {checked.supportedApps.join(', ') || 'No compatibility information supplied'}</Note></> : null}{action.note ? <Note>{action.note}</Note> : null}</Group></Section><Section title="Update history" count={history.data.updates.length}><Group>{history.data.updates.map((row, index) => <Row key={`${row.at}-${index}`} id={`update-${index}`} title={`${row.from} → ${row.to}`} note={`${new Date(row.at).toLocaleString()} · ${row.result} · ${row.seconds}s`} trailing={row.from !== status.data!.current ? <Button label={`Review rollback to ${row.from}`} disabled={action.busy} onPress={() => setReview({ kind: 'rollback', to: row.from })}/> : undefined}/>)}{!history.data.updates.length ? <Empty icon="doc">No updates recorded</Empty> : null}</Group></Section>{review ? <Section title={review.kind === 'apply' ? 'Review server update' : 'Review rollback'}><Group><Note>{review.kind === 'apply' ? `Update from ${status.data.current} to ${review.to}? Vyre takes a backup first, checks server health and rolls back if the new version fails.` : `Switch code to ${review.to}? Data written by the newer version stays. The server must still have this version available.`} Connected work may pause during restart.</Note><Actions><Button label="Cancel" onPress={() => setReview(null)}/><Button label={review.kind === 'apply' ? 'Confirm update' : 'Confirm rollback'} danger disabled={action.busy} onPress={() => void apply()}/></Actions></Group></Section> : null}</View>;
}
export const TIME_ZONES: readonly string[] = ['UTC', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'America/Sao_Paulo', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Istanbul', 'Africa/Cairo', 'Africa/Lagos', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Kuala_Lumpur', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland'];
/** What new members start with: their skin and time zone. A person's own choice in Settings always wins. */
export const memberDefaults = (defaults: Record<string, unknown>): { skin: string; timezone: string } => ({ skin: typeof defaults['skin'] === 'string' ? defaults['skin'] : system.id, timezone: typeof defaults['timezone'] === 'string' ? defaults['timezone'] : 'UTC' });
const GB = 1024 ** 3;
export const dollars = (micros: number): string => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: micros % 1e6 === 0 ? 0 : 2, maximumFractionDigits: micros % 1e6 === 0 ? 0 : 2 }).format(micros / 1e6);
export const spendLine = (spent: number, cap: number | undefined): string => cap === undefined ? `${dollars(spent)}, no limit set` : `${dollars(spent)} of ${dollars(cap)}`;
export function storageLine(machine: { diskFreeBytes?: number; diskTotalBytes?: number } | undefined): string {
    if (!machine || machine.diskTotalBytes === undefined || machine.diskFreeBytes === undefined)
        return 'Not reported yet';
    const used = Math.max(0, machine.diskTotalBytes - machine.diskFreeBytes);
    return `${Math.round(used / GB)} of ${Math.round(machine.diskTotalBytes / GB)} GB`;
}
/** Plan and usage: the design-beta sentence, what AI cost this month against the Space limit (the Spend and limits page sets it), and how much of the server's disk the Space uses. */
function PlanAndUsage(): ReactElement {
    const data = useConsoleData();
    const spend = useRead<CapMap['engine.spend.get']['out']>('engine.spend.get', { scope: 'space' });
    const overview = useRead<CapMap['console.overview']['out']>('console.overview');
    return <Section title="Plan and usage"><Group><Row id="space-plan" title="Vyre design beta" note="Contact Clearfield Labs for plans and pricing" leading={<Lead><Glyph name="coins" size={16} color="var(--ink-3)"/></Lead>}/><Row id="space-spend" title="AI spend this month" note={spend.data ? spendLine(spend.data.monthMicros, spend.data.caps.monthMicros) : spend.error ? 'Not available' : 'Checking'} leading={<Lead><Glyph name="chart" size={16} color="var(--ink-3)"/></Lead>} trailing={<Button label="Spend and limits" testID="space-spend-open" onPress={() => data.nav.openPage('spend')}/>}/><Row id="space-storage" title="Storage" note={overview.data ? storageLine(overview.data.machine) : overview.error ? 'Not available' : 'Checking'} leading={<Lead><Glyph name="box" size={16} color="var(--ink-3)"/></Lead>}/></Group></Section>;
}
export function SpaceProfile(): ReactElement {
    const result = useRead<CapMap['spaces.get']['out']>('spaces.get');
    const [name, setName] = useState(''), [legal, setLegal] = useState(''), [mode, setMode] = useState('relay'), [host, setHost] = useState(''), [confirm, setConfirm] = useState(false), [skin, setSkin] = useState(system.id), [zone, setZone] = useState('UTC');
    const action = useAction(result.refresh);
    useEffect(() => { const space = result.data?.space; if (space) {
        setName(space.name);
        setLegal(space.legalName ?? '');
        setMode(space.address.mode === 'own_domain' ? 'own_domain' : 'relay');
        setHost(space.address.host ?? '');
        const d = memberDefaults(space.defaults);
        setSkin(d.skin);
        setZone(d.timezone);
    } }, [result.data]);
    if (!result.data)
        return <ReadState error={result.error} retry={result.refresh}/>;
    const space = result.data.space, current = memberDefaults(space.defaults);
    const zones = TIME_ZONES.includes(zone) ? TIME_ZONES : [zone, ...TIME_ZONES];
    return <View testID="console-space-infra"><Section title="Identity"><Group><Field label="Space name" testID="infra-space-name" value={name} onChange={setName}/><Field label="Legal name" testID="infra-space-legal" value={legal} onChange={setLegal}/><Actions><Button label="Save" testID="infra-space-save" disabled={action.busy || !name.trim()} why={!name.trim()?"Name the Space":undefined} onPress={() => void action.run('spaces.update', { name: name.trim(), legalName: legal.trim() }, 'Saved.')}/></Actions><Row id="space-address-now" title="Address" note={space.address.host ?? 'This device'}/><Row id="space-id" title="Space ID" note={space.id}/><Row id="space-fingerprint" title="Key fingerprint" note={space.fingerprint}/><Row id="space-host" title="Hosted on" note={space.hostedOn ?? 'This server'}/><Row id="space-created" title="Created" note={new Date(space.createdAt).toLocaleString()}/></Group></Section><SpaceImage spaceName={space.name} logoFileId={space.logoFileId ?? null} onSaved={result.refresh}/><Section title="Defaults for new members"><Group><Select label="Skin" value={skin} onChange={setSkin} options={[{ key: system.id, title: system.name }, ...skins.map(k => ({ key: k.id, title: k.name }))]}/><Select label="Time zone" value={zone} onChange={setZone} options={zones.map(key => ({ key, title: key.replaceAll('_', ' ') }))}/><Actions><Button label="Save defaults" testID="infra-space-defaults-save" disabled={action.busy || (skin === current.skin && zone === current.timezone)} onPress={() => void action.run('spaces.update', { defaults: { ...space.defaults, skin, timezone: zone } }, 'Defaults saved.')}/></Actions></Group></Section><PlanAndUsage/><Section title="Address"><Group><Select label="Address type" value={mode} onChange={setMode} options={[{ key: 'relay', title: 'Vyre relay' }, { key: 'own_domain', title: 'Own domain' }]}/>{mode === 'own_domain' ? <Field label="Domain" testID="infra-space-host" value={host} onChange={setHost}/> : null}<Button label="Review address change…" testID="infra-space-address-review" disabled={action.busy || (mode === 'own_domain' && !host.trim())} onPress={() => setConfirm(true)}/></Group></Section>{confirm ? <Section title="Review change"><Group><Note>{`Change the address to ${mode === 'relay' ? 'Vyre relay' : host}? Devices keep the pinned Space key.`}</Note><Actions><Button label="Cancel" onPress={() => setConfirm(false)}/><Button label="Confirm" testID="infra-space-confirm" danger disabled={action.busy} onPress={() => void action.run('spaces.switch_address', { mode, ...(mode === 'own_domain' ? { host: host.trim() } : {}) }, 'Change accepted. Refresh this Space to see the current state.').then(out => { if (out) setConfirm(false); })}/></Actions></Group></Section> : null}{action.note ? <Note>{action.note}</Note> : null}</View>;
}
