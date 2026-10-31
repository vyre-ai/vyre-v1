// The real connect flows, drawn as a sheet over the page the person is on. Nothing here is a copy of a flow: an AI account is the Vault's Add an AI provider, a key or a number's Twilio account
// is the Vault's Add item with its template, a mailbox is mail.connect, a connector is connections.create. Each ends by handing the new account back to the picker that asked.
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { AddProvider } from "../../places/vault/providers/index.ts";
import { AddAnything } from "../../places/vault/itemenv/index.ts";
import { VaultDataProvider } from "../../places/vault/layout/index.tsx";
import { Btn } from "../../places/vault/layout/parts.tsx";
import { Sheet } from "../../places/vault/layout/Sheet.tsx";
import { vaultData } from "../providers/vault.tsx";
import { attemptKey } from "../providers/files-review.ts";
import type { FlowProps } from "./ConnectInline.tsx";
import { appOfNeed } from "./model.ts";
import type { Connected, ConnectNeed } from "./model.ts";

type Done = (account: Connected) => void;

export default function ConnectSheets({ rt, need, onDone, onCancel }: FlowProps): ReactElement {
  if (need.kind === "mailbox") return <MailboxSheet rt={rt} onDone={onDone} onCancel={onCancel} />;
  if (need.kind === "connector" && need.service === "dropbox") return <DropboxSheet rt={rt} onDone={onDone} onCancel={onCancel} />;
  if (need.kind === "connector") return <ConnectorSheet rt={rt} service={need.service} onDone={onDone} onCancel={onCancel} />;
  return <VaultFlow rt={rt} need={need} onDone={onDone} onCancel={onCancel} />;
}

/** The Vault's own sheets, in place. An AI account waits for its Done so the person sees it was added. */
function VaultFlow({ rt, need, onDone, onCancel }: FlowProps): ReactElement {
  const data = useRef(vaultData(rt)).current;
  const added = useRef<Connected | null>(null);
  const app = appOfNeed(need);
  return (
    <VaultDataProvider value={data}>
      {need.kind === "ai" ? (
        <AddProvider
          onClose={() => { if (added.current) onDone(added.current); else onCancel(); }}
          onAdded={(p) => { added.current = { id: p.id, title: p.name, app, ...(p.handle ? { ref: p.handle } : {}) }; }}
        />
      ) : (
        <AddAnything
          initialApp={need.kind === "key" ? need.app : "twilio"}
          onClose={onCancel}
          onAdded={(itemId, name) => onDone({ id: itemId, title: name, app })}
        />
      )}
    </VaultDataProvider>
  );
}

const PROVIDERS = [
  { key: "google", label: "Gmail" },
  { key: "microsoft", label: "Outlook" },
] as const;

function reason(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

function MailboxSheet({ rt, onDone, onCancel }: { rt: FlowProps["rt"]; onDone: Done; onCancel: () => void }): ReactElement {
  const [provider, setProvider] = useState<"google" | "microsoft">("google");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim());
  const connect = async (): Promise<void> => {
    setBusy(true); setLine(null);
    try {
      const out = (await rt.call("mail.connect", { provider, address: address.trim(), idempotencyKey: attemptKey() })) as { mailbox: { id: string; title?: string; address: string } };
      onDone({ id: out.mailbox.id, title: out.mailbox.title || out.mailbox.address, app: "mail" });
    } catch (e) { setLine(reason(e, "That did not connect.")); setBusy(false); }
  };
  const other = (): void => { onCancel(); rt.open({ screen: "mail.connections", args: { kind: "imap" } }); };
  return (
    <Sheet
      title="Connect a mailbox" onClose={onCancel} testID="connect-mailbox"
      footer={<><Btn label="Cancel" onPress={onCancel} testID="connect-cancel" /><View style={{ flex: 1 }} /><Btn label={busy ? "Connecting" : "Connect"} primary disabled={busy || !ok} onPress={() => void connect()} testID="connect-go" /></>}
    >
      <View style={s.chips} accessibilityRole="radiogroup">
        {/* ui-rows-lint: not a list (two mail providers) */}
        {PROVIDERS.map((p) => (
          <Pressable key={p.key} accessibilityRole="radio" accessibilityState={{ selected: provider === p.key }} accessibilityLabel={p.label} testID={`connect-${p.key}`} onPress={() => setProvider(p.key)} style={[s.chip, provider === p.key && s.chipOn]}>
            <Text style={[s.chipText, provider === p.key && s.chipTextOn]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.label}>Your address</Text>
      <TextInput accessibilityLabel="Your address" testID="connect-address" value={address} onChangeText={setAddress} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" style={s.input} />
      {line ? <Text accessibilityRole="alert" style={s.danger} testID="connect-line">{line}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Another kind of mailbox" testID="connect-imap" onPress={other}><Text style={s.link}>Another kind of mailbox</Text></Pressable>
    </Sheet>
  );
}

function ConnectorSheet({ rt, service, onDone, onCancel }: { rt: FlowProps["rt"]; service: string; onDone: Done; onCancel: () => void }): ReactElement {
  const word = service.charAt(0).toUpperCase() + service.slice(1);
  const [made, setMade] = useState<{ id: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const start = async (): Promise<void> => {
    setBusy(true); setLine(null);
    try {
      const out = (await rt.call("connections.create", { connector: service, title: word, ownerKind: "person", idempotencyKey: attemptKey() })) as { connection: { connectionId: string; title: string; state: string }; authUrl?: string };
      const row = { id: out.connection.connectionId, title: out.connection.title || word };
      if (out.authUrl) { setMade(row); rt.openUrl(out.authUrl); setBusy(false); return; }
      onDone({ ...row, app: service });
    } catch (e) { setLine(reason(e, "That did not connect.")); setBusy(false); }
  };
  const finish = async (): Promise<void> => {
    if (!made) return;
    setBusy(true); setLine(null);
    try {
      const out = (await rt.call("connections.get", { connectionId: made.id })) as { connection: { state: string } };
      if (out.connection.state === "active") { onDone({ ...made, app: service }); return; }
      setLine("Not finished yet. Approve the sign-in, then try again.");
    } catch (e) { setLine(reason(e, "That did not check.")); }
    setBusy(false);
  };
  return (
    <Sheet
      title={`Connect ${word}`} onClose={onCancel} testID="connect-connector"
      footer={<><Btn label="Cancel" onPress={onCancel} testID="connect-cancel" /><View style={{ flex: 1 }} />{made
        ? <Btn label={busy ? "Checking" : "I have signed in"} primary disabled={busy} onPress={() => void finish()} testID="connect-signed-in" />
        : <Btn label={busy ? "Opening" : `Sign in with ${word}`} primary disabled={busy} onPress={() => void start()} testID="connect-go" />}</>}
    >
      <Text style={s.body}>{made ? "Finish signing in in the window that opened, then come back." : `Sign in to ${word} once. It stays yours.`}</Text>
      {line ? <Text accessibilityRole="alert" style={s.danger} testID="connect-line">{line}</Text> : null}
    </Sheet>
  );
}

/** Dropbox signs in through its own capabilities: start gives the address to approve at, and the callback page finishes it. The flow is done once the account shows in the list. */
function DropboxSheet({ rt, onDone, onCancel }: { rt: FlowProps["rt"]; onDone: Done; onCancel: () => void }): ReactElement {
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const start = async (): Promise<void> => {
    setBusy(true); setLine(null);
    try {
      const out = (await rt.call("dropbox.connect.start", {})) as { authUrl: string };
      rt.openUrl(out.authUrl);
      setStarted(true);
    } catch (e) { setLine(reason(e, "That did not connect.")); }
    setBusy(false);
  };
  const finish = async (): Promise<void> => {
    setBusy(true); setLine(null);
    try {
      const out = (await rt.call("dropbox.account.list", {})) as { connections: Array<{ connectionId: string; ownerKind: string; email?: string; name?: string }> };
      const mine = out.connections.filter((c) => c.ownerKind === "person").at(-1) ?? out.connections.at(-1);
      if (mine) { onDone({ id: mine.connectionId, title: mine.email ?? mine.name ?? "Dropbox", app: "dropbox" }); return; }
      setLine("Not finished yet. Approve the sign-in, then try again.");
    } catch (e) { setLine(reason(e, "That did not check.")); }
    setBusy(false);
  };
  return (
    <Sheet
      title="Connect Dropbox" onClose={onCancel} testID="connect-dropbox"
      footer={<><Btn label="Cancel" onPress={onCancel} testID="connect-cancel" /><View style={{ flex: 1 }} />{started
        ? <Btn label={busy ? "Checking" : "I have signed in"} primary disabled={busy} onPress={() => void finish()} testID="connect-signed-in" />
        : <Btn label={busy ? "Opening" : "Sign in with Dropbox"} primary disabled={busy} onPress={() => void start()} testID="connect-go" />}</>}
    >
      <Text style={s.body}>{started ? "Finish signing in in the window that opened, then come back." : "Sign in to Dropbox once. It stays yours."}</Text>
      {line ? <Text accessibilityRole="alert" style={s.danger} testID="connect-line">{line}</Text> : null}
    </Sheet>
  );
}

const s = StyleSheet.create({
  chips: { flexDirection: "row", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: "var(--line)" as string },
  chipOn: { backgroundColor: "var(--accent-wash)" as string, borderColor: "var(--accent-line)" as string },
  chipText: { fontSize: 13, color: "var(--ink-2)" as string },
  chipTextOn: { color: "var(--ink)" as string, fontWeight: "600" },
  label: { fontSize: 12, color: "var(--ink-3)" as string },
  input: { height: 36, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: "var(--line)" as string, color: "var(--ink)" as string, fontSize: 13 },
  body: { fontSize: 13, color: "var(--ink-2)" as string },
  danger: { fontSize: 12, color: "var(--danger)" as string },
  link: { fontSize: 12, color: "var(--accent)" as string },
});

export type { ConnectNeed };
