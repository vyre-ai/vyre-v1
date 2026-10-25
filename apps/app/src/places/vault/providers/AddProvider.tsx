// Add an AI provider (spec 3.8): a gallery of providers from their definition files (name, logo, how they connect). A subscription opens its own sign-in and waits for you to finish it;
// an API key is pasted once and never shown again; a local model asks for an address and tests it. Each step is one capability call. Nothing is added until the last step succeeds.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useVaultData } from "../layout/data.tsx";
import type { Provider } from "../layout/model.ts";
import { Btn, Glyph, LogoTile, Mono } from "../layout/parts.tsx";
import { Sheet } from "../layout/Sheet.tsx";
import { CONNECTION_NAME, CONNECTION_NOTE, connectionList, normalizeAddress, testWords } from "./model.ts";
import type { Catalog, ConnectionKind } from "./model.ts";

export interface AddProviderProps {
  onClose(): void;
  onAdded(provider: Provider): void;
  /** The gallery's own pick at first render (the screenshot mounts and tests). */
  initial?: { providerKey: string; connection: ConnectionKind };
}

type Flow = { id: string; instruction: string; url?: string; userCode?: string };
const DEFAULT_ADDRESS = "http://localhost:11434";

export function AddProvider({ onClose, onAdded, initial }: AddProviderProps): ReactElement {
  const data = useVaultData();
  const { element, show } = useMenu();
  const [catalog, setCatalog] = useState<readonly Catalog[] | null>(null);
  const [pick, setPick] = useState<Catalog | null>(null);
  const [kind, setKind] = useState<ConnectionKind | null>(initial?.connection ?? null);
  const [scope, setScope] = useState<"mine" | "shared">("mine");
  const [secret, setSecret] = useState("");
  const [address, setAddress] = useState(DEFAULT_ADDRESS);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [added, setAdded] = useState<Provider | null>(null);
  const n = useRef(0);
  const first = useRef(initial);

  useEffect(() => {
    let live = true;
    void (data.call("providers.catalog", {}) as Promise<{ providers: Catalog[] }>)
      .then((out) => { if (!live) return; setCatalog(out.providers); const want = first.current; if (want) setPick(out.providers.find((c) => c.key === want.providerKey) ?? null); })
      .catch((e: unknown) => { if (live) { setCatalog([]); setLine(e instanceof Error ? e.message : "The providers did not load."); } });
    return () => { live = false; };
  }, [data]);

  const choose = (c: Catalog): void => { setPick(c); setKind(c.connections.length === 1 ? c.connections[0]! : null); setLine(null); };
  const back = (): void => { if (kind && pick && pick.connections.length > 1) { setKind(null); } else { setPick(null); setKind(null); } setFlow(null); setSecret(""); setLine(null); };
  const done = (p: Provider): void => { setSecret(""); setAdded(p); onAdded(p); };
  const run = async (f: () => Promise<void>): Promise<void> => {
    setBusy(true); setLine(null);
    try { await f(); } catch (e) { setLine(e instanceof Error ? e.message : "That did not work."); }
    setBusy(false);
  };
  const key = (what: string): string => `add-${what}-${++n.current}-${data.clock().now}`;

  const startSignIn = (): Promise<void> => run(async () => {
    const out = (await data.call("providers.subscription_start", { providerKey: pick!.key, idempotencyKey: key(pick!.key) })) as { flowId: string; instruction: string; url?: string; userCode?: string };
    setFlow({ id: out.flowId, instruction: out.instruction, ...(out.url ? { url: out.url } : {}), ...(out.userCode ? { userCode: out.userCode } : {}) });
  });
  const finishSignIn = (): Promise<void> => run(async () => {
    const out = (await data.call("providers.subscription_complete", { flowId: flow!.id })) as { provider: Provider };
    done(out.provider);
  });
  const addKey = (): Promise<void> => run(async () => {
    const out = (await data.call("providers.add", { providerKey: pick!.key, connection: "api_key", apiKey: secret.trim(), scope, idempotencyKey: key(pick!.key) })) as { provider: Provider };
    done(out.provider);
  });
  const addLocal = (): Promise<void> => run(async () => {
    const url = normalizeAddress(address);
    if (!url) { setLine("That does not look like an address. Try http://localhost:11434."); return; }
    const out = (await data.call("providers.add", { providerKey: pick!.key, connection: "local_model", address: url, scope: "mine", idempotencyKey: key(pick!.key) })) as { provider: Provider };
    const t = (await data.call("providers.test", { providerId: out.provider.id })) as { ok: boolean; models: string[]; latencyMs: number; detail?: string };
    setLine(testWords(t));
    done(out.provider);
  });

  const scopeMenu = (e: unknown): void => {
    const ev = e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } };
    const r = ev.currentTarget?.getBoundingClientRect?.();
    show([{ head: "Belongs to" }, { label: "Mine", checked: scope === "mine", onSelect: () => setScope("mine") }, { label: "Shared with the Space", checked: scope === "shared", onSelect: () => setScope("shared") }], r?.left ?? 0, (r?.bottom ?? 0) + 4, "other");
  };

  const title = added ? `Added ${added.name}` : pick ? `Add ${pick.name}` : "Add an AI provider";
  const footer = (
    <>
      {pick && !added ? <Btn label="Back" onPress={back} testID="provider-back" /> : null}
      <View style={{ flex: 1 }} />
      {added ? <Btn label="Done" primary onPress={onClose} testID="provider-done" /> : <Btn label="Cancel" onPress={onClose} testID="provider-cancel" />}
      {!added && pick && kind === "api_key" ? <Btn label={busy ? "Adding" : "Add"} primary disabled={busy || secret.trim().length === 0} onPress={() => void addKey()} testID="provider-add" /> : null}
      {!added && pick && kind === "local_model" ? <Btn label={busy ? "Testing" : "Add and test"} primary disabled={busy} onPress={() => void addLocal()} testID="provider-add-local" /> : null}
      {!added && pick && kind === "subscription" ? (flow ? <Btn label={busy ? "Checking" : "I have signed in"} primary disabled={busy} onPress={() => void finishSignIn()} testID="provider-signed-in" /> : <Btn label={busy ? "Opening" : "Sign in"} primary disabled={busy} onPress={() => void startSignIn()} testID="provider-signin" />) : null}
    </>
  );

  return (
    <Sheet title={title} onClose={onClose} footer={footer} testID="add-provider">
      {added ? (
        <View style={s.stack}>
          <Text style={s.lead} testID="provider-added">{`${added.name} is connected. ${added.scope === "mine" ? "It is yours." : "It is shared."}`}</Text>
          {line ? <Text style={s.quiet} testID="provider-line">{line}</Text> : null}
        </View>
      ) : !pick ? (
        <View testID="provider-gallery" accessibilityLabel="Providers">
          {catalog === null ? <Text style={s.quiet} testID="provider-loading">Loading</Text> : catalog.map((c) => (
            <Row key={c.key} id={`cat:${c.key}`} title={c.name} note={connectionList(c)} leading={<View style={s.logo}><LogoTile name={c.name} size={30} /></View>} onPress={() => choose(c)} />
          ))}
          {catalog !== null && catalog.length === 0 ? <Text style={s.quiet}>There are no providers to add.</Text> : null}
        </View>
      ) : kind === null ? (
        <View testID="provider-kinds" accessibilityLabel="How to connect">
          {pick.connections.map((k) => <Row key={k} id={`kind:${k}`} title={CONNECTION_NAME[k]} note={CONNECTION_NOTE[k]} tall leading={<View style={s.logo}><LogoTile name={pick.name} size={30} /></View>} onPress={() => setKind(k)} />)}
        </View>
      ) : kind === "subscription" ? (
        <View style={s.stack} testID="provider-subscription">
          <Text style={s.lead}>{CONNECTION_NOTE.subscription}</Text>
          {flow ? (
            <View style={s.stack}>
              <Text style={s.body} testID="provider-instruction">{flow.instruction}</Text>
              {flow.userCode ? <View style={s.code}><Mono size={20}>{flow.userCode}</Mono></View> : null}
              {flow.url ? <Mono color="var(--ink-2)">{flow.url}</Mono> : null}
            </View>
          ) : null}
        </View>
      ) : kind === "api_key" ? (
        <View style={s.stack} testID="provider-key">
          <Text style={s.lead}>{`Paste your ${pick.name} key. It is stored once, encrypted, and never shown again.`}</Text>
          <TextInput accessibilityLabel="API key" testID="provider-key-input" value={secret} onChangeText={setSecret} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="Paste the key" placeholderTextColor="var(--ink-4)" style={s.input} />
          <View style={s.scopes}>
            <Text style={s.quiet}>Belongs to</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Belongs to ${scope === "mine" ? "me" : "the Space"}. Change`} testID="provider-scope" onPress={scopeMenu} style={s.scopeBtn}>
              <Text style={s.scopeText}>{scope === "mine" ? "Mine" : "Shared with the Space"}</Text><Glyph name="chevron" size={10} />
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={s.stack} testID="provider-local">
          <Text style={s.lead}>Where does the model server run? It is tested before it is added.</Text>
          <TextInput accessibilityLabel="Address" testID="provider-address" value={address} onChangeText={setAddress} autoCapitalize="none" autoCorrect={false} style={[s.input, s.mono]} />
        </View>
      )}
      {element}
      {!added && line ? <Text style={s.error} accessibilityLiveRegion="polite" testID="provider-line">{line}</Text> : null}
    </Sheet>
  );
}

const MONO = "var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace)" as string;
const s = StyleSheet.create({
  stack: { gap: 10 },
  logo: { marginRight: 10 },
  lead: { fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string },
  body: { fontSize: 13.5, lineHeight: 20, color: "var(--ink)" as string },
  quiet: { fontSize: 13, color: "var(--ink-3)" as string },
  error: { fontSize: 12.5, color: "var(--danger)" as string },
  code: { alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  input: { height: 36, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--raised)" as string, color: "var(--ink)" as string, fontSize: 13.5 },
  mono: { fontFamily: MONO },
  scopes: { flexDirection: "row", alignItems: "center", gap: 8 },
  scopeBtn: { flexDirection: "row", alignItems: "center", gap: 5, height: 26, paddingHorizontal: 10, borderRadius: 7, backgroundColor: "var(--sel)" as string },
  scopeText: { fontSize: 12.5, color: "var(--ink-2)" as string },
});
