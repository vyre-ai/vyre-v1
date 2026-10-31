// The real connect flows, drawn as a sheet over the page the person is on. Nothing here is a copy of a flow: an AI account is the Vault's Add an AI provider, a key or a number's Twilio account
// is the Vault's Add item with its template, a mailbox is mail.connect, a connector is connections.create. Each ends by handing the new account back to the picker that asked.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { AddProvider } from "../../places/vault/providers/index.ts";
import { AddAnything } from "../../places/vault/itemenv/index.ts";
import { VaultDataProvider } from "../../places/vault/layout/index.tsx";
import { Btn } from "../../places/vault/layout/parts.tsx";
import { Sheet } from "../../places/vault/layout/Sheet.tsx";
import { vaultData, withKeys } from "../providers/vault.tsx";
import { attemptKey } from "../providers/files-review.ts";
import type { FlowProps } from "./ConnectInline.tsx";
import { appOfNeed } from "./model.ts";
import type { Connected, ConnectNeed } from "./model.ts";

type Done = (account: Connected) => void;

export default function ConnectSheets({ rt, need, onDone, onCancel }: FlowProps): ReactElement {
  if (need.kind === "mailbox") return <MailboxSheet rt={rt} first={need.provider ?? "google"} onDone={onDone} onCancel={onCancel} />;
  if (need.kind === "connector" && need.service === "dropbox") return <DropboxSheet rt={rt} onDone={onDone} onCancel={onCancel} />;
  if (need.kind === "connector") return <ConnectorSheet rt={rt} service={need.service} onDone={onDone} onCancel={onCancel} />;
  if (need.kind === "number") return <NumberFlow rt={rt} onDone={onDone} onCancel={onCancel} />;
  return <VaultFlow rt={rt} need={need} onDone={onDone} onCancel={onCancel} />;
}

/** Twilio: its account goes to the Vault from the Twilio template, then a number is claimed: the ones already in the account come in, or one is searched and bought (the Gate holds a purchase for a yes). */
function NumberFlow({ rt, onDone, onCancel }: { rt: FlowProps["rt"]; onDone: Done; onCancel: () => void }): ReactElement {
  const [step, setStep] = useState<"vault" | "claim">("vault");
  if (step === "vault") return <VaultFlowTwilio rt={rt} onAdded={() => setStep("claim")} onCancel={onCancel} />;
  return <NumberSheet rt={rt} onDone={onDone} onCancel={onCancel} />;
}

function VaultFlowTwilio({ rt, onAdded, onCancel }: { rt: FlowProps["rt"]; onAdded(): void; onCancel(): void }): ReactElement {
  const data = useRef(vaultData(rt)).current;
  return <VaultDataProvider value={data}><AddAnything initialApp="twilio" onClose={onCancel} onAdded={() => onAdded()} /></VaultDataProvider>;
}

type NumberOut = { e164: string; numberId?: string; id?: string };

export function NumberSheet({ rt, onDone, onCancel }: { rt: FlowProps["rt"]; onDone: Done; onCancel: () => void }): ReactElement {
  const [busy, setBusy] = useState(true);
  const [line, setLine] = useState<string | null>(null);
  const [area, setArea] = useState("");
  const [found, setFound] = useState<string[] | null>(null);
  const claimed = (n: NumberOut): Connected => ({ id: String(n.numberId ?? n.id ?? n.e164), title: n.e164, app: "twilio" });
  useEffect(() => {
    let off = false;
    void Promise.resolve().then(() => rt.call("telephony.number.import", { idempotencyKey: attemptKey() })).then(
      (r) => { const list = ((r as { numbers?: NumberOut[] }).numbers ?? []); if (off) return; if (list[0]) onDone(claimed(list[0])); else setBusy(false); },
      (e) => { if (!off) { setLine(reason(e, "Twilio did not answer. Check the Account SID and Auth Token.")); setBusy(false); } },
    );
    return () => { off = true; };
  }, [rt]);
  const search = async (): Promise<void> => {
    setBusy(true); setLine(null);
    try {
      const r = (await rt.call("telephony.number.search", { country: "US", ...(area.trim() ? { areaCode: area.trim() } : {}), capabilities: ["voice", "sms"], limit: 5 })) as { available: Array<{ e164: string }> };
      setFound(r.available.map((n) => n.e164));
      if (r.available.length === 0) setLine("No numbers there. Try another area code.");
    } catch (e) { setLine(reason(e, "That did not search.")); }
    setBusy(false);
  };
  const buy = async (e164: string): Promise<void> => {
    setBusy(true); setLine(null);
    try {
      const r = (await rt.call("telephony.number.buy", { e164, title: "Main line", assigneeKind: "person", idempotencyKey: attemptKey() })) as { number?: NumberOut };
      if (r.number) { onDone(claimed(r.number)); return; }
      setLine("Waiting for your approval in Needs you.");
    } catch (e) { setLine(reason(e, "That did not buy.")); }
    setBusy(false);
  };
  const buttons: ReactElement[] = [];
  for (const n of found ?? []) buttons.push(<Btn key={n} label={`Buy ${n}`} onPress={() => void buy(n)} disabled={busy} testID={`connect-buy-${n}`} />);
  return (
    <Sheet title="Claim a number" onClose={onCancel} testID="connect-number" footer={<><Btn label="Cancel" onPress={onCancel} testID="connect-cancel" /><View style={{ flex: 1 }} /><Btn label={busy ? "Looking" : "Search"} primary disabled={busy} onPress={() => void search()} testID="connect-go" /></>}>
      <Text style={s.body} testID="connect-number-note">{busy && !found ? "Checking your Twilio account" : "No number in your Twilio account yet. Find one to buy."}</Text>
      <Field label="Area code" id="connect-area" value={area} onChange={setArea} keyboard="numeric" />
      <View style={{ gap: 8 }}>{buttons}</View>
      {line ? <Text accessibilityRole="alert" style={s.danger} testID="connect-line">{line}</Text> : null}
    </Sheet>
  );
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
  { key: "imap", label: "Other email" },
] as const;
type Provider = (typeof PROVIDERS)[number]["key"];

function reason(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** The server settings a provider's own app password works with. */
const PRESET: Record<Provider, { host: string; port: string }> = {
  google: { host: "imap.gmail.com", port: "993" }, microsoft: { host: "outlook.office365.com", port: "993" }, imap: { host: "", port: "993" },
};

/** Gmail and Outlook sign in through the Space's Google Workspace or Microsoft 365 set-up, matched to the person by address. Without it there is nothing to sign in to, so the sheet says so once and offers the app password. */
function useDelegated(rt: FlowProps["rt"], provider: Provider): "checking" | { address: string } | "none" {
  const [state, setState] = useState<"checking" | { address: string } | "none">("checking");
  useEffect(() => {
    if (provider === "imap") return undefined;
    let off = false;
    setState("checking");
    const cap = provider === "google" ? "google.dwd.my_account" : "ms.consent.my_account";
    void Promise.resolve().then(() => rt.call(cap, {})).then(
      (r) => { if (!off) { const email = (r as { email?: string } | undefined)?.email; setState(email ? { address: email } : "none"); } },
      () => { if (!off) setState("none"); },
    );
    return () => { off = true; };
  }, [rt, provider]);
  return state;
}

/** Items in "Accounts" in the person's own vault folder, made once; the mail password lives there and the mailbox keeps only its handle. */
async function mineFolder(rt: FlowProps["rt"]): Promise<string> {
  const call = withKeys(rt.call);
  const list = (await call("vault.folders.list", { scope: "mine" })) as { folders: Array<{ id: string; name: string }> };
  const have = list.folders.find((f) => f.name === "Accounts") ?? list.folders[0];
  if (have) return have.id;
  const made = (await call("vault.folders.create", { name: "Accounts", scope: "mine", idempotencyKey: attemptKey() })) as { folder: { id: string } };
  return made.folder.id;
}

function MailboxSheet({ rt, first, onDone, onCancel }: { rt: FlowProps["rt"]; first: Provider; onDone: Done; onCancel: () => void }): ReactElement {
  const [provider, setProvider] = useState<Provider>(first);
  const delegated = useDelegated(rt, provider);
  const [address, setAddress] = useState("");
  const [host, setHost] = useState(PRESET[first].host);
  const [port, setPort] = useState(PRESET[first].port);
  const [secure, setSecure] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const word = provider === "google" ? "Gmail" : "Outlook";
  const space = provider === "google" ? "Google Workspace" : "Microsoft 365";
  const pick = (p: Provider): void => { setProvider(p); setHost(PRESET[p].host); setPort(PRESET[p].port); setLine(null); };
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim());
  const imapOk = emailOk && host.trim() !== "" && Number.isInteger(Number(port)) && Number(port) > 0 && password !== "";
  const finish = (out: { mailbox: { id: string; title?: string; address: string } }): void => onDone({ id: out.mailbox.id, title: out.mailbox.title || out.mailbox.address, app: "mail" });
  const connectDelegated = async (mail: string): Promise<void> => {
    setBusy(true); setLine(null);
    try { finish((await rt.call("mail.connect", { provider, address: mail, idempotencyKey: attemptKey() })) as never); }
    catch (e) { setLine(reason(e, "That did not connect.")); setBusy(false); }
  };
  const connectImap = async (): Promise<void> => {
    setBusy(true); setLine(null);
    try {
      const folderId = await mineFolder(rt);
      const mail = address.trim();
      const name = `Mail_${mail.replace(/[^A-Za-z0-9]+/g, "_")}`;
      const item = (await withKeys(rt.call)("vault.item.put", { folderId, name, kind: "login", fields: [{ key: "password", value: password, secret: true }], idempotencyKey: attemptKey() })) as { item: { handle: string } };
      finish((await rt.call("mail.connect", {
        provider: "imap", address: mail, idempotencyKey: attemptKey(),
        imap: { host: host.trim(), port: Number(port), secure, username: (username || mail).trim(), passwordHandle: `${item.item.handle}.password` },
      })) as never);
    } catch (e) {
      const code = (e as { code?: string; error?: { code?: string } }).code ?? (e as { error?: { code?: string } }).error?.code;
      setLine(code === "provider.auth_failed" ? "The mail server did not accept that sign-in. Check the address and the app password." : reason(e, "That did not connect."));
      setBusy(false);
    }
  };
  const setup = (): void => { onCancel(); rt.open({ screen: "settings.page", args: { page: "connections" } }); };
  const chips: ReactElement[] = [];
  for (const p of PROVIDERS) {
    chips.push(
      <Pressable key={p.key} accessibilityRole="radio" accessibilityState={{ selected: provider === p.key }} accessibilityLabel={p.label} testID={`connect-${p.key}`} onPress={() => pick(p.key)} style={[s.chip, provider === p.key && s.chipOn]}>
        <Text style={[s.chipText, provider === p.key && s.chipTextOn]}>{p.label}</Text>
      </Pressable>,
    );
  }
  const ready = provider === "imap" || (typeof delegated === "object");
  const go = (): void => { if (provider === "imap") void connectImap(); else if (typeof delegated === "object") void connectDelegated(delegated.address); };
  return (
    <Sheet
      title="Connect a mailbox" onClose={onCancel} testID="connect-mailbox"
      footer={<><Btn label="Cancel" onPress={onCancel} testID="connect-cancel" /><View style={{ flex: 1 }} />{ready ? <Btn label={busy ? "Connecting" : "Connect"} primary disabled={busy || (provider === "imap" && !imapOk)} onPress={go} testID="connect-go" /> : null}</>}
    >
      <View style={s.chips} accessibilityRole="radiogroup">{chips}</View>
      {provider !== "imap" && delegated === "checking" ? <Text style={s.body} testID="connect-checking">Checking</Text> : null}
      {provider !== "imap" && typeof delegated === "object" ? <Text style={s.body} testID="connect-matched">{`${word} as ${delegated.address}`}</Text> : null}
      {provider !== "imap" && delegated === "none" ? (
        <>
          <Text style={s.body} testID="connect-unavailable">{`${word} sign-in needs ${space} set up for your Space.`}</Text>
          <View style={s.row}>
            <Btn label="Use an app password" primary onPress={() => { const from = provider; setProvider("imap"); setHost(PRESET[from].host); setPort(PRESET[from].port); setLine(null); }} testID="connect-use-imap" />
            <Pressable accessibilityRole="button" accessibilityLabel={`Set up ${space}`} testID="connect-setup" onPress={setup}><Text style={s.link}>{`Set up ${space}`}</Text></Pressable>
          </View>
        </>
      ) : null}
      {provider === "imap" ? (
        <>
          <Field label="Email address" id="connect-address" value={address} onChange={setAddress} placeholder="you@example.com" keyboard="email-address" />
          <View style={s.row}>
            <View style={{ flex: 1 }}><Field label="Server" id="connect-host" value={host} onChange={setHost} placeholder="imap.example.com" /></View>
            <View style={{ width: 80 }}><Field label="Port" id="connect-port" value={port} onChange={setPort} keyboard="numeric" /></View>
          </View>
          <Field label="Username" id="connect-username" value={username} onChange={setUsername} placeholder={address || "Same as the address"} />
          <Field label={provider === "imap" && first !== "imap" ? "App password" : "Password"} id="connect-password" value={password} onChange={setPassword} secret />
          <Pressable accessibilityRole="switch" accessibilityState={{ checked: secure }} accessibilityLabel="Secure connection" testID="connect-secure" onPress={() => setSecure(!secure)}><Text style={s.link}>{secure ? "Secure connection: on" : "Secure connection: off"}</Text></Pressable>
        </>
      ) : null}
      {line ? <Text accessibilityRole="alert" style={s.danger} testID="connect-line">{line}</Text> : null}
    </Sheet>
  );
}

function Field({ label, id, value, onChange, placeholder, keyboard, secret = false }: { label: string; id: string; value: string; onChange(v: string): void; placeholder?: string; keyboard?: "email-address" | "numeric"; secret?: boolean }): ReactElement {
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput accessibilityLabel={label} testID={id} value={value} onChangeText={onChange} {...(placeholder ? { placeholder } : {})} autoCapitalize="none" autoCorrect={false} secureTextEntry={secret} {...(keyboard ? { keyboardType: keyboard } : {})} style={s.input} />
    </View>
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
      setLine("Not done yet.");
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
      <Text style={s.body}>{started ? "Approve in the window, then come back." : "Yours alone."}</Text>
      {line ? <Text accessibilityRole="alert" style={s.danger} testID="connect-line">{line}</Text> : null}
    </Sheet>
  );
}

const s = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
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
