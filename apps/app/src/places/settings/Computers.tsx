// Settings > Computers: this computer and the servers you added, each with an online dot and what runs on it, and the Add a server sheet (name it, paste one command, compare the fingerprint,
// approve). Nothing here tells a person what they cannot do: a server that cannot run an agent computer says so in a tooltip, and agent computers appear elsewhere only once one can run.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Dialog } from "../../../../../ui/src/Dialog/index.tsx";
import { TextField } from "../../../../../ui/src/TextField/index.tsx";
import { setComputersAvailable } from "../../shell/computers-available.ts";
import { useSettingsData } from "./data.tsx";
import { emptySheet, factsLine, joinCommand, phaseOf, runsLine, validNickname } from "./computers-model.ts";
import type { HostInfo, ServerInfo, Sheet } from "./computers-model.ts";
import { Glyph, Section, SettingsRow, SmallButton, Tip, pointer } from "./ui.tsx";
import { PhoneAccessSection } from "./PhoneAccess.tsx";

const WHERE = "Any Linux machine or Mac that stays on. A small cloud server from Hetzner or DigitalOcean works.";
const POLL_MS = 2000;

export function Dot({ on, why }: { on: boolean; why?: string }): ReactElement {
  return (
    <Tip help={why}><View accessibilityLabel={on ? "Online" : "Offline"} testID={on ? "dot-on" : "dot-off"} style={[st.dot, { backgroundColor: (on ? "var(--ok, #2f9e5b)" : "var(--ink-4)") as string }]} /></Tip>
  );
}

export interface ComputersBodyProps {
  hosts: readonly HostInfo[];
  servers: readonly ServerInfo[];
  removing: string | null;
  onAdd(): void;
  onAskRemove(serverId: string | null): void;
  onRemove(serverId: string): void;
}

/** The list: This computer first, then each server by its nickname. Waiting servers are not listed here; the sheet that made them handles them. */
export function ComputersBody({ hosts, servers, removing, onAdd, onAskRemove, onRemove }: ComputersBodyProps): ReactElement {
  const here = hosts.find((h) => h.kind === "this");
  const rows: ReactElement[] = [];
  rows.push(
    <SettingsRow
      key="this" id="computer.this" first label="This computer" lead={<Dot on />} {...(here && runsLine(here) ? { sub: runsLine(here) } : {})}
      {...(here && !here.canRun ? { help: "Agent computers need Docker here, or a server." } : {})}
      control={here?.canRun ? <Glyph name="check" color="var(--ok, #2f9e5b)" /> : undefined}
    />,
  );
  servers.filter((s) => s.enrollment === "approved").forEach((s) => {
    const h = hosts.find((x) => x.hostId === s.serverId);
    const online = s.state !== "down";
    const sure = removing === s.serverId;
    rows.push(
      <SettingsRow
        key={s.serverId} id={`computer.${s.serverId}`} label={s.name} lead={<Dot on={online} why={online ? undefined : "Offline"} />}
        sub={[factsLine(s.facts), h ? runsLine(h) : ""].filter(Boolean).join(" · ")}
        {...(h?.reason && !h.canRun ? { help: h.reason } : {})}
        control={sure ? (
          <>
            <SmallButton label="Cancel" onPress={() => onAskRemove(null)} />
            <SmallButton label="Remove" danger testID={`remove-yes-${s.serverId}`} onPress={() => onRemove(s.serverId)} />
          </>
        ) : <SmallButton label="Remove" testID={`remove-${s.serverId}`} onPress={() => onAskRemove(s.serverId)} />}
      />,
    );
  });
  rows.push(<SettingsRow key="add" id="computer.add" label="Add a server" lead={<Glyph name="plus" />} control={<SmallButton label="Add" testID="computer-add" onPress={onAdd} />} help={WHERE} />);
  return <Section title="Computers" testID="computers-list">{rows}</Section>;
}

export interface AddSheetProps {
  sheet: Sheet;
  servers: readonly ServerInfo[];
  busy: boolean;
  error: string;
  now: number;
  onNickname(v: string): void;
  onMake(): void;
  onApprove(serverId: string): void;
  onDecline(serverId: string): void;
  onCopy(text: string): void;
  onClose(): void;
}

export function AddServerSheet({ sheet, servers, busy, error, now, onNickname, onMake, onApprove, onDecline, onCopy, onClose }: AddSheetProps): ReactElement {
  const { phase, arrived } = phaseOf(sheet, servers);
  const command = sheet.code && sheet.address ? joinCommand(sheet.address, sheet.code) : sheet.code ? joinCommand("<this address>", sheet.code) : "";
  const left = sheet.expiresAt ? Math.max(0, Math.ceil((sheet.expiresAt - now) / 60000)) : 0;
  const actions = phase === "name"
    ? [{ label: "Cancel", testID: "add-cancel", onPress: onClose }, { label: busy ? "Making" : "Get command", testID: "add-make", primary: true, disabled: busy || !validNickname(sheet.nickname), onPress: onMake }]
    : phase === "waiting" ? [{ label: "Cancel", testID: "add-cancel", onPress: onClose }]
    : phase === "compare" && arrived ? [{ label: "Decline", testID: "add-decline", onPress: () => onDecline(arrived.serverId) }, { label: busy ? "Approving" : "Approve", testID: "add-approve", primary: true, disabled: busy, onPress: () => onApprove(arrived.serverId) }]
    : [{ label: "Done", testID: "add-done", primary: true, onPress: onClose }];
  return (
    <Dialog title="Add a server" testID="add-server-sheet" width={520} onClose={onClose} actions={actions}>
      {error ? <Text accessibilityRole="alert" testID="add-error" style={st.error}>{error}</Text> : null}
      {phase === "name" ? (
        <View style={st.col}>
          <TextField testID="add-nickname" accessibilityLabel="Name" placeholder="home-box" value={sheet.nickname} onChangeText={onNickname} />
        </View>
      ) : null}
      {phase === "waiting" ? (
        <View style={st.col}>
          <View style={st.cmdRow}>
            <Text selectable testID="add-command" style={st.cmd}>{command}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Copy" testID="add-copy" onPress={() => onCopy(command)} style={[st.copy, pointer]}><Glyph name="copy" color="var(--ink-2)" /></Pressable>
          </View>
          <View style={st.waitRow}>
            <View testID="add-waiting" accessibilityRole="progressbar" accessibilityLabel="Waiting" style={st.pulse} />
            <Tip help={WHERE}><Text style={st.hint}>{left > 0 ? `${left} min` : "Expired"}</Text></Tip>
            <Tip help={WHERE}><Glyph name="globe" size={14} /></Tip>
          </View>
        </View>
      ) : null}
      {phase === "compare" && arrived ? (
        <View style={st.col} testID="add-compare">
          <Text style={st.name}>{arrived.name}</Text>
          <Text style={st.facts}>{factsLine(arrived.facts)}</Text>
          <Text selectable testID="add-fingerprint" accessibilityLabel="Fingerprint" style={st.print}>{arrived.fingerprint ?? ""}</Text>
        </View>
      ) : null}
      {phase === "done" ? (
        <View style={st.col}>
          <View style={st.waitRow}><Glyph name="check" color="var(--ok, #2f9e5b)" /><Text testID="add-added" style={st.name}>{arrived?.name ?? sheet.nickname}</Text></View>
        </View>
      ) : null}
    </Dialog>
  );
}

const copyText = (text: string): void => { void (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard?.writeText(text); };

/** The Computers section with its live data: the list refreshes after every change and, while the sheet waits, every two seconds. */
export function ComputersSection(): ReactElement {
  const data = useSettingsData();
  const [hosts, setHosts] = useState<HostInfo[]>([]);
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => data.clock().now);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [h, m] = await Promise.all([
        data.call("computers.hosts", {}) as Promise<{ hosts: HostInfo[] }>,
        data.call("network.my_computers", {}) as Promise<{ computers: ServerInfo[] }>,
      ]);
      if (alive.current) { setHosts(h.hosts); setServers(m.computers); }
      // agent computers appear elsewhere the moment a host can run one, and go when none can
      setComputersAvailable(data.space.id, (h as { available?: boolean }).available === true);
    } catch { /* the lists stay as they were */ }
  }, [data]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!sheet?.code || sheet.approved) return undefined;
    const t = setInterval(() => { setNow(Date.now()); void load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [sheet?.code, sheet?.approved, load]);

  const guarded = async (run: () => Promise<void>, fail: string): Promise<void> => {
    setBusy(true); setError("");
    try { await run(); } catch { if (alive.current) setError(fail); } finally { if (alive.current) setBusy(false); }
  };
  const make = (): Promise<void> => guarded(async () => {
    const made = await data.call("network.my_computer_code", { idempotencyKey: `add-${Math.random().toString(36).slice(2)}`, nickname: sheet!.nickname.trim() }) as { code: string; expiresAt: number; address?: string };
    setSheet((s) => s && { ...s, nickname: s.nickname.trim(), code: made.code, expiresAt: made.expiresAt, address: made.address ?? null });
  }, "Couldn't make a command. Try again.");
  const approve = (serverId: string): Promise<void> => guarded(async () => {
    await data.call("network.my_computer_approve", { serverId });
    setSheet((s) => s && { ...s, approved: true, serverId });
    await load();
  }, "Couldn't approve it. Try again.");
  const decline = (serverId: string): Promise<void> => guarded(async () => { await data.call("network.my_computer_decline", { serverId }); setSheet(null); await load(); }, "Couldn't decline it.");
  const remove = (serverId: string): Promise<void> => guarded(async () => { await data.call("network.my_computer_remove", { serverId }); setRemoving(null); await load(); }, "Couldn't remove it.");

  return (
    <>
      <ComputersBody hosts={hosts} servers={servers} removing={removing} onAdd={() => { setError(""); setSheet(emptySheet()); }} onAskRemove={setRemoving} onRemove={(id) => void remove(id)} />
      <PhoneAccessSection />
      {sheet ? (
        <AddServerSheet
          sheet={sheet} servers={servers} busy={busy} error={error} now={now}
          onNickname={(v) => setSheet((s) => s && { ...s, nickname: v })} onMake={() => void make()} onApprove={(id) => void approve(id)} onDecline={(id) => void decline(id)}
          onCopy={copyText} onClose={() => { setSheet(null); void load(); }}
        />
      ) : null}
    </>
  );
}

const st = StyleSheet.create({
  dot: { width: 9, height: 9, borderRadius: 5 },
  col: { gap: 10 },
  cmdRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  cmd: { flex: 1, padding: 10, borderRadius: 8, backgroundColor: "var(--sunk)" as string, color: "var(--ink)" as string, fontSize: 12, lineHeight: 18, ...({ fontFamily: "ui-monospace, Menlo, monospace", wordBreak: "break-all" } as object) },
  copy: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--hover)" as string },
  waitRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pulse: { width: 9, height: 9, borderRadius: 5, backgroundColor: "var(--accent)" as string },
  hint: { fontSize: 12.5, color: "var(--ink-3)" as string },
  name: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  facts: { fontSize: 12.5, color: "var(--ink-3)" as string },
  print: { fontSize: 26, letterSpacing: 2, color: "var(--ink)" as string, ...({ fontFamily: "ui-monospace, Menlo, monospace" } as object) },
  error: { color: "var(--danger)" as string, fontSize: 13 },
});
