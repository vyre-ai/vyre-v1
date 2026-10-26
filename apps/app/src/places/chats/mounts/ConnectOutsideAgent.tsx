// Connect an outside agent (spec 3.2 Flow 9, registry screen chats.connect-outside-agent): from a channel's menu, a sheet that lets Claude Code, Codex or any MCP client join the channel
// and work in its own threads. Pick the tool and what it may do; Create connection calls channels.connect_outside_agent, which answers with the MCP address, a one-time token (it
// works once and expires in ten minutes, so it is shown only here) and the command to run where the tool lives. The token stays masked until Reveal; Copy puts the address,
// the token or the command on the clipboard. Reading Vault values is never offered: agents see handles, not values.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ScreenHooks } from "../../../../../../client/src/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import { Icon, TextButton } from "../rightpane/parts.tsx";
import { LayerHead, Sheet } from "./Layers.tsx";
import { errorWords, useLive } from "./live.ts";

export const CONNECT_SCREEN = "chats.connect-outside-agent";

type ChannelOut = CapMap["channels.get"]["out"];
type ConnectIn = CapMap["channels.connect_outside_agent"]["in"];
type ConnectOut = CapMap["channels.connect_outside_agent"]["out"];
type Scopes = NonNullable<ConnectIn["scopes"]>;

export type Kind = "claude" | "codex" | "other";
export const KINDS: readonly { key: Kind; label: string; name: string }[] = [
  { key: "claude", label: "Claude Code", name: "Claude Code" },
  { key: "codex", label: "Codex", name: "Codex" },
  { key: "other", label: "Other MCP client", name: "Outside agent" },
];

export const DEFAULT_SCOPES: Scopes = { read: true, post: true, readChangesets: true, writeBranch: false };

export interface ScopeRow { key: keyof Scopes | "vault"; title: string; sub: (channel: string) => string; lock: "on" | "off" | "free" }
export const SCOPE_ROWS: readonly ScopeRow[] = [
  { key: "read", title: "Read the channel it joins", sub: (c) => `Messages and threads in #${c}`, lock: "on" },
  { key: "post", title: "Post and reply in threads", sub: () => "Always in its own thread", lock: "on" },
  { key: "readChangesets", title: "Read files in changesets it reviews", sub: () => "Never anything outside them", lock: "on" },
  { key: "writeBranch", title: "Change files on a branch", sub: () => "A person approves before anything merges", lock: "free" },
  { key: "vault", title: "Use Vault values", sub: () => "Never. Agents see handles, not values.", lock: "off" },
];

/** The token as the sheet shows it until Reveal: the prefix and dots. */
export function maskToken(token: string): string {
  const m = /^([a-z]+_[a-z]+_)/.exec(token);
  return `${m ? m[1] : ""}${"•".repeat(24)}`;
}

/** The command with the token hidden, until Reveal. */
export function maskCommand(command: string, token: string): string {
  return command.split(token).join(maskToken(token));
}

export function minutesLeft(now: number, expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 60_000));
}

/** The connection for one tool: channels.connect_outside_agent answers with the address, the one-time token and the command. Asking again with the same key and choices gives the same answer. */
export function createConnection(call: ConnectProps["call"], o: { channelId: string; kind: Kind; scopes: Scopes; key: string }): Promise<ConnectOut> {
  const name = (KINDS.find((k) => k.key === o.kind) ?? KINDS[0]!).name;
  const input: ConnectIn = { channelId: o.channelId, name, scopes: o.scopes, idempotencyKey: `${o.key}:${o.kind}:${o.scopes.writeBranch ? "w" : "r"}` };
  return call("channels.connect_outside_agent", input).then((out) => out as ConnectOut);
}

const writeClipboard = (text: string): boolean => {
  const clip = (globalThis as { navigator?: { clipboard?: { writeText(t: string): unknown } } }).navigator?.clipboard;
  if (!clip) return false;
  void clip.writeText(text);
  return true;
};

export interface ConnectProps {
  screens: ScreenHooks;
  call(cap: string, input: unknown): Promise<unknown>;
  newKey(): string;
  clock(): { now: number };
  channelId: string;
  onClose: () => void;
  /** A line the app shows for a moment ("Copied the address"). */
  say?: (text: string) => void;
}

export function ConnectOutsideAgent({ screens, call, newKey, clock, channelId, onClose, say }: ConnectProps): ReactElement {
  const ch = useLive<ChannelOut>(screens, CONNECT_SCREEN, "channel", { channelId });
  const channel = ch.status === "ready" ? ch.data.channel.name : "this channel";
  const [kind, setKind] = useState<Kind>("claude");
  const [scopes, setScopes] = useState<Scopes>(DEFAULT_SCOPES);
  const [made, setMade] = useState<ConnectOut | null>(null);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [key] = useState(newKey);
  useEffect(() => {
    if (line === null) return undefined;
    const t = setTimeout(() => setLine(null), 2500);
    return () => clearTimeout(t);
  }, [line]);

  const flip = (k: keyof Scopes): void => setScopes((s) => ({ ...s, [k]: !s[k] }));
  const create = (): void => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    void createConnection(call, { channelId, kind, scopes, key }).then(
      (out) => { setMade(out); setBusy(false); },
      (e: unknown) => { setProblem(errorWords(e, "Could not create the connection.")); setBusy(false); },
    );
  };
  const copy = (what: string, text: string): void => {
    const ok = writeClipboard(text);
    const words = ok ? `Copied the ${what}` : `Could not copy the ${what}`;
    setLine(words);
    say?.(words);
  };

  const kinds: ReactElement[] = [];
  for (const k of KINDS) {
    const on = k.key === kind;
    kinds.push(
      <Pressable key={k.key} role="radio" aria-checked={on} aria-label={k.label} disabled={made !== null} onPress={() => setKind(k.key)} testID={`connect-kind-${k.key}`} style={({ hovered }: { hovered?: boolean }) => [st.seg, on && st.segOn, !on && hovered === true && st.segOver]}>
        <Text style={[st.segText, on && st.segTextOn]}>{k.label}</Text>
      </Pressable>,
    );
  }
  const rows: ReactElement[] = [];
  for (const r of SCOPE_ROWS) {
    const on = r.key === "vault" ? false : r.lock === "on" ? true : scopes[r.key];
    const free = r.lock === "free" && made === null;
    rows.push(
      <Pressable
        key={r.key} role="checkbox" aria-checked={on} aria-label={r.title} aria-disabled={!free} disabled={!free}
        onPress={() => { if (r.key !== "vault" && r.lock === "free") flip(r.key); }}
        testID={`connect-scope-${r.key}`} style={({ hovered }: { hovered?: boolean }) => [st.scope, free && hovered === true && st.scopeOver]}
      >
        <View style={[st.check, on && st.checkOn, !free && on && st.checkLocked]}>{on ? <Icon name="check" size={11} color="var(--accent-ink)" width={1.8} /> : null}</View>
        <View style={st.scopeText}>
          <Text style={[st.scopeTitle, r.lock === "off" && st.dim]}>{r.title}</Text>
          <Text style={st.scopeSub}>{r.sub(channel)}</Text>
        </View>
      </Pressable>,
    );
  }

  const tokenShown = made ? (reveal ? made.oneTimeToken : maskToken(made.oneTimeToken)) : "";
  const commandShown = made ? (reveal ? made.runCommand : maskCommand(made.runCommand, made.oneTimeToken)) : "";
  const left = made ? minutesLeft(clock().now, made.expiresAt) : 0;

  return (
    <Sheet label="Connect an outside agent" testID="connect-outside-agent" width={480} onClose={onClose}>
      <LayerHead
        title="Connect an outside agent" sub={`Claude Code or Codex joins #${channel} and works in its own threads.`}
        lead={<View style={st.tile}><Icon name="terminal" size={16} color="var(--ink-2)" /></View>} onClose={onClose}
      />
      <View style={st.body}>
        <View role="radiogroup" aria-label="Agent" testID="connect-kinds" style={st.segs}>{kinds}</View>
        {made ? (
          <View testID="connect-made" style={st.made}>
            <Text style={st.label}>MCP address</Text>
            <View style={st.kv}>
              <Text selectable numberOfLines={1} testID="connect-address" style={st.code}>{made.mcpUrl}</Text>
              <TextButton label="Copy" onPress={() => copy("address", made.mcpUrl)} testID="connect-copy-address" />
            </View>
            <Text style={st.label}>One-time token</Text>
            <View style={st.kv}>
              <Text selectable numberOfLines={1} testID="connect-token" style={st.code}>{tokenShown}</Text>
              <TextButton label={reveal ? "Hide" : "Reveal"} onPress={() => setReveal((v) => !v)} testID="connect-reveal" />
              <TextButton label="Copy" onPress={() => copy("token", made.oneTimeToken)} testID="connect-copy-token" />
            </View>
            <Text style={st.help}>{`It works once and expires in ${left} ${left === 1 ? "minute" : "minutes"}. Creating it is logged under your name.`}</Text>
            <Text style={st.label}>Or run this where it lives</Text>
            <View style={st.kv}>
              <Text selectable numberOfLines={2} testID="connect-command" style={st.code}>{commandShown}</Text>
              <TextButton label="Copy" onPress={() => copy("command", made.runCommand)} testID="connect-copy-command" />
            </View>
          </View>
        ) : null}
        <Text style={st.label}>What it can do</Text>
        <View testID="connect-scopes" style={st.scopes}>{rows}</View>
        {problem ? <Text testID="connect-problem" accessibilityRole="alert" style={st.problem}>{problem}</Text> : null}
      </View>
      <View style={st.foot}>
        <Text testID="connect-status" accessibilityLiveRegion="polite" style={st.status}>{line ?? (made ? "Waiting for it to connect…" : "")}</Text>
        <View style={{ flex: 1 }} />
        <TextButton label={made ? "Close" : "Cancel"} onPress={onClose} testID="connect-cancel" />
        {made ? null : <TextButton label={busy ? "Creating…" : "Create connection"} primary disabled={busy} onPress={create} testID="connect-create" />}
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  tile: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string },
  body: { paddingHorizontal: 14, gap: 8 },
  segs: { flexDirection: "row", gap: 2, padding: 2, borderRadius: 9, backgroundColor: "var(--sunk)" as string, alignSelf: "flex-start" },
  seg: { height: 26, paddingHorizontal: 12, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  segOn: { backgroundColor: "var(--win)" as string, boxShadow: "var(--sh-card, 0 1px 2px rgba(0,0,0,.12))" as string },
  segOver: { backgroundColor: "var(--hover)" as string },
  segText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  segTextOn: { color: "var(--ink)" as string, fontWeight: "500" },
  made: { gap: 6 },
  label: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string, marginTop: 6 },
  kv: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 10, paddingRight: 4, minHeight: 34, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  code: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 17, color: "var(--ink)" as string, fontFamily: "var(--mono, ui-monospace, Menlo, monospace)" as string, paddingVertical: 7 },
  help: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
  scopes: { gap: 2 },
  scope: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingHorizontal: 8, paddingVertical: 7, borderRadius: 8 },
  scopeOver: { backgroundColor: "var(--hover)" as string },
  scopeText: { flex: 1, minWidth: 0 },
  scopeTitle: { fontSize: 13, color: "var(--ink)" as string },
  scopeSub: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
  dim: { color: "var(--ink-3)" as string },
  check: { width: 16, height: 16, marginTop: 1, borderRadius: 5, borderWidth: 1.5, borderColor: "var(--line-2)" as string, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: "var(--accent)" as string, borderColor: "var(--accent)" as string },
  checkLocked: { opacity: 0.55 },
  problem: { fontSize: 12.5, color: "var(--danger)" as string },
  foot: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 12 },
  status: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
