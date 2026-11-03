// Add a server, the one flow: a name, one command to paste, the server's own fingerprint to compare, Approve. It opens from Console, Machines (a server the Space holds) and from Settings, This device
// (a server only you use); the capabilities differ by scope, the sheet and the steps do not. The fingerprint is what the machine prints too, so a person approves the machine they set up and no other.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Dialog } from "../../../../ui/src/Dialog/index.tsx";
import { TextField } from "../../../../ui/src/TextField/index.tsx";
import { Glyph, SmallButton, Tip, pointer } from "../places/settings/ui.tsx";
import { addressKind, emptySheet, factsLine, joinCommand, peerServerCommand, phaseOf, validNickname } from "../places/settings/computers-model.ts";
import type { ServerInfo, Sheet } from "../places/settings/computers-model.ts";

const WHERE = "Any Linux machine or Mac that stays on. A small cloud server from Hetzner or DigitalOcean works.";
const LAN_ONLY = "Works only while the server and this computer are on the same network. Over plain http the server can run agent computers, but not your chats: those need an https address.";
const NO_ADDRESS = "This Space has no address another machine can reach. Set up Phone access (a vyre.run address) first, then add the server.";
export const POLL_MS = 2000;

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
  /** Opens Phone access (the vyre.run address). Absent until it exists: the notice then only explains. */
  onPhoneAccess?: () => void;
}

export function AddServerSheet({ sheet, servers, busy, error, now, onNickname, onMake, onApprove, onDecline, onCopy, onClose, onPhoneAccess }: AddSheetProps): ReactElement {
  const { phase, arrived } = phaseOf(sheet, servers);
  const reach = sheet.peer ? "public" : addressKind(sheet.address);
  const command = sheet.peer && sheet.code ? peerServerCommand(sheet.code) : sheet.code && sheet.address ? joinCommand(sheet.address, sheet.code) : sheet.code ? joinCommand("<this address>", sheet.code) : "";
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
          {reach === "none" || reach === "loopback" ? (
            // no address another machine can reach: no command to paste, and the way to get one
            <View style={st.notice} testID="add-no-address">
              <Tip help={NO_ADDRESS}><Glyph name="globe" size={16} color="var(--warn, #b7791f)" /></Tip>
              <Text style={st.hint}>Needs an address</Text>
              {onPhoneAccess ? <SmallButton label="Phone access" testID="add-phone-access" onPress={onPhoneAccess} /> : <Tip help={NO_ADDRESS}><Text style={st.link}>Phone access</Text></Tip>}
            </View>
          ) : (
          <View style={st.cmdRow}>
            <Text selectable testID="add-command" style={st.cmd}>{command}</Text>
            {reach === "lan" ? <Tip help={LAN_ONLY}><View testID="add-lan-warning" accessibilityLabel="Same network only"><Glyph name="globe" size={16} color="var(--warn, #b7791f)" /></View></Tip> : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Copy" testID="add-copy" onPress={() => onCopy(command)} style={[st.copy, pointer]}><Glyph name="copy" color="var(--ink-2)" /></Pressable>
          </View>
          )}
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


export const copyText = (text: string): void => { void (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard?.writeText(text); };

const st = StyleSheet.create({
  dot: { width: 9, height: 9, borderRadius: 5 },
  col: { gap: 10 },
  cmdRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  cmd: { flex: 1, padding: 10, borderRadius: 8, backgroundColor: "var(--sunk)" as string, color: "var(--ink)" as string, fontSize: 12, lineHeight: 18, ...({ fontFamily: "ui-monospace, Menlo, monospace", wordBreak: "break-all" } as object) },
  copy: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--hover)" as string },
  waitRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pulse: { width: 9, height: 9, borderRadius: 5, backgroundColor: "var(--accent)" as string },
  hint: { fontSize: 12.5, color: "var(--ink-3)" as string },
  notice: { flexDirection: "row", alignItems: "center", gap: 8 },
  link: { fontSize: 12.5, color: "var(--accent)" as string },
  name: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  facts: { fontSize: 12.5, color: "var(--ink-3)" as string },
  print: { fontSize: 26, letterSpacing: 2, color: "var(--ink)" as string, ...({ fontFamily: "ui-monospace, Menlo, monospace" } as object) },
  error: { color: "var(--danger)" as string, fontSize: 13 },
});


export type AddScope = "space" | "mine";
export interface AddServerState { sheet: Sheet | null; busy: boolean; error: string; now: number; open(): void; close(): void; setNickname(v: string): void; make(): void; approve(id: string): void; decline(id: string): void }

/**
 * The state of the Add a server sheet and the calls behind it. `scope` picks the capabilities: a server the Space holds (an admin: network.server_join_code and server_approve) or a server only the
 * asker uses (network.my_computer_code and my_computer_approve, or the relay's one-time code in a Personal Space). `servers` is what the page knows, so the waiting machine's fingerprint shows
 * the moment it arrives; `reload` refreshes it.
 */
export function useAddServer(o: { call(cap: string, input: Record<string, unknown>): Promise<unknown>; scope: AddScope; personal: boolean; reload(): void | Promise<void>; startOpen?: boolean; clock?: () => number }): AddServerState {
  const { call, scope, personal, reload } = o;
  const [sheet, setSheet] = useState<Sheet | null>(() => (o.startOpen ? emptySheet() : null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => (o.clock ?? Date.now)());
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    if (!sheet?.code || sheet.approved) return undefined;
    const t = setInterval(() => { setNow((o.clock ?? Date.now)()); void reload(); }, POLL_MS);
    return () => clearInterval(t);
  }, [sheet?.code, sheet?.approved, reload, o.clock]);
  const guarded = useCallback(async (run: () => Promise<void>, fail: string): Promise<void> => {
    setBusy(true); setError("");
    try { await run(); } catch { if (alive.current) setError(fail); } finally { if (alive.current) setBusy(false); }
  }, []);
  const key = (): string => `add-${Math.random().toString(36).slice(2)}`;
  const make = (): void => void guarded(async () => {
    const nick = sheet!.nickname.trim();
    if (scope === "mine" && personal) {
      const got = await call("network.peer_server_code", { idempotencyKey: key(), nickname: nick }) as { code: string; expiresAt: number };
      setSheet((s) => s && { ...s, nickname: nick, code: got.code, expiresAt: got.expiresAt, address: null, peer: true });
      return;
    }
    const made = await call(scope === "space" ? "network.server_join_code" : "network.my_computer_code", { idempotencyKey: key(), ...(scope === "mine" || nick ? { nickname: nick } : {}) }) as { code: string; expiresAt: number; address?: string };
    setSheet((s) => s && { ...s, nickname: nick, code: made.code, expiresAt: made.expiresAt, address: made.address ?? null });
  }, "Couldn't make a command. Try again.");
  const approve = (serverId: string): void => void guarded(async () => { await call(scope === "space" ? "network.server_approve" : "network.my_computer_approve", { serverId }); setSheet((s) => s && { ...s, approved: true, serverId }); await reload(); }, "Couldn't approve it. Try again.");
  const decline = (serverId: string): void => void guarded(async () => { await call(scope === "space" ? "network.server_decline" : "network.my_computer_decline", { serverId }); setSheet(null); await reload(); }, "Couldn't decline it.");
  return { sheet, busy, error, now, open: () => { setError(""); setSheet(emptySheet()); }, close: () => { setSheet(null); void reload(); }, setNickname: (v) => setSheet((s) => s && { ...s, nickname: v }), make, approve, decline };
}
