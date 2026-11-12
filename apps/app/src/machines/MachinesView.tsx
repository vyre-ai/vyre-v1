// Machines: every computer that runs Vyre work, as one list and one page each. The Console shows all of the Space's (scope "space"); Settings, This device shows the asker's own (scope "mine"): the same
// component, the same words, the same Add a server. A machine page has four interactive charts over 1 h, 24 h, 7 d and 30 d with hover values, what runs by agent and chat, what it can run,
// its health, its limits (nickname, most turns and agent computers at once, Drain) and the agents pinned to it. On a member's own computer an admin sees its name, whether it is online, its capacity
// and Vyre's own work, and nothing else (the report carries no more).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Row } from "../../../../ui/src/Row/index.tsx";
import { Segmented } from "../../../../ui/src/Segmented/index.tsx";
import { TextField } from "../../../../ui/src/TextField/index.tsx";
import { menuTrigger, useMenu } from "../../../../ui/src/Menu/index.tsx";
import { machineMenu } from "../places/chats/menus/kinds-b.ts";
import { copyToClipboard, createMenuApiB, vyreLink } from "../places/chats/menus/actions-b.ts";
import { Dot, Glyph } from "../console/shell/glyphs.tsx";
import { Chart } from "./Chart.tsx";
import { Button } from "../console/pages/shared.tsx";
import { AddServerSheet, copyText, useAddServer } from "./AddServer.tsx";
import type { AddScope } from "./AddServer.tsx";
import { ENGINE_NAMES, PRIVATE_NOTE, RANGES, RANGE_NOTE, canNames, chartsFor, displayName, fmtBytes, kindLine, loadCells, orderLines, ordered, plural, runsLines, statusOf, strip } from "./model.ts";
import type { MachineOut, MachineRow, MachinesOut, Range } from "./model.ts";
import { fixMachine, loadMachine, loadMachines, pinMachine, setMachine } from "./api.ts";

export type Call = (cap: string, input: Record<string, unknown>) => Promise<unknown>;
export interface MachinesViewProps {
  call: Call;
  scope: AddScope;
  /** A person's name from their id. */
  who(id: string): string;
  /** A Personal Space has no Console: this is where its servers are added, through the relay. */
  personal?: boolean;
  /** The machine to open at first (a link from an alert, the Inbox or the address). */
  initialId?: string | null;
  /** Told when a machine is opened or closed, so an address can follow. */
  onOpen?(id: string | null): void;
  /** Open another Console page (Logs, Updates, Backups) from a machine page. */
  goto?(page: string): void;
  /** The Add a server sheet is open at first (asked for from the Space menu or an agent's page). */
  startAdd?: boolean;
  /** Drawn under the list: the Console adds the agent computers, which sit under the machine that hosts them. */
  extra?: ReactNode;
  /** Reload every this many ms; 0 for never (tests). Default 15 s. */
  refreshMs?: number;
  /** The window width, when the host knows it before layout (tests). */
  width?: number;
  clock?: () => number;
}

export function useMachines(call: Call, refreshMs: number): { data: MachinesOut | null; error: boolean; reload(): Promise<void> } {
  const [data, setData] = useState<MachinesOut | null>(null);
  const [error, setError] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const reload = useCallback(async (): Promise<void> => {
    try { const out = await loadMachines(call); if (alive.current) { setData(out); setError(false); } } catch { if (alive.current) setError(true); }
  }, [call]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (refreshMs <= 0) return undefined; const t = setInterval(() => { void reload(); }, refreshMs); return () => clearInterval(t); }, [reload, refreshMs]);
  return { data, error, reload };
}

export function MachinesView(props: MachinesViewProps): ReactElement {
  const { call, scope, who } = props;
  const measured = useWindowDimensions().width;
  const width = props.width ?? measured;
  const narrow = width < 760;
  const [open, setOpen] = useState<string | null>(props.initialId ?? null);
  const { data, error, reload } = useMachines(call, props.refreshMs ?? 15_000);
  const add = useAddServer({ call, scope, personal: props.personal === true, reload, ...(props.startAdd ? { startOpen: true } : {}), ...(props.clock ? { clock: props.clock } : {}) });
  const now = (props.clock ?? Date.now)();
  useEffect(() => { if (props.initialId !== undefined) setOpen(props.initialId ?? null); }, [props.initialId]);
  const pick = (id: string | null): void => { setOpen(id); props.onOpen?.(id); };

  const body = ((): ReactElement => {
    if (!data) return <Text style={s.note} testID="machines-loading">{error ? "Couldn't load the computers. Check access and try again." : "Loading computers"}</Text>;
    const m = open ? data.machines.find((x) => x.serverId === open) : undefined;
    if (m) return <MachinePage {...props} row={m} width={width} narrow={narrow} onBack={() => pick(null)} onChanged={() => void reload()} />;
    return <MachineList data={data} who={who} narrow={narrow} now={now} onOpen={pick} onAdd={add.open} onApprove={add.approve} onDecline={add.decline} scope={scope} extra={props.extra} call={call} reload={reload} />;
  })();
  return (
    <View testID="machines" style={s.page}>
      {body}
      {add.sheet ? (
        <AddServerSheet
          sheet={add.sheet} servers={[...(data?.waiting ?? []).map((w) => ({ serverId: w.serverId, name: w.name, state: "down" as const, enrollment: "pending" as const, ...(w.fingerprint ? { fingerprint: w.fingerprint } : {}), ...(w.facts ? { facts: w.facts } : {}) })), ...(data?.machines ?? []).map((x) => ({ serverId: x.serverId, name: x.name, state: x.state, enrollment: "approved" as const }))]} busy={add.busy} error={add.error} now={add.now}
          onNickname={add.setNickname} onMake={add.make} onApprove={add.approve} onDecline={add.decline} onCopy={copyText} onClose={add.close}
        />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- the list

function Tile({ icon, label, big, sub, warn }: { icon: string; label: string; big: string; sub: string; warn?: boolean }): ReactElement {
  return (
    <View style={s.tile} testID={`tile-${label}`}>
      <View style={s.tileHead}><Glyph name={icon} size={14} color="var(--ink-3)" /><Text style={s.tileLabel}>{label}</Text></View>
      <Text style={[s.tileBig, warn && { color: "var(--warn)" as string }]}>{big}</Text>
      <Text style={s.tileSub}>{sub}</Text>
    </View>
  );
}

export function MachineList({ data, who, narrow, now, onOpen, onAdd, onApprove, onDecline, scope, extra, call, reload }: { call?: Call; reload?(): Promise<void>; data: MachinesOut; who(id: string): string; narrow: boolean; now: number; onOpen(id: string): void; onAdd(): void; onApprove?(serverId: string): void; onDecline?(serverId: string): void; scope: AddScope; extra?: ReactNode }): ReactElement {
  const ms = ordered(data.machines), st = strip(ms, data.alerts);
  const order = placementOrder(ms);
  const menu = useMenu();
  const api = useMemo(() => (call ? createMenuApiB({ call }) : null), [call]);
  const [menuNote, setMenuNote] = useState("");
  /** The row's own menu (chats/menus/kinds-b.ts): what the person may do to this machine, from who it belongs to and whether they are an admin. */
  const rowMenu = (m: MachineRow, x: number, y: number): void => {
    const once = (run: () => Promise<void>, note: string): void => { if (!api) return; setMenuNote(""); void run().then(() => { setMenuNote(note); void reload?.(); }, (e: unknown) => setMenuNote(e instanceof Error ? e.message : "That did not work.")); };
    const own = m.mine, admin = data.admin;
    const confirm = (): void => menu.show([{ head: `Remove ${displayName(m)} from the Space?` }, { label: "Remove", danger: true, onSelect: () => once(() => (admin ? api!.serverRemove(m.serverId) : api!.myComputerRemove(m.serverId)), `${displayName(m)} removed`) }, { label: "Cancel" }], x, y, "other");
    menu.show(machineMenu(
      { name: displayName(m), draining: m.drain, canDrain: api !== null && (admin || own), canFix: api !== null && (own || (admin && m.kind !== "linked")), canRemove: api !== null && m.kind === "server" && (admin || own) },
      {
        open: () => onOpen(m.serverId),
        drain: (on) => once(() => api!.machineDrain(m.serverId, on), on ? `${displayName(m)} is draining` : `${displayName(m)} takes new work again`),
        clearCaches: () => once(() => api!.machineFix(m.serverId, "clear_caches"), "Cleared old caches"),
        stopIdle: () => once(() => api!.machineFix(m.serverId, "stop_idle"), "Stopped idle sessions"),
        pinAgent: () => onOpen(m.serverId),
        copyAddress: () => copyToClipboard(vyreLink("machine", m.serverId)),
        remove: confirm,
      },
    ), x, y, "context", { label: displayName(m) });
  };
  return (
    <View testID="machines-list">
      <View style={s.top}>
        <Text style={s.lead}>{scope === "space" ? "Every computer that runs Vyre work for this Space. Add a server here, and set what each one may run." : "The computers and servers you linked. Add a server here that only you use."}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Add a server" testID="machines-add" onPress={onAdd} style={[s.primary, pointer]}><Glyph name="plus" size={13} color="var(--win)" /><Text style={s.primaryText}>Add a server</Text></Pressable>
      </View>
      <View style={s.tiles} testID="machines-strip">
        <Tile icon="server" label="Computers" big={st.online} sub={`${st.offline}`} />
        <Tile icon="warn" label="Needs attention" big={String(st.attention)} sub={st.attentionWords} warn={st.attention > 0} />
        <Tile icon="ok" label="Running now" big={st.turns.split(",")[0]!} sub={st.turns.split(",").slice(1).join(",").trim()} />
        <Tile icon="data" label="Room left" big={String(st.room)} sub={`Average across ${plural(st.takingWork, "computer")} that take work`} />
      </View>
      {data.waiting.length > 0 ? (
        <Block title="Waiting for approval" count={data.waiting.length} testID="machines-waiting">
          {data.waiting.map((w) => <Row key={w.serverId} id={`waiting-${w.serverId}`} title={w.name} note={[w.facts ? `${w.facts.os} ${w.facts.arch}${w.facts.docker ? ", Docker" : ""}` : null, w.fingerprint ? `Fingerprint ${w.fingerprint}` : null].filter(Boolean).join(" \u00b7 ")} tall
            trailing={<View style={s.inline}><Pressable accessibilityRole="button" accessibilityLabel={`Deny ${w.name}`} testID={`waiting-decline-${w.serverId}`} onPress={() => onDecline?.(w.serverId)} style={[s.small, pointer]}><Text style={s.smallText}>Deny</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Allow ${w.name}`} testID={`waiting-approve-${w.serverId}`} onPress={() => onApprove?.(w.serverId)} style={[s.primary, pointer]}><Text style={s.primaryText}>Allow</Text></Pressable></View>} />)}
        </Block>
      ) : null}
      {data.alerts.length > 0 ? (
        <Block title="Alerts" count={data.alerts.length} testID="machines-alerts">
          {data.alerts.map((a) => <Row key={a.alertId} id={`alert-${a.alertId}`} title={a.title} note={a.detail} tall leading={<View style={s.lead36}><Glyph name={a.kind === "offline" ? "server" : "warn"} size={15} color={a.kind === "offline" ? "var(--danger)" : "var(--warn)"} /></View>} trailing={<Pressable accessibilityRole="button" accessibilityLabel={`Open ${a.title}`} testID={`alert-open-${a.serverId}`} onPress={() => onOpen(a.serverId)} style={[s.small, pointer]}><Text style={s.smallText}>Open</Text></Pressable>} />)}
        </Block>
      ) : null}
      <Block title={scope === "space" ? "All computers" : "My computers and servers"} count={ms.length} testID="machines-table">
        {/* ui-rows-lint: not a list (the table's column headings) */}
        {narrow || ms.length === 0 ? null : <View style={[s.mrow, s.mheadRow]} testID="machines-head"><View style={s.mname}><Text style={s.mheadText}>Computer</Text></View><View style={s.cells}>{["Status", "CPU", "Memory", "Disk", "Running", "Can run", "Room left"].map((h) => <View key={h} style={s.cell}><Text style={s.mheadText}>{h}</Text></View>)}</View></View>}
        {ms.length === 0 ? <Text testID="machines-none" style={s.note}>No computers yet. Add a server to run agents around the clock.</Text> : null}
        {/* ui-rows-lint: not a list (a table of machines: one row per machine with Status, CPU, Memory, Disk, Running, Can run and Room left cells under shared column headings, hover painted across the full row) */}
        {ms.map((m) => <MachineRowView key={m.serverId} m={m} who={who} narrow={narrow} now={now} onOpen={() => onOpen(m.serverId)} onMenu={(x, y) => rowMenu(m, x, y)} />)}
      </Block>
      {menu.element}
      {menuNote ? <Text accessibilityRole="alert" style={s.note} testID="machine-menu-note">{menuNote}</Text> : null}
      {extra}
      <Text style={s.foot}>On a member's own computer an admin sees its name, whether it is online, its capacity and Vyre's own work. Its files and processes stay private to that member.</Text>
      {order.length > 0 ? (
        <Block title="Where work runs" note="Your order, for turns you start" testID="machines-order">
          {orderLines(order).map((l, i) => <Row key={l.title} id={`order-${i}`} title={l.title} note={l.note} tall leading={<View style={[s.num, l.use && s.numOn]}><Text style={s.numText}>{i + 1}</Text></View>} trailing={<Text style={s.roomText}>{`Room ${l.room}`}</Text>} />)}
        </Block>
      ) : null}
    </View>
  );
}

/** The order a person's own turns try machines in: their linked computers, their servers, then the Space server (the order the engine keeps; Automatic skips a busy one). */
export function placementOrder(ms: readonly MachineRow[]): { name: string; label: string; roomN: number; why: string; online: boolean; drain: boolean }[] {
  const mine = ms.filter((m) => m.mine && m.kind === "linked"), servers = ms.filter((m) => m.mine && m.kind === "server"), space = ms.filter((m) => m.kind === "space");
  const out: { name: string; label: string; roomN: number; why: string; online: boolean; drain: boolean }[] = [];
  const one = (m: MachineRow, label: string): void => { out.push({ name: displayName(m), label, roomN: m.room.n, why: m.room.why, online: m.online, drain: m.drain }); };
  mine.forEach((m, i) => one(m, i === 0 ? "Your desktop" : "Your other computers"));
  servers.forEach((m) => one(m, "Your server"));
  space.forEach((m) => one(m, "The Space server"));
  return out;
}

function MachineRowView({ m, who, narrow, now, onOpen, onMenu }: { m: MachineRow; who(id: string): string; narrow: boolean; now: number; onOpen(): void; onMenu(x: number, y: number): void }): ReactElement {
  const st = statusOf(m, now), cells = loadCells(m), runs = runsLines(m), can = canNames(m.can);
  const dot = st.tone;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${displayName(m)}. ${st.word}`} testID={`machine-${m.serverId}`} onPress={onOpen} {...menuTrigger(onMenu)} style={({ hovered }: { hovered?: boolean }) => [s.mrow, !m.online && { opacity: 0.7 }, hovered === true && { backgroundColor: "var(--hover)" as string }, pointer]}>
      <View style={s.mname}>
        <View style={s.ico}><Glyph name={m.kind === "linked" ? "device" : "server"} size={16} color="var(--ink-2)" /></View>
        <View style={{ flexShrink: 1 }}>
          <Text numberOfLines={1} style={s.mtitle}>{displayName(m)}</Text>
          <Text numberOfLines={1} style={s.msub}>{kindLine(m, who)}</Text>
        </View>
      </View>
      <View style={[s.cells, narrow && s.cellsNarrow]}>
        <Cell label="Status" narrow={narrow}><View style={s.inline}><Dot tone={dot} size={6} /><Text style={s.cellMain}>{st.word}</Text></View>{st.sub ? <Text style={s.cellSub}>{st.sub}</Text> : null}</Cell>
        <Cell label="CPU" narrow={narrow}><Text style={[s.cellMain, cells.private && s.private]}>{cells.cpu}</Text><Text style={s.cellSub}>{m.cores ? `${m.cores} cores` : ""}</Text></Cell>
        <Cell label="Memory" narrow={narrow}><Text style={[s.cellMain, cells.private && s.private]}>{cells.mem}</Text><Text style={s.cellSub}>{m.memBytes ? fmtBytes(m.memBytes) : ""}</Text></Cell>
        <Cell label="Disk" narrow={narrow}><Text style={[s.cellMain, cells.private && s.private]}>{cells.disk}</Text><Text style={s.cellSub}>{m.diskBytes ? `of ${fmtBytes(m.diskBytes)}` : ""}</Text></Cell>
        {/* ui-rows-lint: not a list (the extra lines under Running in one cell) */}
        <Cell label="Running" narrow={narrow}><Text style={s.cellMain}>{runs[0]}</Text>{runs.slice(1).map((r) => <Text key={r} style={s.cellSub}>{r}</Text>)}</Cell>
        {/* ui-rows-lint: not a list (the engines a machine can run, as chips) */}
        <Cell label="Can run" narrow={narrow}><View style={s.chips}>{can.map((c) => <Text key={c} style={s.chip}>{c}</Text>)}</View></Cell>
        <Cell label="Room left" narrow={narrow}><Text style={s.cellMain} testID={`room-${m.serverId}`}>{m.online ? String(m.room.n) : "0"}</Text></Cell>
      </View>
    </Pressable>
  );
}

function Cell({ label, narrow, children }: { label: string; narrow: boolean; children: ReactNode }): ReactElement {
  return <View style={[s.cell, narrow && s.cellNarrow]}>{narrow ? <Text style={s.cellLabel}>{label}</Text> : null}{children}</View>;
}

function Block({ title, count, note, children, testID }: { title: string; count?: number; note?: string; children: ReactNode; testID?: string }): ReactElement {
  return (
    <View style={s.block} testID={testID}>
      <View style={s.blockHead}><Text accessibilityRole="header" style={s.blockTitle}>{title}</Text>{count !== undefined ? <Text style={s.blockCount}>{count}</Text> : null}{note ? <Text style={s.blockNote}>{note}</Text> : null}</View>
      <View style={s.card}>{children}</View>
    </View>
  );
}

// ---------------------------------------------------------------- one machine

type Tab = "overview" | "health" | "updates";

function MachinePage(props: MachinesViewProps & { row: MachineRow; width: number; narrow: boolean; onBack(): void; onChanged(): void }): ReactElement {
  const { call, row, narrow, who } = props;
  const [range, setRange] = useState<Range>("24h");
  const [tab, setTab] = useState<Tab>("overview");
  const [hover, setHover] = useState<number | null>(null);
  const [detail, setDetail] = useState<MachineOut | null>(null);
  const [again, setAgain] = useState(0);
  const [fixed, setFixed] = useState<string>("");
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    let live = true;
    void loadMachine(call, row, range).then((out) => { if (live && alive.current) setDetail(out); }, () => undefined);
    return () => { live = false; };
  }, [call, row.serverId, range, row.room.n, row.pins.length, row.drain, again]);
  const onFix = (fix: "clear_caches" | "stop_idle"): void => {
    setFixed("Working on it");
    void fixMachine(call, row.serverId, fix).then((out) => { if (alive.current) { setFixed(out.detail); setAgain((n) => n + 1); } }, () => { if (alive.current) setFixed("Couldn't do that. Try again."); });
  };

  const m = detail?.machine ?? row;
  const removal = props.scope === "space" && m.kind === "server" ? { word: "Remove this server", pcs: m.runs.agentComputers, run: async (): Promise<void> => { await call("network.server_remove", { serverId: row.serverId }); props.onChanged(); props.onBack(); } } : undefined;
  const own = detail ? detail.privacy === "full" : !row.private;
  const colWidth = Math.max(280, Math.min(props.width, 1200) - (narrow ? 32 : 56));
  const chartW = narrow ? colWidth - 28 : Math.floor((colWidth - 14) / 2) - 28;
  return <MachineDetail m={m} detail={detail} own={own} range={range} tab={tab} hover={hover} chartW={chartW} narrow={narrow} who={who} now={(props.clock ?? Date.now)()} goto={props.goto} onFix={onFix} fixed={fixed} {...(removal ? { removal } : {})} onRange={setRange} onTab={setTab} onHover={setHover} onBack={props.onBack} placement={<Placement {...props} m={m} />} />;
}

export interface MachineDetailProps {
  m: MachineRow; detail: MachineOut | null; own: boolean; range: Range; tab: Tab; hover: number | null; chartW: number; narrow: boolean; who(id: string): string; now: number; goto: ((page: string) => void) | undefined; onFix?(fix: "clear_caches" | "stop_idle"): void; fixed?: string; /** The danger block at the foot of an added server's page (prototype vyre-console.html line 4304): Remove asks first, and says the access ends at once. */ removal?: { word: string; pcs: number; run(): Promise<void> };
  onRange(r: Range): void; onTab(t: Tab): void; onHover(f: number | null): void; onBack(): void; placement: ReactNode;
}

/** One machine's page, drawn from what machines.get answered: nothing here fetches, so the same page serves the Console, Settings and the tests. */
export function MachineDetail({ m, detail, own, range, tab, hover, chartW, narrow, who, now, goto, onFix, fixed, removal, onRange, onTab, onHover, onBack, placement }: MachineDetailProps): ReactElement {
  const st = statusOf(m, now);
  const bad = detail ? detail.findings.filter((f) => f.state !== "healthy").length : 0;
  return (
    <View testID="machine-page">
      <Pressable accessibilityRole="button" accessibilityLabel="Back to computers" testID="machine-back" onPress={onBack} style={[s.crumb, pointer]}><Glyph name="chevR" size={11} color="var(--ink-3)" /><Text style={s.crumbText}>Computers</Text></Pressable>
      <View style={s.hero}>
        <View style={s.ico44}><Glyph name={m.kind === "linked" ? "device" : "server"} size={20} color="var(--ink-2)" /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.heroTitle} testID="machine-title">{displayName(m)}{m.nickname ? <Text style={s.heroSub}>{` (${m.name})`}</Text> : null}</Text>
          <Text style={s.heroSub}>{[kindLine(m, who), m.os, m.arch].filter(Boolean).join(" \u00b7 ")}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}><View style={s.inline}><Dot tone={st.tone} size={6} /><Text style={s.cellMain}>{st.word}</Text></View><Text style={s.cellSub}>{st.sub}</Text></View>
      </View>
      <View style={s.tabs} accessibilityRole="tablist">
        {/* ui-rows-lint: not a list (the machine's tabs) */}
        {(["overview", "health", "updates"] as const).map((k) => (
          <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} aria-selected={tab === k} testID={`machine-tab-${k}`} onPress={() => onTab(k)} style={[s.tab, tab === k && s.tabOn, pointer]}>
            <Text style={[s.tabText, tab === k && s.tabTextOn]}>{k === "overview" ? "Overview" : k === "health" ? `Health${bad ? ` ${bad}` : ""}` : "Updates and backups"}</Text>
          </Pressable>
        ))}
      </View>
      {tab === "overview" ? (
        <View testID="machine-overview">
          {!own && m.owner ? <View style={s.mnote} testID="machine-private"><Glyph name="lock" size={14} color="var(--ink-2)" /><Text style={s.mnoteText}>{PRIVATE_NOTE(who(m.owner))}</Text></View> : null}
          <View style={s.spec}>
            {/* ui-rows-lint: not a list (a spec grid of name and value) */}
            {[["Version", m.version ?? "unknown"], ["CPU", m.cores ? `${m.cores} cores` : "unknown"], ["Memory", m.memBytes ? fmtBytes(m.memBytes) : "unknown"], ["Disk", m.diskBytes ? fmtBytes(m.diskBytes) : "unknown"], ["Latency", m.online ? (m.latencyMs !== undefined ? `${m.latencyMs} ms` : m.kind === "space" ? "Local" : "unknown") : "No link"], ["Room left", m.online ? (m.drain ? "0, draining" : String(m.room.n)) : "0"]].map(([k, v]) => (
              <View key={k} style={s.specCell}><Text style={s.cellSub}>{k}</Text><Text style={s.specVal}>{v}</Text></View>
            ))}
          </View>
          <View style={s.rangeRow}>
            <Text style={s.blockTitle}>{own ? "Load" : "Vyre's share of this computer"}</Text>
            <Text style={s.blockNote}>{`${RANGE_NOTE[range]}. History is kept 30 days`}</Text>
            <View style={{ flex: 1 }} />
            <Segmented label="Range" testID="machine-range" value={range} onChange={onRange} options={RANGES.map((r) => ({ id: r.key, label: r.label }))} />
          </View>
          <View style={[s.charts, narrow && { flexDirection: "column" }]} testID="machine-charts">
            {/* ui-rows-lint: not a list (a grid of charts) */}
            {detail ? chartsFor(detail.privacy).map((def) => <View key={def.key} style={narrow ? undefined : { width: chartW + 28 }}><Chart def={def} points={detail.series.points} range={range} width={chartW} hover={hover} onHover={onHover} /></View>) : <Text style={s.note}>Loading history</Text>}
          </View>
          <Block title="Running now" count={detail ? detail.work.length : 0} note={own ? "By agent and chat" : "Vyre's work only"} testID="machine-work">
            {m.online && detail && detail.work.length > 0 ? detail.work.map((w, i) => <Row key={`${w.agent}${i}`} id={`work-${i}`} title={w.agent} note={`${w.what} · ${w.where}`} tall trailing={<Text style={s.roomText}>{own ? `${Math.round(w.cpu)}% CPU` : "Vyre's work"}</Text>} />) : <Text style={s.empty}>{m.online ? "Nothing is running here" : "Offline. Nothing is running here"}</Text>}
          </Block>
          <Block title="Can run" note="Installed here" testID="machine-can">
            <View style={s.chipsBig}>
              {/* ui-rows-lint: not a list (the engines it can run, as chips) */}
              {canNames(m.can).map((c) => <Text key={c} style={s.chipBig}>{`✓ ${c}`}</Text>)}
              {/* ui-rows-lint: not a list (the engines it cannot run, as chips) */}
              {ENGINE_NAMES.filter((c) => !canNames(m.can).includes(c)).map((c) => <Text key={c} style={[s.chipBig, s.chipNo]}>{c}</Text>)}
            </View>
            <Text style={s.empty}>{m.kind === "linked" ? "Names only. Vyre never lists what else is installed on a personal computer." : "Names only."}</Text>
          </Block>
          {placement}
          {removal ? <RemoveServer m={m} removal={removal} /> : null}
        </View>
      ) : null}
      {tab === "health" ? <HealthTab detail={detail} m={m} goto={goto} onFix={onFix} fixed={fixed} /> : null}
      {tab === "updates" ? <UpdatesTab m={m} goto={goto} /> : null}
    </View>
  );
}

/** What the confirm of Stop idle sessions says: how many will stop, and whose. */
export const stopLine = (n: number, space: boolean): string => (n === 0 ? "No idle engine sessions are open." : `This stops ${n} idle engine session${n === 1 ? "" : "s"}${space ? " on the Space server, whoever they belong to" : " of yours on this computer"}. A turn that is running is not touched.`);

/** The confirm names the agent computers that stop (the clause is left out when there are none) and says the access ends at once. */
export const removeMessage = (name: string, agentComputers: number): string => `Remove ${name}? ${agentComputers > 0 ? `${plural(agentComputers, "agent computer")} on it stop and their local data is wiped. ` : ""}Its access ends at once.`;

/**
 * The prototype's foot of an added server's page (vyre-console.html 4328, mcfm 4348, .mdanger 934): a card holding the confirm (the message, a real Cancel and a danger Remove) when it is asked,
 * then the danger row: Remove this server… with its quiet line beside it. Remove calls network.server_remove.
 */
function RemoveServer({ m, removal }: { m: MachineRow; removal: NonNullable<MachineDetailProps["removal"]> }): ReactElement {
  const [asking, setAsking] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const go = (): void => { setBusy(true); setErr(""); void removal.run().catch((e: unknown) => { setErr(e instanceof Error ? e.message : "Couldn't remove it. Try again."); setBusy(false); }); };
  return (
    <View testID="machine-remove">
      {asking ? (
        <View testID="machine-remove-confirm" accessibilityRole="alert" style={s.removeCard}>
          <Text style={[s.cellMain, { flex: 1, minWidth: 220 }]}>{removeMessage(displayName(m), removal.pcs)}</Text>
          <Button label="Cancel" small testID="machine-remove-cancel" onPress={() => setAsking(false)} />
          <Button label={busy ? "Removing" : "Remove"} small danger disabled={busy} testID="machine-remove-go" onPress={go} />
        </View>
      ) : null}
      {err ? <Text style={s.error} testID="machine-remove-error">{err}</Text> : null}
      <View style={s.mdanger}>
        <Button label={`${removal.word}…`} danger testID="machine-remove-open" onPress={() => setAsking(true)} />
        <Text style={s.cellSub}>Its agent computers stop and their local data is wiped. Its access ends at once.</Text>
      </View>
    </View>
  );
}

function HealthTab({ detail, m, goto, onFix, fixed }: { detail: MachineOut | null; m: MachineRow; goto: ((page: string) => void) | undefined; onFix?: ((fix: "clear_caches" | "stop_idle") => void) | undefined; fixed?: string | undefined }): ReactElement {
  const [sure, setSure] = useState(false);
  if (!detail) return <Text style={s.note}>Loading</Text>;
  if (detail.privacy === "vyre_only") return <Text style={s.empty} testID="machine-health-private">Health checks of a member's own computer stay on that computer.</Text>;
  return (
    <View testID="machine-health">
      <Block title="Doctor" count={detail.findings.filter((f) => f.state !== "healthy").length} testID="machine-doctor">
        {detail.findings.map((f) => <Row key={f.key} id={`finding-${f.key}`} title={f.detail} note={f.next} tall leading={<View style={s.lead36}><Glyph name={f.state === "healthy" ? "ok" : f.state === "down" ? "x" : "warn"} size={15} color={f.state === "healthy" ? "var(--ok)" : f.state === "down" ? "var(--danger)" : "var(--warn)"} /></View>} trailing={(f.fix === "clear_caches" || f.fix === "stop_idle") && onFix ? <Pressable accessibilityRole="button" accessibilityLabel="Fix" testID={`finding-fix-${f.fix}`} onPress={() => { if (f.fix === "stop_idle" && !sure) { setSure(true); return; } setSure(false); onFix(f.fix as "clear_caches" | "stop_idle"); }} style={[s.small, pointer]}><Text style={s.smallText}>{f.fix === "stop_idle" && sure ? "Stop them" : "Fix"}</Text></Pressable> : f.fix === "update" && goto ? <Pressable accessibilityRole="button" accessibilityLabel="Update" testID="finding-fix-update" onPress={() => goto("updates")} style={[s.small, pointer]}><Text style={s.smallText}>Update</Text></Pressable> : undefined} />)}
      </Block>
      {sure ? <Text style={s.foot} testID="machine-fix-confirm">{stopLine(detail.idleSessions ?? 0, m.kind === "space")}</Text> : null}
      {fixed || detail.lastFix ? <Text style={s.foot} testID="machine-last-fix">{fixed || detail.lastFix?.detail}</Text> : null}
      <Text style={s.foot}>The same check runs as vyre-server doctor in a terminal on this server, so it works even when the Space server is down.</Text>
      {m.kind === "space" && goto ? (
        <Block title="More checks" testID="machine-more">
          <Row id="more-logs" title="Server logs" note="Recent log lines, search and export" tall onPress={() => goto("server")} />
          <Row id="more-diag" title="Diagnostics" note="Run every check now" tall onPress={() => goto("diagnostics")} />
          <Row id="more-speed" title="Speed" note="Response times" tall onPress={() => goto("speed")} />
          <Row id="more-support" title="Support bundle" note="For a support request" tall onPress={() => goto("support")} />
        </Block>
      ) : null}
    </View>
  );
}

function UpdatesTab({ m, goto }: { m: MachineRow; goto: ((page: string) => void) | undefined }): ReactElement {
  return (
    <View testID="machine-updates">
      <Block title="Version" testID="machine-version">
        <Row id="version" title={`Vyre ${m.version ?? "unknown"}`} note={m.kind === "linked" ? "The person updates it in Settings" : "Updates are in the Console, Updates"} tall trailing={m.kind !== "linked" && goto ? <Pressable accessibilityRole="button" accessibilityLabel="Open updates" testID="machine-open-updates" onPress={() => goto("updates")} style={[s.small, pointer]}><Text style={s.smallText}>Updates</Text></Pressable> : undefined} />
      </Block>
      <Block title="Backups" testID="machine-backups">
        {m.kind === "space" && goto ? <Row id="backups" title="Backups of this Space" note="Where, how often and the last run" tall onPress={() => goto("backups")} /> : <Text style={s.empty}>The Space server holds the backups. This machine keeps only its own cache.</Text>}
      </Block>
    </View>
  );
}

// ---------------------------------------------------------------- limits, drain, pins

function Stepper({ value, onChange, label, testID }: { value: number | null; onChange(v: number | null): void; label: string; testID: string }): ReactElement {
  const steps = [1, 2, 3, 4, 6, 8, 12, 16];
  const at = value === null ? -1 : steps.indexOf(value);
  const next = (d: number): void => { const i = at + d; onChange(i < 0 ? null : i >= steps.length ? steps[steps.length - 1]! : steps[i]!); };
  return (
    <View style={s.inline} accessibilityLabel={label}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Fewer ${label}`} testID={`${testID}-less`} onPress={() => (at === -1 ? onChange(steps[steps.length - 1]!) : next(-1))} style={[s.step, pointer]}><Text style={s.smallText}>{"−"}</Text></Pressable>
      <Text style={s.stepVal} testID={`${testID}-value`}>{value === null ? "No limit" : String(value)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`More ${label}`} testID={`${testID}-more`} onPress={() => (at === steps.length - 1 ? onChange(null) : next(1))} style={[s.step, pointer]}><Text style={s.smallText}>+</Text></Pressable>
    </View>
  );
}

function Placement({ call, m, who, onChanged }: MachinesViewProps & { m: MachineRow; onChanged(): void }): ReactElement {
  const [nick, setNick] = useState(m.nickname ?? "");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const menu = useMenu();
  const pinBtn = useRef<unknown>(null);
  useEffect(() => { setNick(m.nickname ?? ""); }, [m.serverId, m.nickname]);
  const set = async (patch: Record<string, unknown>): Promise<void> => {
    setError("");
    try { await setMachine(call, m.serverId, patch); onChanged(); } catch { setError("Couldn't save that. Try again."); }
  };
  const pin = async (agentId: string, pinned: boolean): Promise<void> => {
    setError("");
    try { await pinMachine(call, m.serverId, agentId, pinned); onChanged(); } catch { setError("Couldn't pin that. Try again."); }
  };
  const mayChange = m.kind === "space" || m.mine || (m.kind === "server" && !m.owner);
  const choose = (): void => {
    const box = (pinBtn.current as { getBoundingClientRect?: () => { left: number; bottom: number } } | null)?.getBoundingClientRect?.();
    void (call("agents.list", {}) as Promise<{ agents?: { id: string; name: string }[] }>).then((out) => {
      const free = (out.agents ?? []).filter((a) => !m.pins.includes(a.id));
      menu.show(free.length ? free.map((a) => ({ label: a.name, onSelect: () => { void pin(a.id, true); } })) : [{ head: "Every agent is pinned here" }], box?.left ?? 0, (box?.bottom ?? 0) + 4, "other", { label: "Pin an agent" });
    }, () => setError("Couldn't list the agents."));
  };
  if (!mayChange) return <View />;
  return (
    <View testID="machine-placement">
      <Block title="Placement" testID="machine-limits">
        <Row id="nick" title="Nickname" note="Shown everywhere instead of the machine's own name" tall trailing={<View style={{ width: 180 }}><TextField testID="machine-nickname" accessibilityLabel="Nickname" placeholder={m.name} value={nick} onChangeText={setNick} onBlur={() => { if (nick.trim() !== (m.nickname ?? "")) void set({ nickname: nick.trim() === "" ? null : nick.trim() }); }} /></View>} />
        <Row id="turns" title="Most turns at once" note="More wait their turn or move to the next machine with room" tall trailing={<Stepper label="turns" testID="limit-turns" value={m.limits.maxTurns} onChange={(v) => { void set({ maxTurns: v }); }} />} />
        {m.kind !== "linked" ? <Row id="pcs" title="Most agent computers at once" tall trailing={<Stepper label="agent computers" testID="limit-pcs" value={m.limits.maxAgentComputers} onChange={(v) => { void set({ maxAgentComputers: v }); }} />} /> : null}
        <Row id="drain" title="Drain" note={m.drain ? "No new work lands here. What is running finishes. Pinned agents wait" : "Stop sending new work here, for an update or a move. Running work finishes"} tall
          trailing={<Pressable accessibilityRole="switch" accessibilityState={{ checked: m.drain }} accessibilityLabel="Drain" testID="machine-drain" onPress={() => { if (!m.drain && (m.runs.turns > 0 || m.runs.agentComputers > 0)) setConfirm(true); else void set({ drain: !m.drain }); }} style={[s.toggle, m.drain && s.toggleOn, pointer]}><View style={[s.knob, m.drain && s.knobOn]} /></Pressable>} />
        {confirm ? (
          <View style={s.confirm} testID="drain-confirm" accessibilityRole="alert">
            <Text style={s.confirmText}>{`Drain ${displayName(m)}? ${plural(m.runs.turns, "turn")} ${m.runs.agentComputers ? `and ${plural(m.runs.agentComputers, "agent computer")} ` : ""}keep running until they finish. New work goes to the next computer with room.`}</Text>
            <Pressable accessibilityRole="button" testID="drain-cancel" onPress={() => setConfirm(false)} style={[s.small, pointer]}><Text style={s.smallText}>Cancel</Text></Pressable>
            <Pressable accessibilityRole="button" testID="drain-yes" onPress={() => { setConfirm(false); void set({ drain: true }); }} style={[s.primary, pointer]}><Text style={s.primaryText}>Drain</Text></Pressable>
          </View>
        ) : null}
      </Block>
      {error ? <Text accessibilityRole="alert" style={s.error} testID="machine-error">{error}</Text> : null}
      <Block title="Pinned agents" note="These always run here" testID="machine-pins">
        {m.pins.map((id) => <Row key={id} id={`pin-${id}`} title={id} note={m.online ? "Always runs on this machine" : `Waits until ${displayName(m)} is back`} tall trailing={<Pressable accessibilityRole="button" accessibilityLabel={`Unpin ${id}`} testID={`unpin-${id}`} onPress={() => { void pin(id, false); }} style={[s.small, pointer]}><Text style={s.smallText}>Unpin</Text></Pressable>} />)}
        <Row id="pin-add" title="Pin an agent here" tall trailing={<Pressable ref={(r) => { pinBtn.current = r; }} accessibilityRole="button" accessibilityLabel="Choose an agent" testID="pin-choose" onPress={choose} style={[s.small, pointer]}><Text style={s.smallText}>Choose…</Text></Pressable>} />
      </Block>
      {menu.element}
    </View>
  );
}

const pointer = { cursor: "pointer" } as object;
const s = StyleSheet.create({
  page: { gap: 0 },
  note: { fontSize: 13, color: "var(--ink-3)" as string, paddingVertical: 12 },
  top: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 16, flexWrap: "wrap" },
  lead: { flex: 1, minWidth: 220, fontSize: 13.5, lineHeight: 20, color: "var(--ink-2)" as string },
  primary: { height: 30, paddingHorizontal: 12, borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "var(--ink)" as string },
  primaryText: { fontSize: 12.5, fontWeight: "500", color: "var(--win)" as string },
  small: { height: 26, paddingHorizontal: 10, borderRadius: 7, justifyContent: "center", borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--raised)" as string },
  smallText: { fontSize: 12, fontWeight: "500", color: "var(--ink)" as string },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 4 },
  tile: { flexGrow: 1, flexBasis: 200, minWidth: 160, borderRadius: 12, padding: 14, gap: 3, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  tileHead: { flexDirection: "row", alignItems: "center", gap: 7 },
  tileLabel: { fontSize: 12, fontWeight: "500", color: "var(--ink-3)" as string },
  tileBig: { fontSize: 22, fontWeight: "600", color: "var(--ink)" as string, marginTop: 4, fontVariant: ["tabular-nums"] },
  tileSub: { fontSize: 12, color: "var(--ink-3)" as string },
  block: { marginTop: 24 },
  blockHead: { flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 8, paddingHorizontal: 2 },
  blockTitle: { fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string },
  blockCount: { fontSize: 12, color: "var(--ink-3)" as string },
  blockNote: { fontSize: 12, color: "var(--ink-3)" as string },
  card: { borderRadius: 12, padding: 4, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  foot: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string, marginTop: 8, paddingHorizontal: 2 },
  empty: { fontSize: 12.5, color: "var(--ink-3)" as string, padding: 12 },
  lead36: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string, marginRight: 10 },
  num: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string, marginRight: 10 },
  numOn: { backgroundColor: "var(--accent-wash)" as string },
  numText: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  roomText: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  mrow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 9 },
  mheadRow: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  mheadText: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  mname: { flexDirection: "row", alignItems: "center", gap: 10, flexBasis: 220, flexGrow: 1, minWidth: 0 },
  ico: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string },
  ico44: { width: 44, height: 44, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string },
  mtitle: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  msub: { fontSize: 11.5, color: "var(--ink-3)" as string },
  cells: { flexDirection: "row", flexWrap: "wrap", gap: 12, flexBasis: 560, flexGrow: 3, minWidth: 0 },
  cellsNarrow: { flexBasis: "100%" as unknown as number, gap: 10 },
  cell: { flexGrow: 1, flexBasis: 90, minWidth: 80, gap: 2 },
  cellNarrow: { flexBasis: "45%" as unknown as number },
  cellLabel: { fontSize: 11, color: "var(--ink-4)" as string },
  cellMain: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string, fontVariant: ["tabular-nums"] },
  cellSub: { fontSize: 11.5, color: "var(--ink-3)" as string },
  private: { fontWeight: "400", color: "var(--ink-3)" as string },
  inline: { flexDirection: "row", alignItems: "center", gap: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  chip: { fontSize: 11.5, color: "var(--ink-2)" as string, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: "var(--sunk)" as string, overflow: "hidden" },
  chipsBig: { flexDirection: "row", flexWrap: "wrap", gap: 6, padding: 12, paddingBottom: 0 },
  chipBig: { fontSize: 12.5, color: "var(--ink-2)" as string, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 7, backgroundColor: "var(--sunk)" as string, overflow: "hidden" },
  chipNo: { color: "var(--ink-4)" as string, textDecorationLine: "line-through" },
  removeCard: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 14, padding: 12, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 10, backgroundColor: "var(--win)" as string },
  mdanger: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 18 },
  crumb: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginBottom: 10, paddingVertical: 2 },
  crumbText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  hero: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 14 },
  heroTitle: { fontSize: 17, fontWeight: "600", color: "var(--ink)" as string },
  heroSub: { fontSize: 12.5, color: "var(--ink-3)" as string, marginTop: 2 },
  tabs: { flexDirection: "row", gap: 20, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, marginBottom: 20 },
  tab: { height: 34, justifyContent: "center", borderBottomWidth: 2, borderBottomColor: "transparent", marginBottom: -1 },
  tabOn: { borderBottomColor: "var(--accent)" as string },
  tabText: { fontSize: 13.5, fontWeight: "500", color: "var(--ink-3)" as string },
  tabTextOn: { color: "var(--ink)" as string },
  mnote: { flexDirection: "row", gap: 10, alignItems: "flex-start", padding: 12, borderRadius: 10, backgroundColor: "var(--sunk)" as string, marginBottom: 16 },
  mnoteText: { flex: 1, fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string },
  spec: { flexDirection: "row", flexWrap: "wrap", borderRadius: 12, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string, marginBottom: 22 },
  specCell: { flexGrow: 1, flexBasis: 110, padding: 12, gap: 2 },
  specVal: { fontSize: 14, fontWeight: "500", color: "var(--ink)" as string, fontVariant: ["tabular-nums"] },
  rangeRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 },
  charts: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  step: { width: 26, height: 26, borderRadius: 7, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "var(--line-2)" as string },
  stepVal: { minWidth: 56, textAlign: "center", fontSize: 13, color: "var(--ink)" as string, fontVariant: ["tabular-nums"] },
  toggle: { width: 38, height: 22, borderRadius: 11, padding: 2, backgroundColor: "var(--sel-strong, #ccc)" as string, justifyContent: "center" },
  toggleOn: { backgroundColor: "var(--accent)" as string },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#fff" },
  knobOn: { alignSelf: "flex-end" },
  confirm: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 8, backgroundColor: "var(--sunk)" as string, flexWrap: "wrap" },
  confirmText: { flex: 1, minWidth: 200, fontSize: 13, color: "var(--ink)" as string },
  error: { fontSize: 13, color: "var(--danger)" as string, marginTop: 8 },
});

