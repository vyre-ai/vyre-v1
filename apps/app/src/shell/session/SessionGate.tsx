// The production session boundary. Signed-out and desktop-link flows stay in the startup chunk;
// the authenticated application shell is loaded only after a stored or verified session exists.
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { States } from "../../../../../ui/src/States/index.tsx";
import { loadCryptoKeys } from "../../../../../client/src/crypto/load.ts";
import { holdKeyOnOwnNode, isLoopbackUrl } from "../../../../../client/src/gateway/local-key.ts";
import { JoinFlow } from "../../join/JoinFlow.tsx";
import type { JoinValues } from "../../join/JoinFlow.tsx";
import { normalizeSpaceAddress } from "../../join/logic.ts";
import type { JoinInvite } from "../../join/logic.ts";
import { Button, Foot, Panel, Step, Title } from "../../join/kit.tsx";
import { JoinFrame } from "../../join/kit.tsx";
import { Welcome } from "../../join/Welcome.tsx";
import { SpaceEntry } from "../../join/SpaceEntry.tsx";
import { clearLock, consumeBrowserInvite, entryTarget, readLock } from "./entry.ts";
import type { EntryTarget, LockedIdentity } from "./entry.ts";
import { ensurePersonalSpace } from "../../../../../client/src/connection/desktop-link.ts";
import type { Invoke } from "../../../../../client/src/connection/desktop-link.ts";
import { mark } from "../../startup/marks.ts";
import type { ShellHub } from "../spaces/hub.ts";
import { createCapCaller } from "./caps.ts";
import { acceptDesktopJoin, consumeDesktopBootstrap, consumeDesktopRoute, desktopBridge, previewDesktopJoin, redeemDesktopPair } from "./desktop.ts";
import type { DesktopRoute } from "./desktop.ts";
import type { LoadVoiceDevice } from "./phone.ts";
import { openRealSession } from "./session.ts";
import type { OpenSessionOptions, RealSession } from "./session.ts";
import { clearStored, phaseForStoredAddress, readStored, readStoredSpace, openVerifiedSession, signInAndVerify, spaceAddress, spaceEndpoint } from "./stored.ts";
import type { SignInOptions, StoredSession } from "./stored.ts";

const LocalClaim = lazy(() => import("../../claim/ClaimRoute.tsx").then(m=>({default:m.ClaimRoute})));
const JoinProviderSetup = lazy(() => import("./JoinProviderSetup.tsx").then((m) => ({ default: m.JoinProviderSetup })));
const SignedInShell = lazy(() => import("./ShellHost.tsx").then((m) => ({ default: m.ShellHost })));

export interface SessionGateProps {
  baseUrl?: string | null;
  open?: (o: OpenSessionOptions) => Promise<RealSession>;
  onHub?: (hub: ShellHub | null) => void;
  voice?: LoadVoiceDevice;
}

type Phase = {kind:"opening-personal"}|{ kind: "signin" } | { kind: "shell"; stored: StoredSession };
const noHub = (): void => undefined;
const hostOf = (baseUrl: string): string => baseUrl.replace(/^https?:\/\//, "").split(":")[0] ?? baseUrl;

async function unlockOwnKey(baseUrl: string, token: string, password: string, keys: { personKeyByPassword: string; personKeyByRecovery?: string; publicKey: string; privateKeyWrapped: string }): Promise<void> {
  try {
    const { openBundle, wipe } = await loadCryptoKeys();
    const opened = await openBundle(password, { ...keys, personKeyByRecovery: keys.personKeyByRecovery ?? "" });
    try { await holdKeyOnOwnNode(baseUrl, token, opened.personKey); } finally { wipe(opened.personKey); wipe(opened.privateKey); }
  } catch { /* personal keys stay locked; signing in does not depend on them */ }
}

export const SIGNED_OUT_LINE = "You were signed out. Sign in again to continue.";

export function signInInvite(baseUrl: string, options: SignInOptions | null): JoinInvite {
  return {
    space: options?.name ?? hostOf(baseUrl), host: hostOf(baseUrl), by: "", role: "", ...(options?.fingerprint?{fingerprint:options.fingerprint}:{}),
    sso: [], github: false, adminKey: false,
  };
}

function SignInScreen({ baseUrl, open, onSignedIn, notice, onBack, unlock }: { baseUrl: string; open: NonNullable<SessionGateProps["open"]>; onSignedIn: (s: StoredSession) => void; notice?: boolean; onBack?:()=>void; unlock?:boolean }): ReactElement {
  useEffect(() => { mark("app.usable"); }, []);
  const anonymous = useMemo(() => createCapCaller({ baseUrl, token: () => null }), [baseUrl]);
  const currentAddress = useRef<string | null>(baseUrl);
  currentAddress.current = baseUrl;
  useEffect(() => { currentAddress.current = baseUrl; return () => { currentAddress.current = null; }; }, [baseUrl]);
  const [discovery, setDiscovery] = useState<{ address: string; options: SignInOptions } | null>(null);
  const options = discovery?.address === baseUrl ? discovery.options : null;
  const [recoveryHelp, setRecoveryHelp] = useState(false);
  useEffect(() => {
    let active = true;
    void (anonymous("identity.sign_in_options", {}) as Promise<SignInOptions>).then((found) => { if (active) setDiscovery({ address: baseUrl, options: found }); }).catch(() => undefined);
    return () => { active = false; };
  }, [anonymous, baseUrl]);
  const invite = useMemo(() => signInInvite(baseUrl, options), [baseUrl, options]);
  const signIn = useCallback(async (v: { username: string; password: string; code?: string }): Promise<"ok" | "second_factor_required"> => {
    let token: string | null = null;
    let keys: { personKeyByPassword: string; personKeyByRecovery?: string; publicKey: string; privateKeyWrapped: string } | undefined;
    const result = await signInAndVerify({
      baseUrl,
      discover: async () => options ?? (await anonymous("identity.sign_in_options", {}) as SignInOptions),
      signIn: async () => {
        const out = (await anonymous("identity.sign_in", {
          username: v.username, password: v.password, deviceName: "Web browser", deviceClass: "web", ...(v.code ? { totp: v.code } : {}),
        })) as { status: "ok" | "second_factor_required"; session?: { token: string }; keys?: typeof keys };
        token = out.session?.token ?? null;
        keys = out.keys;
        return out;
      },
      open: () => open({ baseUrl, token: token ?? "" }),
      getSpace: async () => {
        const authenticated = createCapCaller({ baseUrl, token: () => token });
        const space = ((await authenticated("spaces.get", {})) as { space: { id: string; fingerprint: string } }).space;
        return { id: space.id, marker: space.fingerprint };
      },
      afterVerified: async (stored) => { if (keys) await unlockOwnKey(baseUrl, stored.token, v.password, keys); },
    });
    if (currentAddress.current !== baseUrl) throw new Error("The Space address changed. Sign in again.");
    if (result.status === "second_factor_required") return result.status;
    onSignedIn(result.stored);
    return "ok";
  }, [anonymous, baseUrl, onSignedIn, open, options]);
  if (recoveryHelp) return <JoinFrame halftoneIntensity="calm"><Panel center><Step id="recovery-help"><Title title="Recover your account" sub="Use a device where you’re still signed in." /><Foot>Open Settings, Sign-in and devices, then change your password. That keeps your private keys and data.</Foot><Foot>If you have no signed-in device, contact the Space owner before resetting your account. This version cannot restore from a recovery code alone, and an account reset can lose private data.</Foot><Button label="Back to sign in" testID="recovery-back" onPress={() => setRecoveryHelp(false)} /></Step></Panel></JoinFrame>;
  return <JoinFlow key={baseUrl} invite={invite} initial={{ stage: "signin", ...(notice ? { error: SIGNED_OUT_LINE } : {}) }} onSignIn={signIn} onRecoveryCode={() => setRecoveryHelp(true)} {...(onBack?{onBackFromSignIn:onBack}:{})} {...(unlock?{unlock:true}:{})} />;
}

export function ConnectSpaceWelcome({ onConnect, onGetStarted }: { onConnect: (address: string) => void; onGetStarted?:()=>void }): ReactElement {
  useEffect(() => { mark("app.usable"); }, []);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  const connect = async (): Promise<void> => {
    if (busy) return;
    const normalized = normalizeSpaceAddress(address);
    const endpoint = normalized ? spaceEndpoint(normalized) : null;
    if (!endpoint) { setError("Enter a valid HTTPS Space address, or a local development address."); return; }
    const current = ++request.current;
    setBusy(true);
    setError("");
    try {
      const anonymous = createCapCaller({ baseUrl: endpoint, token: () => null });
      await anonymous("identity.sign_in_options", {});
      if (request.current === current) onConnect(endpoint);
    } catch {
      if (request.current === current) setError("Couldn’t reach this Space. Check its address and connection, then try again.");
    } finally {
      if (request.current === current) setBusy(false);
    }
  };
  return <JoinFrame halftoneIntensity="full"><Welcome address={address} busy={busy} error={error} onAddressChange={(value) => { request.current++; setBusy(false); setAddress(value); setError(""); }} onSignIn={() => void connect()} onGetStarted={onGetStarted??(()=>setError("Ask the Space owner for an invite link to create your account."))} /></JoinFrame>;
}

async function authenticatedSpace(baseUrl: string, token: string): Promise<{ id: string; marker: string }> {
  const authenticated = createCapCaller({ baseUrl, token: () => token });
  const space = ((await authenticated("spaces.get", {})) as { space: { id: string; fingerprint: string } }).space;
  return { id: space.id, marker: space.fingerprint };
}

function DesktopPairScreen({ route, open, onSignedIn }: { route: Extract<DesktopRoute, { kind: "pair" }>; open: NonNullable<SessionGateProps["open"]>; onSignedIn: (s: StoredSession) => void }): ReactElement {
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let alive = true;
    const anonymous = createCapCaller({ baseUrl: route.address, token: () => null });
    void redeemDesktopPair(route, { anonymous, open: (token) => open({ baseUrl: route.address, token }), getSpace: (token) => authenticatedSpace(route.address, token) })
      .then((stored) => { if (alive) onSignedIn(stored); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [onSignedIn, open, route]);
  return failed
    ? <States kind="error" message="Couldn’t finish pairing" cause="The pairing link is unavailable or expired." />
    : <States kind="empty" title="Pairing this desktop" icon="search" />;
}

function DesktopJoinScreen({ route, open, onSignedIn, onBack, deviceClass }: { route: Extract<DesktopRoute, { kind: "join" }>; open: NonNullable<SessionGateProps["open"]>; onSignedIn: (s: StoredSession) => void; onBack:()=>void; deviceClass:"web"|"desktop" }): ReactElement {
  const anonymous = useMemo(() => createCapCaller({ baseUrl: route.address, token: () => null }), [route.address]);
  const [join, setJoin] = useState<Awaited<ReturnType<typeof previewDesktopJoin>> | null>(null);
  const [setup, setSetup] = useState<{ stored: StoredSession; ai: JoinValues["ai"] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setJoin(null);
    setFailed(false);
    void previewDesktopJoin(route, anonymous).then((found) => { if (alive) setJoin(found); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [anonymous, attempt, route]);
  const onJoin = useCallback(async (values: JoinValues): Promise<void> => {
    if (!join) throw new Error("This invite is unavailable. Ask for a new one.");
    try {
      const stored = await acceptDesktopJoin(join, values, { anonymous, deviceClass, open: (token) => open({ baseUrl: route.address, token }), getSpace: (token) => authenticatedSpace(route.address, token) });
      if (values.ai.choice === "key" || values.ai.choice === "sub") setSetup({ stored, ai: values.ai });
      else onSignedIn(stored);
    } catch { throw new Error("Could not finish joining this Space. Try again."); }
  }, [anonymous, join, onSignedIn, open, route.address, deviceClass]);
  if (setup) return <Suspense fallback={<States kind="empty" title="Preparing AI setup" icon="search" />}><JoinProviderSetup stored={setup.stored} ai={setup.ai} onOpen={() => onSignedIn(setup.stored)} onClearSecret={() => setSetup((current) => { if (!current?.ai.key) return current; const { key: _secret, ...ai } = current.ai; return { ...current, ai }; })} /></Suspense>;
  if (failed) return <JoinFrame><Panel><Step id="invite-error"><Title title="Couldn’t open this invite" sub="The invite is unavailable or expired."/><Button label="Try again" testID="invite-retry" onPress={()=>setAttempt(n=>n+1)}/><Button label="Back" testID="invite-back" onPress={onBack}/></Step></Panel></JoinFrame>;
  if (!join) return <JoinFrame><Panel><Step id="invite-loading"><Title title="Preparing your invite"/><Foot>Checking the Space and the invitation…</Foot></Step></Panel></JoinFrame>;
  const invite: JoinInvite = { space: join.preview.spaceName, host: hostOf(route.address), by: join.preview.invitedBy, role: join.preview.role, fingerprint: join.preview.fingerprint, sso: [], github: false, adminKey: false };
  return <JoinFlow invite={invite} onJoin={onJoin} />;
}

async function resumePersonal(local:{address:string;spaceId:string},old:StoredSession,open:NonNullable<SessionGateProps['open']>):Promise<StoredSession>{const stored=await openVerifiedSession({baseUrl:local.address,token:old.token,continuity:{id:local.spaceId,marker:old.marker},open:()=>open({baseUrl:local.address,token:old.token}),getSpace:()=>authenticatedSpace(local.address,old.token)});if(old.baseUrl!==local.address)clearStored(undefined,old.baseUrl);return stored;}

export function SessionGate(props: SessionGateProps): ReactElement {
  const baseUrl = props.baseUrl === undefined ? spaceAddress() : props.baseUrl === null ? null : spaceEndpoint(props.baseUrl);
  const open = props.open ?? openRealSession;
  const onHub = props.onHub ?? noHub;
  const [phase, setPhase] = useState<Phase>({ kind: "signin" });
  const [ready, setReady] = useState(false);
  const [loadedAddress, setLoadedAddress] = useState<string | null | undefined>(undefined);
  const previousAddress = useRef<string | null | undefined>(undefined);
  const [notice, setNotice] = useState(false);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [desktopRoute, setDesktopRoute] = useState<DesktopRoute | null>(null);
  const [entry, setEntry] = useState(false);
  const [personalClaim,setPersonalClaim]=useState<{address:string;token:string;fragment:string}|null>(null);
  const [locked, setLocked] = useState<LockedIdentity|null>(null);
  const [returnSession, setReturnSession] = useState<StoredSession|null>(null);
  const bridge = useMemo(() => desktopBridge(), []);

  useEffect(() => {
    if(props.baseUrl===null){setLoadedAddress(null);setReady(true);return;}
    const changed = previousAddress.current !== undefined && previousAddress.current !== null && previousAddress.current !== baseUrl;
    previousAddress.current = baseUrl;
    if (changed) { setNotice(false); setDesktopRoute(null); setConnectedAddress(null); }
    const stored = readStored(undefined, baseUrl ?? undefined);
    const href=(globalThis as {location?:{href?:string}}).location?.href;
    const incoming=href?entryTarget(href):null;
    if(baseUrl!==null&&incoming?.kind==='join'){setDesktopRoute(incoming);setPhase({kind:'signin'});}
    else if(stored?.def.kind==='personal'&&isLoopbackUrl(stored.baseUrl)&&bridge){
      const invoke=(globalThis as {__TAURI__?:{core?:{invoke?:Invoke}}}).__TAURI__?.core?.invoke;
      if(invoke){let alive=true;setPhase({kind:'opening-personal'});setLoadedAddress(baseUrl);setReady(true);void ensurePersonalSpace(invoke).then(async local=>{if(local.spaceId!==stored.def.spaceId||local.claimUrl)throw new Error('Personal Space identity changed');const resumed=await resumePersonal(local,stored,open);if(alive){setConnectedAddress(local.address);setPhase({kind:'shell',stored:resumed});}}).catch(()=>{if(alive){setPhase({kind:'signin'});setNotice(true);}});return()=>{alive=false;};}
      setPhase(phaseForStoredAddress(stored));
    } else setPhase(phaseForStoredAddress(stored));
    setLocked(readLock());
    setLoadedAddress(baseUrl);
    setReady(true);
  }, [baseUrl, props.baseUrl, bridge, open]);
  useEffect(() => {
    if (!bridge) return undefined;
    let alive = true;
    let unlisten: (() => void) | undefined;
    void consumeDesktopBootstrap(bridge, (route) => {
      if (!alive) return;
      setDesktopRoute(route);
      setNotice(false);
      setPhase({ kind: "signin" });
    }).then((off) => { if (alive) unlisten = off; else off(); }).catch(() => undefined);
    return () => { alive = false; unlisten?.(); };
  }, [bridge]);

  const signedOut = useCallback((why?: "manual", selected?: string) => { clearStored(undefined, selected); setNotice(why !== "manual"); setPhase({ kind: "signin" }); }, []);
  const signedIn = useCallback((stored: StoredSession) => {clearLock();setLocked(null);setEntry(false);setReturnSession(null);setPhase({ kind: "shell", stored });}, []);
  const signedInFromDesktop = useCallback((stored: StoredSession) => {consumeBrowserInvite();clearLock();setLocked(null);setEntry(false);setReturnSession(null);setDesktopRoute((route) => consumeDesktopRoute(route)); setPhase({ kind: "shell", stored }); }, []);

  const connectSpace = (address: string): void => { setConnectedAddress(address); setDesktopRoute(null); setNotice(false); };
  const chooseEntry=async(target:EntryTarget):Promise<void>=>{if(target.kind==='claim'){(globalThis as {location?:{assign(url:string):void}}).location?.assign(target.url);return;}if(target.kind==='signin'){try{await createCapCaller({baseUrl:target.address,token:()=>null})('identity.sign_in_options',{});}catch{throw new Error('Couldn’t reach this Space. Check its address and try again.');}}clearLock();setEntry(false);setLocked(null);setConnectedAddress(target.address);setDesktopRoute(target);setNotice(false);setPhase({kind:'signin'});};
  const invoke=(globalThis as {__TAURI__?:{core?:{invoke?:Invoke}}}).__TAURI__?.core?.invoke;
  const createPersonal=async():Promise<void>=>{if(!invoke)throw new Error('Desktop shell required');const local=await ensurePersonalSpace(invoke);if(local.claimUrl){const link=new URL(local.claimUrl);setPersonalClaim({address:local.address,token:link.pathname.slice('/claim/'.length),fragment:link.hash});setEntry(false);}else {const old=readStoredSpace(local.spaceId);if(old?.def.kind==='personal'&&isLoopbackUrl(old.baseUrl)){const stored=await resumePersonal(local,old,open);setConnectedAddress(local.address);signedIn(stored);}else await chooseEntry({kind:'signin',address:local.address});}};
  if(personalClaim)return <Suspense fallback={null}><LocalClaim deviceClass="desktop" token={personalClaim.token} address={personalClaim.address} fragment={personalClaim.fragment} onDone={()=>{const stored=readStored(undefined,personalClaim.address);if(stored){setConnectedAddress(personalClaim.address);setPersonalClaim(null);signedIn(stored);}}} onSignIn={()=>{const address=personalClaim.address;setPersonalClaim(null);void chooseEntry({kind:'signin',address});}}/></Suspense>;
  if(entry)return <SpaceEntry {...(invoke?{onCreatePersonal:createPersonal}:{})} onTarget={chooseEntry} onBack={()=>{setEntry(false);setDesktopRoute(null);const previous=returnSession??readStored(undefined,baseUrl??undefined);if(previous){consumeBrowserInvite();setDesktopRoute(null);setPhase({kind:'shell',stored:previous});}setReturnSession(null);}}/>;
  if (loadedAddress !== baseUrl || !ready) return baseUrl ? <View style={styles.fill} /> : <ConnectSpaceWelcome onConnect={connectSpace} onGetStarted={()=>setEntry(true)} />;
  if(phase.kind==='opening-personal')return <JoinFrame><Panel><Step id="opening-personal"><Title title="Opening your Personal Space" sub="Starting the Space on this computer…"/></Step></Panel></JoinFrame>;
  if (phase.kind === "shell") return <Suspense fallback={<View style={styles.fill} />}><SignedInShell stored={phase.stored} open={open} onSignedOut={(why) => signedOut(why, phase.stored.baseUrl)} onHub={onHub} voice={props.voice} onAddSpace={()=>{setReturnSession(phase.stored);setEntry(true);}} onLocked={(identity)=>{clearStored();setReturnSession(null);setLocked(identity);setNotice(false);setPhase({kind:'signin'});}} /></Suspense>;
  if (desktopRoute?.kind === "pair") return <DesktopPairScreen key={`${desktopRoute.address}:${desktopRoute.code}`} route={desktopRoute} open={open} onSignedIn={signedInFromDesktop} />;
  if (desktopRoute?.kind === "join") return <DesktopJoinScreen key={`${desktopRoute.address}:${desktopRoute.code}`} route={desktopRoute} open={open} onSignedIn={signedInFromDesktop} onBack={()=>setEntry(true)} deviceClass={bridge?"desktop":"web"} />;
  const activeAddress = desktopRoute?.address ?? connectedAddress ?? locked?.address ?? baseUrl;
  if (!activeAddress) return <ConnectSpaceWelcome onConnect={connectSpace} onGetStarted={()=>setEntry(true)} />;
  return <SignInScreen baseUrl={activeAddress} open={open} onSignedIn={signedIn} notice={notice} onBack={()=>setEntry(true)} {...(locked?{unlock:true}:{})} />;
}

const styles = StyleSheet.create({ fill: { flex: 1, backgroundColor: "var(--win)" as string } });
