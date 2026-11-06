
import { belowPhone } from "../../../../../ui/src/SidePane/layout.ts";import { SpaceLogoRow } from './SpaceImage.tsx';
import { createdLine } from './space-created.ts';
import { TIME_ZONES, zoneLabel } from './space-zones.ts';
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import type { CapMap } from '../../../../../generated/types.ts';
import { Row } from '../../../../../ui/src/Row/index.tsx';
import { Empty, Group, Lead, Line, Section } from '../shell/ui.tsx';
import { Glyph } from '../shell/glyphs.tsx';
import { useConsoleData } from '../shell/data.tsx';
import { Actions, Button, Note, ReadState, Select, useAction, useRead } from './shared.tsx';
import { useMenu } from '../../../../../ui/src/Menu/index.tsx';
import { ZonePicker } from '../../../../../ui/src/ZonePicker/index.tsx';
import { deadlineExample, deviceZone, zoneName } from '../../../../../lib/zones.ts';
import { refreshZones } from '../../shell/zones/ZonesHost.tsx';
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
export { TIME_ZONES };
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
    return <Section title="Plan and usage"><Group><Line index={0}><Row id="space-plan" title="Vyre design beta" note="Contact Clearfield Labs for plans and pricing" leading={<Lead><Glyph name="coins" size={16} color="var(--ink-3)"/></Lead>}/></Line><Line index={1}><Row id="space-spend" title="AI spend this month" note={spend.data ? spendLine(spend.data.monthMicros, spend.data.caps.monthMicros) : spend.error ? 'Not available' : 'Checking'} leading={<Lead><Glyph name="chart" size={16} color="var(--ink-3)"/></Lead>} trailing={<Button label="Spend and limits" testID="space-spend-open" onPress={() => data.nav.openPage('spend')}/>}/></Line><Line index={2}><Row id="space-storage" title="Storage" note={overview.data ? storageLine(overview.data.machine) : overview.error ? 'Not available' : 'Checking'} leading={<Lead><Glyph name="box" size={16} color="var(--ink-3)"/></Lead>}/></Line></Group></Section>;
}
/** A value on the right of a row that opens a short list: the chosen name, then a chevron. The list is the Console's own menu. */
function Pick({ label, shown, face, options, value, onChange, disabled = false, testID }: { label: string; shown: string; face?: ReactElement; options: readonly { key: string; title: string; face?: string }[]; value: string; onChange: (key: string) => void; disabled?: boolean; testID: string }): ReactElement {
    const menu = useMenu();
    return <View><Pressable accessibilityRole="button" accessibilityLabel={label} testID={testID} disabled={disabled} style={st.pick} onPress={(event) => { const rect = (event.currentTarget as unknown as { getBoundingClientRect?(): { left: number; bottom: number } })?.getBoundingClientRect?.(); menu.show(options.map((o) => ({ label: o.title, checked: o.key === value, ...(o.face ? { icon: o.face } : {}), onSelect: () => onChange(o.key) })), rect?.left ?? 20, rect?.bottom ?? 100, 'other'); }}>{face}<Text style={st.pickText} numberOfLines={1}>{shown}</Text><Glyph name="chevD" size={11} color="var(--ink-3)"/></Pressable>{menu.element}</View>;
}
/** A text field on the right of a row. It saves when the person leaves it, not on a button. */
function RowField({ label, value, onChange, onCommit, testID, width }: { label: string; value: string; onChange: (value: string) => void; onCommit: () => void; testID: string; width: number }): ReactElement {
    const narrow = belowPhone(useWindowDimensions().width);
    return <TextInput value={value} onChangeText={onChange} onBlur={onCommit} onSubmitEditing={onCommit} accessibilityLabel={label} testID={testID} autoCapitalize="none" autoCorrect={false} style={[st.field, { width: narrow ? Math.min(width, 190) : width }]}/>;
}
const skinFace = (id: string): ReactElement => { const k = skins.find(x => x.id === id); return k ? <View style={[st.swatch, { backgroundColor: k.palette.win, borderColor: k.palette.me }]}><View style={[st.dot, { backgroundColor: k.palette.accent }]}/></View> : <View style={[st.swatch, { flexDirection: 'row', overflow: 'hidden', borderColor: '#d8d6d0' }]}><View style={{ width: 8, height: 16, backgroundColor: '#f4f3ef' }}/><View style={{ width: 8, height: 16, backgroundColor: '#1b1b1d' }}/></View>; };
const skinOptions = [{ key: system.id, title: system.name }, ...skins.map(k => ({ key: k.id, title: k.name }))];
const copyAddress = (text: string): void => { void (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard?.writeText(text).catch(() => undefined); };
export function SpaceProfile(): ReactElement {
    const result = useRead<CapMap['spaces.get']['out']>('spaces.get');
    const [name, setName] = useState(''), [legal, setLegal] = useState(''), [mode, setMode] = useState('relay'), [host, setHost] = useState(''), [confirm, setConfirm] = useState(false), [copied, setCopied] = useState(false);
    const action = useAction(result.refresh);
    // the Space's own time zone: chosen first, saved after one line says what it changes
    const [pendingZone, setPendingZone] = useState<string | null>(null);
    const [zoneUndo, setZoneUndo] = useState<{ was: string; now: string; at: number } | null>(null);
    useEffect(() => { const space = result.data?.space; if (space) {
        setName(space.name);
        setLegal(space.legalName ?? '');
        setMode(space.address.mode === 'own_domain' ? 'own_domain' : 'relay');
        setHost(space.address.host ?? '');
    } }, [result.data]);
    if (!result.data)
        return <ReadState error={result.error} retry={result.refresh}/>;
    const space = result.data.space, current = memberDefaults(space.defaults);
    const zones = TIME_ZONES.includes(current.timezone) ? TIME_ZONES : [current.timezone, ...TIME_ZONES];
    const skinKnown = skinOptions.some(o => o.key === current.skin);
    // each field saves when it is left (name, legal name) or chosen (skin, time zone), and only when it changed
    const saveName = (): void => { const next = name.trim(); if (!next) { setName(space.name); return; } if (next !== space.name) void action.run('spaces.update', { name: next }, 'Name saved.'); };
    const saveLegal = (): void => { const next = legal.trim(); if (next !== (space.legalName ?? '')) void action.run('spaces.update', { legalName: next }, 'Legal name saved.'); };
    const saveDefault = (change: { skin?: string; timezone?: string }, said: string): void => { const next = { skin: current.skin, timezone: current.timezone, ...change }; if (next.skin !== current.skin || next.timezone !== current.timezone) void action.run('spaces.update', { defaults: { ...space.defaults, ...next } }, said); };
    const mono = (text: string): ReactElement => <Text style={st.mono} numberOfLines={1}>{text}</Text>;
    const address = space.address.host ?? 'This device';
    return <View testID="console-space-infra"><Section title="Identity"><Group>
        <SpaceLogoRow spaceName={space.name} logoFileId={space.logoFileId ?? null} onSaved={result.refresh}/>
        <Line index={1}><Row id="space-name" title="Name" trailing={<RowField label="Space name" testID="infra-space-name" value={name} onChange={setName} onCommit={saveName} width={220}/>}/></Line>
        <Line index={2}><Row id="space-legal" tall title="Legal name" note="Shown on public pages and emails" trailing={<RowField label="Legal name" testID="infra-space-legal" value={legal} onChange={setLegal} onCommit={saveLegal} width={260}/>}/></Line>
        <Line index={3}><Row id="space-address-now" title="Address" trailing={<View style={st.inline}>{mono(address)}<Button label={copied ? 'Copied' : 'Copy'} testID="space-address-copy" onPress={() => { copyAddress(address); setCopied(true); setTimeout(() => setCopied(false), 1500); }}/></View>}/></Line>
    </Group>{action.note ? <Note>{action.note}</Note> : null}</Section>
    <Section title="Time zone"><Group>
        <Line index={0}><Row id="space-timezone-now" tall title="Space time zone" note="Every shared place reads times in it. People see their own time beside it." trailing={<ZonePicker label="Space time zone" testID="infra-space-timezone" value={pendingZone ?? space.timezone ?? deviceZone()} disabled={action.busy} onChange={(zone) => setPendingZone(zone === (space.timezone ?? '') ? null : zone)}/>}/></Line>
        <Line index={1}><Row id="space-timezone" title="Time zone for new members" note="Where a new member's own clock starts. It does not change what shared places show." trailing={<Pick label="Time zone" testID="infra-space-zone" value={current.timezone} shown={zoneLabel(current.timezone)} options={zones.map(key => ({ key, title: zoneLabel(key) }))} disabled={action.busy} onChange={key => saveDefault({ timezone: key }, 'Time zone saved.')}/>}/></Line>
    </Group>
    {pendingZone !== null ? <View style={{ marginTop: 12 }}><Group><Line index={0}><View testID="space-timezone-confirm" style={st.confirm}>
        <Text style={st.confirmHead}>{`Check-ins, due times and schedules will read in ${zoneName(pendingZone)}.`}</Text>
        <Text style={st.confirmLine}>{`Deadlines already set keep their real moment: one set for ${deadlineExample(Date.now(), space.timezone ?? deviceZone(), pendingZone).before} now reads ${deadlineExample(Date.now(), space.timezone ?? deviceZone(), pendingZone).after}. Nothing moves.`}</Text>
        <Text style={st.confirmLine}>Everyone's own time follows beside it.</Text>
        <View style={st.inline}><Button label="Cancel" testID="infra-space-timezone-cancel" onPress={() => setPendingZone(null)}/><Button primary label="Change time zone" testID="infra-space-timezone-save" disabled={action.busy} onPress={() => { const zone = pendingZone, was = space.timezone ?? deviceZone(); setPendingZone(null); void action.run('spaces.timezone.set', { timezone: zone }, '').then((out) => { refreshZones(); if (out) setZoneUndo({ was, now: zone, at: Date.now() }); }); }}/></View>
    </View></Line></Group></View> : null}
    {zoneUndo !== null && pendingZone === null ? <View style={{ marginTop: 12 }}><Group><Line index={0}><Row id="space-timezone-saved" tall title={`Space time zone is now ${zoneName(zoneUndo.now)}.`} note="Recorded in the audit log: changed by you, just now." trailing={<Button label="Undo" testID="infra-space-timezone-undo" disabled={action.busy} onPress={() => { const back = zoneUndo.was; setZoneUndo(null); void action.run('spaces.timezone.set', { timezone: back }, '').then(() => refreshZones()); }}/>}/></Line></Group></View> : null}
    </Section>
    <Section title="Defaults for new members"><Group>
        <Line index={0}><Row id="space-skin" title="Skin" trailing={<Pick label="Skin" testID="infra-space-skin" value={current.skin} shown={skinOptions.find(o => o.key === current.skin)?.title ?? current.skin} face={skinFace(skinKnown ? current.skin : system.id)} options={skinOptions} disabled={action.busy} onChange={key => saveDefault({ skin: key }, 'Skin saved.')}/>}/></Line>
    </Group></Section>
    <PlanAndUsage/>
    <Section title="Address settings"><Group>
        <Line index={0}><Row id="space-address-type" title="Address type" trailing={<Pick label="Address type" testID="infra-space-mode" value={mode} shown={mode === 'own_domain' ? 'Own domain' : 'Vyre relay'} options={[{ key: 'relay', title: 'Vyre relay' }, { key: 'own_domain', title: 'Own domain' }]} onChange={setMode}/>}/></Line>
        {mode === 'own_domain' ? <Line index={1}><Row id="space-host-field" title="Domain" trailing={<RowField label="Domain" testID="infra-space-host" value={host} onChange={setHost} onCommit={() => undefined} width={260}/>}/></Line> : null}
        <Line index={1}><Row id="space-address-review" title="Address change" note="Devices keep the pinned Space key" trailing={<Button label="Review address change…" testID="infra-space-address-review" disabled={action.busy || (mode === 'own_domain' && !host.trim())} onPress={() => setConfirm(true)}/>}/></Line>
    </Group></Section>
    {confirm ? <Section title="Review change"><Group><Note>{`Change the address to ${mode === 'relay' ? 'Vyre relay' : host}? Devices keep the pinned Space key.`}</Note><Actions><Button label="Cancel" onPress={() => setConfirm(false)}/><Button label="Confirm" testID="infra-space-confirm" danger disabled={action.busy} onPress={() => void action.run('spaces.switch_address', { mode, ...(mode === 'own_domain' ? { host: host.trim() } : {}) }, 'Change accepted. Refresh this Space to see the current state.').then(out => { if (out) setConfirm(false); })}/></Actions></Group></Section> : null}
    <Section title="Details"><Group>
        <Line index={0}><Row id="space-id" title="Space ID" trailing={mono(space.id)}/></Line>
        <Line index={1}><Row id="space-fingerprint" title="Key fingerprint" trailing={mono(space.fingerprint)}/></Line>
        <Line index={2}><Row id="space-host" title="Hosted on" trailing={<Text style={st.plain} numberOfLines={1}>{space.hostedOn ?? 'This server'}</Text>}/></Line>
        <Line index={3}><Row id="space-created" title="Created" trailing={<Text style={st.plain} testID="space-created-value" numberOfLines={1}>{createdLine(space.createdAt)}</Text>}/></Line>
    </Group></Section></View>;
}
const st = StyleSheet.create({
    pick: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30, paddingHorizontal: 8, borderRadius: 7 },
    pickText: { fontSize: 13, color: 'var(--ink)' as string, flexShrink: 1 },
    field: { height: 30, borderWidth: 1, borderColor: 'var(--line)' as string, borderRadius: 7, paddingHorizontal: 10, fontSize: 13, color: 'var(--ink)' as string, backgroundColor: 'var(--win)' as string, maxWidth: '100%' },
    inline: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    plain: { fontSize: 13, color: 'var(--ink-3)' as string },
    mono: { fontSize: 12, color: 'var(--ink-3)' as string, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
    confirm: { gap: 6, paddingVertical: 10, paddingHorizontal: 12 },
    confirmHead: { fontSize: 13.5, fontWeight: '600', color: 'var(--ink)' as string },
    confirmLine: { fontSize: 12.5, color: 'var(--ink-3)' as string },
    swatch: { width: 18, height: 18, borderRadius: 5, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    dot: { width: 6, height: 6, borderRadius: 3 },
});
