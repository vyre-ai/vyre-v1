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
import { Info } from "../../../../../../ui/src/Tip/index.tsx";
import { SignInPanel } from "../../../ai-signin/SignInPanel.tsx";
import { LOCAL_SIGNINS, localNote, onMacDevice, startFlow, takeLocalSignin } from "../../../ai-signin/flow.ts";
import type { Flow as SignFlow } from "../../../ai-signin/flow.ts";
import { ownAiRefusal } from "../../../ai-signin/own-ai.ts";
import { CONNECTION_NOTE, connectionList, kindNote, kindTitle, normalizeAddress, testWords } from "./model.ts";
import { AI_ACCOUNTS, SYSTEM_FOLDERS, pickSpaceFolder } from "../../../../../../lib/space-folder.ts";
import { itemName } from "../connections/model.ts";
import type { Catalog, ConnectionKind } from "./model.ts";

export interface AddProviderProps {
  onClose(): void;
  onAdded(provider: Provider): void;
  /** The gallery's own pick at first render (the screenshot mounts and tests). */
  initial?: { providerKey: string; connection: ConnectionKind };
  /** Opens with this sign-in showing (screenshots and tests). */
  initialFlow?: SignFlow;
  /** "shared": added from the Space AI accounts tab, so it belongs to the Space from the start. */
  initialScope?: "mine" | "shared";
}

type Flow = SignFlow;
const DEFAULT_ADDRESS = "http://localhost:11434";
/** A member's choice in place of Shared with the Space (only an admin shares with everyone, owner D22): it asks the admins for the key with a Vault request. */
export const ASK_ADMIN = "Ask an admin to add it for the team";
export const ASKED_ADMIN = "Asked the admins to add it for the team.";
/** The request's name, a handle the server takes: letters, digits and underscores, starting with a letter. */
const requestName = (provider: string): string => { const n = itemName(provider, "key"); return /^[A-Za-z]/.test(n) ? n : `Key_${n}`; };

export function AddProvider({ onClose, onAdded, initial, initialFlow, initialScope }: AddProviderProps): ReactElement {
  const data = useVaultData();
  // where the Space runs, for the words of a refused save (ai-signin/own-ai.ts)
  const home = data.aiHome ?? "here";
  const { element, show } = useMenu();
  const [catalog, setCatalog] = useState<readonly Catalog[] | null>(null);
  const [catalogTries, setCatalogTries] = useState(0);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [pick, setPick] = useState<Catalog | null>(null);
  const [kind, setKind] = useState<ConnectionKind | null>(initial?.connection ?? null);
  const [scope, setScope] = useState<"mine" | "shared" | "ask">(initialScope ?? "mine");
  // may this person share with the whole Space (an owner or admin)? null until the Space answers; a member gets Ask an admin in place of Shared with the Space
  const [mayShare, setMayShare] = useState<boolean | null>(null);
  const [asked, setAsked] = useState(false);
  const [secret, setSecret] = useState("");
  const [address, setAddress] = useState(DEFAULT_ADDRESS);
  const [flow, setFlow] = useState<Flow | null>(initialFlow ?? null);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [added, setAdded] = useState<Provider | null>(null);
  // shared with the Space: the folder it goes in, picked for the person (the Space's one shared folder, else "AI accounts", made on first use) and shown so it can be changed
  const [shared, setShared] = useState<Array<{ id: string; name: string; canAdd: boolean }> | null>(null);
  const [folder, setFolder] = useState<{ id?: string; name: string } | null>(null);
  const n = useRef(0);
  useEffect(() => {
    if (scope !== "shared" || shared !== null) return;
    let live = true;
    void (data.call("vault.folders.list", { scope: "shared" }) as Promise<{ folders: Array<{ id: string; name: string; yourLevel?: string }> }>)
      .then((out) => { if (!live) return; const rows = out.folders.map((f) => ({ id: f.id, name: f.name, canAdd: f.yourLevel === "edit" || f.yourLevel === "manage" })); setShared(rows); setFolder((cur) => cur ?? pickSpaceFolder(rows)); })
      .catch(() => { if (live) { setShared([]); setFolder((cur) => cur ?? { name: AI_ACCOUNTS }); } });
    return () => { live = false; };
  }, [data, scope, shared]);
  const first = useRef(initial);
  useEffect(() => {
    if (data.personal === true) return;
    let live = true;
    void (data.call("providers.space_key.get", {}) as Promise<{ mayManage?: boolean }>).then((k) => { if (live) setMayShare(k.mayManage === true); }, () => undefined);
    return () => { live = false; };
  }, [data]);
  useEffect(() => { if (mayShare === false) setScope((cur) => (cur === "shared" ? "ask" : cur)); }, [mayShare]);

  useEffect(() => {
    let live = true;
    setCatalogFailed(false);
    void (data.call("providers.catalog", {}) as Promise<{ providers: Catalog[] }>)
      .then((out) => { if (!live) return; setCatalog(out.providers); const want = first.current; if (want) setPick(out.providers.find((c) => c.key === want.providerKey) ?? null); })
      .catch(() => { if (live) { setCatalog([]); setCatalogFailed(true); } });
    return () => { live = false; };
  }, [data, catalogTries]);

  const choose = (c: Catalog): void => { setPick(c); setKind(c.connections.length === 1 ? c.connections[0]! : null); setLine(null); };
  const back = (): void => { if (kind && pick && pick.connections.length > 1) { setKind(null); } else { setPick(null); setKind(null); } setFlow(null); setSecret(""); setLine(null); };
  const done = (p: Provider): void => { setSecret(""); setAdded(p); onAdded(p); };
  const run = async (f: () => Promise<void>): Promise<void> => {
    setBusy(true); setLine(null);
    try { await f(); } catch (e) { setLine(ownAiRefusal(e, home) ?? (e instanceof Error ? e.message : "That did not work.")); }
    setBusy(false);
  };
  const key = (what: string): string => `add-${what}-${++n.current}-${data.clock().now}`;

  const startSignIn = (): Promise<void> => run(async () => {
    setFlow(await startFlow((cap, input) => data.call(cap, input), pick!.key, key(pick!.key), home));
  });
  // a Personal Space takes the Claude Code or Codex sign-in already on this computer (owner decision D2)
  const local = data.personal === true && pick ? LOCAL_SIGNINS.find((o) => o.key === pick.key) : undefined;
  const takeLocal = (): Promise<void> => run(async () => { done(await takeLocalSignin((cap, input) => data.call(cap, input), pick!.key, key(`local-${pick!.key}`), home) as unknown as Provider); });
  // a provider this server cannot sign in itself still answers the old instruction; "I have signed in" then looks for the item the person saved
  const finishSignIn = (): Promise<void> => run(async () => {
    const out = (await data.call("providers.subscription_complete", { flowId: flow!.flowId })) as { provider?: Provider };
    if (out.provider) done(out.provider); else setLine("Not finished yet. Approve the sign-in, then try again.");
  });
  const addKey = (): Promise<void> => run(async () => {
    const out = (await data.call("providers.add", { providerKey: pick!.key, connection: "api_key", apiKey: secret.trim(), scope, ...(scope === "shared" && folder?.id ? { folderId: folder.id } : {}), idempotencyKey: key(pick!.key) })) as { provider: Provider };
    done(out.provider);
  });
  // a member asks the admins for the key (vault.request goes to the Space's vault managers); nothing is saved here and the key is never typed in
  const askAdmin = (): Promise<void> => run(async () => {
    await data.call("vault.request", { name: requestName(pick!.name), fields: ["api_key"], reason: `Add a ${pick!.name} key for everyone in the Space.`, idempotencyKey: key(`ask-${pick!.key}`) });
    setSecret(""); setAsked(true);
  });
  const addLocal = (): Promise<void> => run(async () => {
    const url = normalizeAddress(address);
    if (!url) { setLine("That does not look like an address. Try http://localhost:11434."); return; }
    const out = (await data.call("providers.add", { providerKey: pick!.key, connection: "local_model", address: url, scope: "mine", idempotencyKey: key(pick!.key) })) as { provider: Provider };
    const t = (await data.call("providers.test", { providerId: out.provider.id })) as { ok: boolean; models: string[]; latencyMs: number; detail?: string };
    setLine(testWords(t));
    done(out.provider);
  });

  const folderMenu = (e: unknown): void => {
    const r = (e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } }).currentTarget?.getBoundingClientRect?.();
    const open = (shared ?? []).filter((f) => f.canAdd && !SYSTEM_FOLDERS.has(f.name));
    const rows = open.some((f) => f.name.toLowerCase() === AI_ACCOUNTS.toLowerCase()) ? open : [...open, { id: "", name: AI_ACCOUNTS, canAdd: true }];
    show([{ head: "Keep it in" }, ...rows.map((f) => ({ label: f.id ? f.name : `${f.name} (new, shared with everyone)`, checked: folder?.name === f.name, onSelect: () => setFolder(f.id ? { id: f.id, name: f.name } : { name: f.name }) }))], r?.left ?? 0, (r?.bottom ?? 0) + 4, "other");
  };
  const scopeMenu = (e: unknown): void => {
    const ev = e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } };
    const r = ev.currentTarget?.getBoundingClientRect?.();
    show([{ head: "Belongs to" }, { label: "Mine", checked: scope === "mine", onSelect: () => setScope("mine") }, ...(data.personal === true ? [] : mayShare === false ? [{ label: ASK_ADMIN, checked: scope === "ask", onSelect: () => setScope("ask") }] : [{ label: "Shared with the Space", checked: scope === "shared", onSelect: () => setScope("shared") }])], r?.left ?? 0, (r?.bottom ?? 0) + 4, "other");
  };

  const title = added ? `Added ${added.name}` : asked ? "Asked the admins" : pick ? `Add ${pick.name}` : "Add an AI provider";
  const finished = added !== null || asked;
  const footer = (
    <>
      {pick && !finished ? <Btn label="Back" onPress={back} testID="provider-back" /> : null}
      <View style={{ flex: 1 }} />
      {finished ? <Btn label="Done" primary onPress={onClose} testID="provider-done" /> : <Btn label="Cancel" onPress={onClose} testID="provider-cancel" />}
      {!finished && pick && kind === "api_key" && scope === "ask" ? <Btn label={busy ? "Asking" : "Ask an admin"} primary disabled={busy} onPress={() => void askAdmin()} testID="provider-ask-admin" /> : null}
      {!finished && pick && kind === "api_key" && scope !== "ask" ? <Btn label={busy ? "Adding" : "Add"} primary disabled={busy || secret.trim().length === 0} why="Paste the key first" onPress={() => void addKey()} testID="provider-add" /> : null}
      {!added && pick && kind === "local_model" ? <Btn label={busy ? "Testing" : "Add and test"} primary disabled={busy} onPress={() => void addLocal()} testID="provider-add-local" /> : null}
      {!added && pick && kind === "subscription" ? (flow ? (flow.url ? null : <Btn label={busy ? "Checking" : "I have signed in"} primary disabled={busy} onPress={() => void finishSignIn()} testID="provider-signed-in" />) : <>{local ? <Btn label={local.button} primary disabled={busy} onPress={() => void takeLocal()} testID="provider-local-signin" /> : null}{local && localNote(local.key, onMacDevice()) ? <Text style={s.quiet} testID="provider-local-note">{localNote(local.key, onMacDevice())}</Text> : null}<Btn label={busy ? "Opening" : `Sign in with ${pick.name}`} primary={!local} disabled={busy} onPress={() => void startSignIn()} testID="provider-signin" /></>) : null}
    </>
  );

  return (
    <Sheet title={title} onClose={onClose} footer={footer} testID="add-provider">
      {added ? (
        <View style={s.stack}>
          <Text style={s.lead} testID="provider-added">{`${added.name} is connected. ${added.scope === "mine" ? "It is yours." : "It is shared."}`}</Text>
          {line ? <Text style={s.quiet} testID="provider-line">{line}</Text> : null}
        </View>
      ) : asked ? (
        <View style={s.stack}>
          <Text style={s.lead} testID="provider-asked">{ASKED_ADMIN}</Text>
        </View>
      ) : !pick ? (
        <View testID="provider-gallery" accessibilityLabel="Providers">
          {catalog === null ? <Text style={s.quiet} testID="provider-loading">Loading</Text> : catalog.map((c) => (
            <Row key={c.key} id={`cat:${c.key}`} title={c.name} note={connectionList(c)} leading={<View style={s.logo}><LogoTile name={c.name} size={30} /></View>} onPress={() => choose(c)} />
          ))}
          {catalog !== null && catalog.length === 0 ? (
            <View style={s.empty} testID={catalogFailed ? "provider-load-failed" : "provider-none"}>
              <Text style={s.emptyTitle}>{catalogFailed ? "Could not load providers" : "No providers to add"}</Text>
              {catalogFailed ? <Btn label="Try again" onPress={() => setCatalogTries((t) => t + 1)} testID="provider-retry" /> : null}
            </View>
          ) : null}
        </View>
      ) : kind === null ? (
        <View testID="provider-kinds" accessibilityLabel="How to connect">
          {pick.connections.map((k) => <Row key={k} id={`kind:${k}`} title={kindTitle(pick.key, k)} note={kindNote(pick.key, k)} tall leading={<View style={s.logo}><LogoTile name={pick.name} size={30} /></View>} onPress={() => setKind(k)} />)}
        </View>
      ) : kind === "subscription" ? (
        <View style={s.stack} testID="provider-subscription">
          <View style={s.leadRow}><Text style={s.lead}>Sign in with your plan</Text><Info help={CONNECTION_NOTE.subscription} /></View>
          {flow ? (
            flow.url ? <SignInPanel call={(cap, input) => data.call(cap, input)} flow={flow} home={home} onCancel={() => setFlow(null)} onDone={(p) => done(p as unknown as Provider)} /> : (
              <View style={s.stack}><Text style={s.body} testID="provider-instruction">{flow.instruction}</Text></View>
            )
          ) : null}
        </View>
      ) : kind === "api_key" ? (
        <View style={s.stack} testID="provider-key">
          {scope === "ask" ? (
            <Text style={s.lead} testID="provider-ask-note">{`An admin adds the ${pick.name} key for everyone. Vyre sends them your request.`}</Text>
          ) : (
            <>
              <View style={s.leadRow}><Text style={s.lead}>{`Paste your ${pick.name} key`}</Text><Info help="It is stored once and never shown again" /></View>
              <TextInput accessibilityLabel="API key" testID="provider-key-input" value={secret} onChangeText={setSecret} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="Paste the key" placeholderTextColor="var(--ink-4)" style={s.input} />
            </>
          )}
          <View style={s.scopes}>
            <Text style={s.quiet}>Belongs to</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Belongs to ${scope === "mine" ? "me" : scope === "ask" ? "the team, once an admin adds it" : "the Space"}. Change`} testID="provider-scope" onPress={scopeMenu} style={s.scopeBtn}>
              <Text style={s.scopeText}>{scope === "mine" ? "Mine" : scope === "ask" ? ASK_ADMIN : "Shared with the Space"}</Text><Glyph name="chevron" size={10} />
            </Pressable>
            {scope === "shared" && folder ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Kept in ${folder.name}. Change`} testID="provider-folder" onPress={folderMenu} style={s.scopeBtn}>
                <Text style={s.scopeText}>{`In ${folder.name}${folder.id ? "" : " (new)"}`}</Text><Glyph name="chevron" size={10} />
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : (
        <View style={s.stack} testID="provider-local">
          <View style={s.leadRow}><Text style={s.lead}>Model server address</Text><Info help="It is tested before it is added" /></View>
          <TextInput accessibilityLabel="Address" testID="provider-address" value={address} onChangeText={setAddress} autoCapitalize="none" autoCorrect={false} style={[s.input, s.mono]} />
        </View>
      )}
      {element}
      {!finished && line ? <Text style={s.error} accessibilityLiveRegion="polite" testID="provider-line">{line}</Text> : null}
    </Sheet>
  );
}

const MONO = "var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace)" as string;
const s = StyleSheet.create({
  stack: { gap: 10 },
  logo: { marginRight: 10 },
  leadRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  lead: { fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string },
  body: { fontSize: 13.5, lineHeight: 20, color: "var(--ink)" as string },
  empty: { alignItems: "center", gap: 8, paddingVertical: 28 },
  emptyTitle: { fontSize: 13.5, fontWeight: "500", color: "var(--ink-2)" as string },
  quiet: { fontSize: 13, color: "var(--ink-3)" as string },
  error: { fontSize: 12.5, color: "var(--danger)" as string },
  code: { alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  input: { height: 36, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--raised)" as string, color: "var(--ink)" as string, fontSize: 13.5 },
  mono: { fontFamily: MONO },
  scopes: { flexDirection: "row", alignItems: "center", gap: 8 },
  scopeBtn: { flexDirection: "row", alignItems: "center", gap: 5, height: 26, paddingHorizontal: 10, borderRadius: 7, backgroundColor: "var(--sel)" as string },
  scopeText: { fontSize: 12.5, color: "var(--ink-2)" as string },
});
