import{activationUrl,isPackagedOrigin,storedPlace}from'./space-catalog.ts';
// The production session boundary. Signed-out and desktop-link flows stay in the startup chunk;
// the authenticated application shell is loaded only after a stored or verified session exists.
import { holdOpen } from "../reach/open-link.ts";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { loadCryptoKeys, loadRecoveryCrypto } from "../../../../../client/src/crypto/load.ts";
import { keepKey } from "../../../../../client/src/gateway/key-keeper.ts";
import { KeyGate } from "./KeyGate.tsx";
import { holdKeyOnOwnNode, isLoopbackUrl } from "../../../../../client/src/gateway/local-key.ts";
import { JoinFlow } from "../../join/JoinFlow.tsx";
import type { JoinValues } from "../../join/JoinFlow.tsx";
import { deviceFor, normalizeSpaceAddress } from "../../join/logic.ts";
import type { JoinInvite } from "../../join/logic.ts";
import { aiHomeOf } from "../../ai-signin/own-ai.ts";
import { spaceLabel } from "../spaces/space-label.ts";
import { Bar, Button, ErrorLine, JoinFrame, Links, Opening, Panel, SpaceImageContext, Step, TextButton, Title } from "../../join/kit.tsx";
import { NOT_A_SPACE, OFFLINE_SPACE } from "../../join/failure.ts";
import { Welcome } from "../../join/Welcome.tsx";
import { completeReset } from "../../join/reset.ts";
import {completeRecovery} from "../../join/recover.ts";
import { SpaceEntry } from "../../join/SpaceEntry.tsx";
import { OtherComputer } from "../../join/OtherComputer.tsx";
import { FirstLaunch } from "../../onboarding/FirstLaunch.tsx";
import { deviceOf } from "../../onboarding/doors.ts";
import { wantTeamNext } from "../../onboarding/doors.ts";
import { clearLock, consumeBrowserInvite, desktopEntryRefusal, inviteAppLink, VYRE_DOWNLOADS, entryTarget, isMacShell, readLock } from "./entry.ts";
import type { EntryTarget, LockedIdentity } from "./entry.ts";
import { useRelayAddress } from "./use-relay-address.ts";
import { ensureMacServer, ensurePersonalSpace } from "../../../../../client/src/connection/desktop-link.ts";
import type { Invoke } from "../../../../../client/src/connection/desktop-link.ts";
import { mark } from "../../startup/marks.ts";
import type { ShellHub } from "../spaces/hub.ts";
import { createCapCaller } from "./caps.ts";
import { JoinRefused, acceptDesktopJoin, consumeDesktopBootstrap, consumeDesktopRoute, desktopBridge, pairFromUrl, previewDesktopJoin, redeemDesktopPair } from "./desktop.ts";
import type { DesktopRoute } from "./desktop.ts";
import type { LoadVoiceDevice } from "./phone.ts";
import { openRealSession } from "./session.ts";
import type { OpenSessionOptions, RealSession } from "./session.ts";
import { clearStored, lockName, phaseForStoredAddress, readStored, readStoredSessions, readStoredSpace, openVerifiedSession, signInAndVerify, spaceAddress, spaceEndpoint, writeStored } from "./stored.ts";
import { ContinueAs } from "../../join/ContinueAs.tsx";
import { HaveAccount } from "../../join/HaveAccount.tsx";
import { knownIdentity } from "../../join/identity.ts";
import type { Carried, KnownIdentity } from "../../join/identity.ts";
import { carried, checkKnownCode, haveAccountDeps, knownProof, rememberAccount } from "../../join/carry-wiring.ts";
import type { SignInOptions, StoredSession } from "./stored.ts";
import { SSO_FAILED_LINE, SSO_SECOND_FACTOR_LINE, ssoStartUrl, takeSsoReturn } from "./sso.ts";
import { GITHUB_FAILED_LINE, GITHUB_SECOND_FACTOR_LINE, githubStartUrl, takeGithubReturn } from "./github.ts";

const RecoveryAccount=lazy(()=>import("../../join/RecoveryAccount.tsx").then(m=>({default:m.RecoveryAccount})));
const ResetAccount = lazy(() => import("../../join/ResetAccount.tsx").then(m=>({default:m.ResetAccount})));
const LocalClaim = lazy(() => import("../../claim/ClaimRoute.tsx").then(m=>({default:m.ClaimRoute})));
const JoinProviderSetup = lazy(() => import("./JoinProviderSetup.tsx").then((m) => ({ default: m.JoinProviderSetup })));
const SignedInShell = lazy(() => import("./ShellHost.tsx").then((m) => ({ default: m.ShellHost })));
const AllowScreen = lazy(() => import("../../oauth/AllowScreen.tsx").then((m) => ({ default: m.AllowScreen })));

export interface SessionGateProps {
  baseUrl?: string | null;
  open?: (o: OpenSessionOptions) => Promise<RealSession>;
  onHub?: (hub: ShellHub | null) => void;
  voice?: LoadVoiceDevice;
}

type Phase = {kind:"opening-personal"}|{kind:"start-failed";stored:StoredSession}|{ kind: "signin" } | { kind: "shell"; stored: StoredSession };
const noHub = (): void => undefined;
const hostOf = (baseUrl: string): string => baseUrl.replace(/^https?:\/\//, "").split(":")[0] ?? baseUrl;

async function unlockOwnKey(baseUrl: string, token: string, password: string, keys: { personKeyByPassword: string; personKeyByRecovery?: string; publicKey: string; privateKeyWrapped: string }): Promise<void> {
  try {
    const { openBundle, heldKeyOf, wipeOpened } = await loadCryptoKeys();
    const opened = await openBundle(password, { ...keys, personKeyByRecovery: keys.personKeyByRecovery ?? "" });
    // a linked Space's data is under its earlier key (keys.ts formerKey): that is the one this Space takes
    try { if (await holdKeyOnOwnNode(baseUrl, token, heldKeyOf(opened))) keepKey(heldKeyOf(opened)); } finally { wipeOpened(opened); }
  } catch { /* personal keys stay locked; signing in does not depend on them */ }
}

export const SIGNED_OUT_LINE = "You were signed out. Sign in again to continue.";

/**
 * The Space's face on the screens about one Space (sign-in, join, an invite, Continue as, recovery): the Space image, asked of the Space before sign-in (spaces.image is open to anyone, like the
 * name). While it is on its way, or when the Space has none or is too old to answer, the letter shows.
 */
export function WithSpaceImage({ address, children }: { address: string | null; children: ReactNode }): ReactElement {
  const [found, setFound] = useState<{ address: string; image: string } | null>(null);
  useEffect(() => {
    if (!address) return undefined;
    let alive = true;
    void (createCapCaller({ baseUrl: address, token: () => null })("spaces.image", {}) as Promise<{ image?: string }>)
      .then((out) => { if (alive && typeof out?.image === "string" && out.image.startsWith("data:image/")) setFound({ address, image: out.image }); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [address]);
  return <SpaceImageContext.Provider value={found && found.address === address ? found.image : undefined}>{children}</SpaceImageContext.Provider>;
}

/** `github` is true only for a caller that wires the GitHub button (the sign-in screen below); a bare invite never lists a control with nothing behind it. */
export function signInInvite(baseUrl: string, options: SignInOptions | null, github = false, sso = false): JoinInvite {
  return {
    space: spaceLabel(options?.name, baseUrl), host: hostOf(baseUrl), by: "", role: "", ...(options?.fingerprint?{fingerprint:options.fingerprint}:{}),
    sso: sso ? (options?.sso ?? []).map((p) => p.title) : [], github: github && options?.github === true, adminKey: false,   // a provider is offered only to a caller that wires its button, and only when the Space has it on
  };
}

/** Forgot password: the recovery code, or an administrator's reset code. Reached from sign-in and straight from the lock screen, so a person who forgot it is never sent round through signing out. */
function RecoverScreen({ baseUrl, space, username, open, onBack, onSignedIn }: { baseUrl: string; space: string; username?: string | undefined; open: NonNullable<SessionGateProps["open"]>; onBack: () => void; onSignedIn: (s: StoredSession) => void }): ReactElement {
  const anonymous = useMemo(() => createCapCaller({ baseUrl, token: () => null }), [baseUrl]);
  const [resetting, setResetting] = useState(false);
  const verify = (token: string): Promise<StoredSession> => openVerifiedSession({ baseUrl, token, open: () => open({ baseUrl, token }), getSpace: () => authenticatedSpace(baseUrl, token) });
  const holdKey = (token: string, key: Uint8Array): Promise<boolean> => holdKeyOnOwnNode(baseUrl, token, key);
  const deviceClass = desktopBridge() ? "desktop" as const : "web" as const;
  if (resetting) return <Suspense fallback={<Opening />}><ResetAccount space={space} address={baseUrl} onBack={() => setResetting(false)} onReset={async (input) => { const keys = await loadCryptoKeys(); onSignedIn(await completeReset({ call: anonymous, makeBundle: (pw, rc) => keys.makeBundle(pw, rc), verify, holdKey, wipe: keys.wipe }, { ...input, deviceClass })); }} /></Suspense>;
  return <Suspense fallback={<Opening />}><RecoveryAccount space={space} address={baseUrl} username={username} onBack={onBack} onAdminReset={() => setResetting(true)} onRecover={async (input) => { const [crypto, keys] = await Promise.all([loadRecoveryCrypto(), loadCryptoKeys()]); onSignedIn(await completeRecovery({ call: anonymous, recover: crypto.recoverAccountKeys, verify, holdKey, wipe: keys.wipe }, { ...input, deviceClass })); }} /></Suspense>;
}

/** A username and password sign-in at one Space, with the person's own key handed to their own computer's daemon afterwards. The sign-in screen uses it, and so does a computer that has just
 *  joined the person's Personal Space from another computer: the password typed there opens the account, so the person is not asked for it twice (lane l-multidevice). */
async function passwordSignIn(baseUrl: string, open: NonNullable<SessionGateProps["open"]>, v: { username: string; password: string; code?: string }, options?: SignInOptions | null) {
  const anonymous = createCapCaller({ baseUrl, token: () => null });
  let token: string | null = null;
  let keys: { personKeyByPassword: string; personKeyByRecovery?: string; publicKey: string; privateKeyWrapped: string } | undefined;
  return signInAndVerify({
    baseUrl, username: v.username.trim().toLowerCase(),
    discover: async () => options ?? (await anonymous("identity.sign_in_options", {}) as SignInOptions),
    signIn: async () => {
      const out = (await anonymous("identity.sign_in", {
        username: v.username, password: v.password, ...signInDevice(), ...(v.code ? { totp: v.code } : {}),
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
  const [unreachable, setUnreachable] = useState(false);
  useEffect(() => {
    let active = true;
    void (anonymous("identity.sign_in_options", {}) as Promise<SignInOptions>).then((found) => { if (active) { setUnreachable(false); setDiscovery({ address: baseUrl, options: found }); } }).catch(() => { if (active) setUnreachable(true); });
    return () => { active = false; };
  }, [anonymous, baseUrl]);
  const invite = useMemo(() => signInInvite(baseUrl, options, true, true), [baseUrl, options]);
  const [githubLine, setGithubLine] = useState<string | null>(null);
  useEffect(() => {
    const browser = globalThis as { location?: { hash: string; pathname: string; search: string }; history?: { replaceState(d: unknown, u: string, url: string): void } };
    const back = takeGithubReturn(browser.location, (url) => browser.history?.replaceState(null, "", url));
    if (!back) return;
    if ("error" in back) { setGithubLine(GITHUB_FAILED_LINE); return; }
    let token: string | null = null;
    void signInAndVerify({
      baseUrl,
      discover: async () => options ?? (await anonymous("identity.sign_in_options", {}) as SignInOptions),
      signIn: async () => {
        const out = (await anonymous("identity.github_sign_in", { code: back.code, ...signInDevice() })) as { status: "ok" | "second_factor_required"; session?: { token: string } };
        token = out.session?.token ?? null;
        return out;
      },
      open: () => open({ baseUrl, token: token ?? "" }),
      getSpace: async () => {
        const space = ((await createCapCaller({ baseUrl, token: () => token })("spaces.get", {})) as { space: { id: string; fingerprint: string } }).space;
        return { id: space.id, marker: space.fingerprint };
      },
    }).then((result) => {
      if (currentAddress.current !== baseUrl) return;
      if (result.status === "second_factor_required") setGithubLine(GITHUB_SECOND_FACTOR_LINE); else onSignedIn(result.stored);
    }).catch(() => { if (currentAddress.current === baseUrl) setGithubLine(GITHUB_FAILED_LINE); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [ssoLine, setSsoLine] = useState<string | null>(null);
  useEffect(() => {
    const browser = globalThis as { location?: { hash: string; pathname: string; search: string }; history?: { replaceState(d: unknown, u: string, url: string): void } };
    const back = takeSsoReturn(browser.location, (url) => browser.history?.replaceState(null, "", url));
    if (!back) return;
    if ("error" in back) { setSsoLine(SSO_FAILED_LINE); return; }
    let token: string | null = null;
    void signInAndVerify({
      baseUrl,
      discover: async () => options ?? (await anonymous("identity.sign_in_options", {}) as SignInOptions),
      signIn: async () => {
        const out = (await anonymous("identity.sso_sign_in", { provider: back.provider, code: back.code, state: "-", ...signInDevice() })) as { status: "ok" | "second_factor_required"; session?: { token: string } };
        token = out.session?.token ?? null;
        return out;
      },
      open: () => open({ baseUrl, token: token ?? "" }),
      getSpace: async () => {
        const space = ((await createCapCaller({ baseUrl, token: () => token })("spaces.get", {})) as { space: { id: string; fingerprint: string } }).space;
        return { id: space.id, marker: space.fingerprint };
      },
    }).then((result) => {
      if (currentAddress.current !== baseUrl) return;
      if (result.status === "second_factor_required") setSsoLine(SSO_SECOND_FACTOR_LINE); else onSignedIn(result.stored);
    }).catch(() => { if (currentAddress.current === baseUrl) setSsoLine(SSO_FAILED_LINE); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const startSso = useCallback((title: string) => {
    const key = options?.sso?.find((p) => p.title === title)?.key;
    const browser = globalThis as { location?: { origin: string; pathname: string; assign(url: string): void } };
    if (key && browser.location) browser.location.assign(ssoStartUrl(baseUrl, key, browser.location.origin + browser.location.pathname));
  }, [baseUrl, options]);
  const startGithub = useCallback(() => {
    const browser = globalThis as { location?: { origin: string; pathname: string; assign(url: string): void } };
    if (browser.location) browser.location.assign(githubStartUrl(baseUrl, browser.location.origin + browser.location.pathname));
  }, [baseUrl]);
  const signIn = useCallback(async (v: { username: string; password: string; code?: string }): Promise<"ok" | "second_factor_required"> => {
    const result = await passwordSignIn(baseUrl, open, v, options);
    if (currentAddress.current !== baseUrl) throw new Error("The Space address changed. Sign in again.");
    if (result.status === "second_factor_required") return result.status;
    onSignedIn(result.stored);
    return "ok";
  }, [anonymous, baseUrl, onSignedIn, open, options]);
  if (recoveryHelp) return <RecoverScreen baseUrl={baseUrl} space={invite.space} open={open} onBack={() => setRecoveryHelp(false)} onSignedIn={onSignedIn} />;
  return <JoinFlow key={`${baseUrl}|${githubLine ?? ""}|${ssoLine ?? ""}|${unreachable ? "offline" : ""}`} invite={invite} initial={{ stage: "signin", ...(githubLine ?? ssoLine ? { error: (githubLine ?? ssoLine) as string } : notice ? { error: SIGNED_OUT_LINE } : unreachable ? { error: OFFLINE_SPACE } : {}) }} onSignIn={signIn} onGithub={startGithub} onSso={startSso} onRecoveryCode={() => setRecoveryHelp(true)} {...(onBack?{onBackFromSignIn:onBack}:{})} {...(unlock?{unlock:true}:{})} />;
}

/** Sign in on a desktop with no Space yet: first the person's own Personal Space from their other computer (OtherComputer), or a Space by its address. */
function DesktopSignInDoor({ invoke, back, connect, onJoined }: { invoke: Invoke; back: () => void; connect: (back: () => void) => ReactElement; onJoined: (o: { space: string; username: string; password: string }) => void }): ReactElement {
  const [byAddress, setByAddress] = useState(false);
  if (byAddress) return connect(() => setByAddress(false));
  return <JoinFrame><OtherComputer startLocal={async () => ({ address: (await ensurePersonalSpace(invoke)).address })} onJoined={onJoined} onAddress={() => setByAddress(true)} onBack={back} /></JoinFrame>;
}

export function ConnectSpaceWelcome({ onConnect, onGetStarted, onBack }: { onConnect: (address: string) => void; onGetStarted?:()=>void; onBack?:()=>void }): ReactElement {
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
    if (!endpoint) { setError(NOT_A_SPACE); return; }
    const current = ++request.current;
    setBusy(true);
    setError("");
    try {
      const anonymous = createCapCaller({ baseUrl: endpoint, token: () => null });
      await anonymous("identity.sign_in_options", {});
      if (request.current === current) onConnect(endpoint);
    } catch {
      if (request.current === current) setError(OFFLINE_SPACE);
    } finally {
      if (request.current === current) setBusy(false);
    }
  };
  return <JoinFrame><Welcome address={address} busy={busy} error={error} onAddressChange={(value) => { request.current++; setBusy(false); setAddress(value); setError(""); }} onSignIn={() => void connect()} onGetStarted={onGetStarted??(()=>setError("Ask the Space owner for an invite link."))} {...(onBack?{onBack}:{})} /></JoinFrame>;
}

async function authenticatedSpace(baseUrl: string, token: string): Promise<{ id: string; marker: string }> {
  const authenticated = createCapCaller({ baseUrl, token: () => token });
  const space = ((await authenticated("spaces.get", {})) as { space: { id: string; fingerprint: string } }).space;
  return { id: space.id, marker: space.fingerprint };
}

function DesktopPairScreen({ route, open, onSignedIn, onSignIn }: { route: Extract<DesktopRoute, { kind: "pair" }>; open: NonNullable<SessionGateProps["open"]>; onSignedIn: (s: StoredSession) => void; onSignIn: () => void }): ReactElement {
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
  if (!failed) return <Opening title="Pairing this device" testID="pair-working" />;
  return <JoinFrame><Panel bar={<Bar cont={<Button label="Sign in" testID="pair-sign-in" onPress={onSignIn} />} />}><Step id="pair-error"><Title title="This pairing link expired" /></Step></Panel></JoinFrame>;
}

function DesktopJoinScreen({ route, open, onSignedIn, onBack, onSignIn, deviceClass }: { route: Extract<DesktopRoute, { kind: "join" }>; open: NonNullable<SessionGateProps["open"]>; onSignedIn: (s: StoredSession) => void; onBack:()=>void; onSignIn:()=>void; deviceClass:"web"|"desktop" }): ReactElement {
  const anonymous = useMemo(() => createCapCaller({ baseUrl: route.address, token: () => null }), [route.address]);
  const [join, setJoin] = useState<Awaited<ReturnType<typeof previewDesktopJoin>> | null>(null);
  const [setup, setSetup] = useState<{ stored: StoredSession; ai: JoinValues["ai"] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [ssoStarted, setSsoStarted] = useState<string | null>(null);
  const [sso, setSso] = useState<string | null>(null);
  // The account this device already has (rc.14): joining uses it unless the person asks for a different one. "I already have a Vyre account" (rc.17) brings one this device has no session for.
  const [different, setDifferent] = useState(false);
  const [have, setHave] = useState(false);
  const relay = useRelayAddress(route.address, deviceClass === "web");
  const known = useMemo(() => join ? knownIdentity(readStoredSessions(), { spaceId: join.preview.spaceId, baseUrl: route.address }) : null, [join, route.address]);
  // where the Space runs, for the words of a refused save on the AI step (ai-signin/own-ai.ts)
  const home = aiHomeOf(route.address, deviceClass === "desktop");
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
      const stored = await acceptDesktopJoin(join, values, { anonymous, deviceClass, ...(sso ? { ssoProvider: sso } : {}), open: (token) => open({ baseUrl: route.address, token }), getSpace: (token) => authenticatedSpace(route.address, token) });
      if (values.ai.choice === "key" || values.ai.choice === "sub") setSetup({ stored, ai: values.ai });
      else onSignedIn(stored);
    } catch (e) { if (e instanceof JoinRefused) throw e; throw new Error("Could not finish joining this Space. Try again."); }
  }, [anonymous, join, onSignedIn, open, route.address, deviceClass, sso]);
  if (setup) return <Suspense fallback={<Opening title="Connect your AI" />}><JoinProviderSetup stored={setup.stored} ai={setup.ai} home={home} {...(join?.preview.invitedBy ? { invitedBy: join.preview.invitedBy } : {})} onOpen={() => onSignedIn(setup.stored)} onClearSecret={() => setSetup((current) => { if (!current?.ai.key) return current; const { key: _secret, ...ai } = current.ai; return { ...current, ai }; })} /></Suspense>;
  if (failed) return <JoinFrame><Panel below={<Links><TextButton label="Sign in instead" testID="invite-sign-in" onPress={onSignIn}/></Links>} bar={<Bar onBack={onBack} cont={<Button label="Try again" testID="invite-retry" onPress={()=>setAttempt(n=>n+1)}/>}/>}><Step id="invite-error"><Title title="This invite did not open" sub="It may have expired or been used"/></Step></Panel></JoinFrame>;
  if (!join) return <Opening title="Opening your invite" testID="step-invite-loading" />;
  const required = join.preview.ssoRequired ?? [];
  if (required.length > 0 && !sso) return <JoinSso providers={required} started={ssoStarted} onStart={(key) => { void Promise.resolve(anonymous("identity.sso_join_start", { code: route.code, provider: key })).then((out) => { const start = (out as { start?: string }).start; if (start) { (globalThis as { open?: (url: string, target: string) => unknown }).open?.(`${route.address}${start}`, "_blank"); setSsoStarted(key); } }); }} onDone={() => setSso(ssoStarted)} />;
  // one join for every way the account was proved: its username and name, the password this Space signs in with, and its bundle carried here; this device then remembers who it is
  const joinWith = async (c: Carried, from?: KnownIdentity): Promise<void> => {
    const values: JoinValues = { username: c.username, displayName: c.name, password: c.password, deviceName: deviceFor(deviceClass).deviceName, trustDevice: true, ai: { choice: "none" } };
    try {
      const stored = await acceptDesktopJoin(join, values, { anonymous, deviceClass, ...(sso ? { ssoProvider: sso } : {}), open: (token) => open({ baseUrl: route.address, token }), getSpace: (token) => authenticatedSpace(route.address, token), carry: c.carry });
      const remembered: StoredSession = { ...stored, username: c.username, displayName: c.name };
      writeStored(remembered);
      // the password opened the account there too: that Space's session now knows the username, so the next Space is a plain Continue as
      if (from?.provider && c.viaPassword) rememberAccount(from, c.username);
      onSignedIn(remembered);
    } catch (e) {
      if ((e as { line?: string }).line) throw e;
      if (e instanceof JoinRefused) throw new Error(`The username ${c.username} is taken in ${join.preview.spaceName}. Use a different account.`);
      throw new Error("Could not finish joining this Space. Try again.");
    }
  };
  if (have) {
    return <HaveAccount prefix="join-have" space={spaceLabel(join.preview.spaceName, route.address)} working={`Joining ${join.preview.spaceName}`} deps={haveAccountDeps(deviceFor(deviceClass))} onProof={async (proof) => joinWith(await carried(proof))} onBack={() => setHave(false)} />;
  }
  if (known && !different) {
    const name = known.username ?? known.name;
    return <ContinueAs prefix="join-as" space={spaceLabel(join.preview.spaceName, route.address)} username={name} sub={known.provider ? `Your Vyre password (the one you set when you joined), or your recovery code, to join ${join.preview.spaceName}` : `Enter your Vyre password to join ${join.preview.spaceName}`} working={`Joining ${join.preview.spaceName}`}
      onContinue={async (password) => joinWith(await carried(await knownProof(known, { password })), known)} onOther={() => setDifferent(true)} onBack={onBack}
      {...(known.provider ? { either: { onCheckCode: (code: string) => checkKnownCode(known, code), onRecovery: async (code: string, newPassword: string) => joinWith(await carried(await knownProof(known, { code, newPassword })), known) } } : {})} />;
  }
  const invite: JoinInvite = { space: spaceLabel(join.preview.spaceName, route.address), host: hostOf(route.address), by: join.preview.invitedBy, role: join.preview.role, fingerprint: join.preview.fingerprint, sso: [], github: false, adminKey: false, deviceName: deviceFor(deviceClass).deviceName };
  const appLink=deviceClass==='web'?inviteAppLink(route,relay):null;
  return <JoinFlow invite={invite} onJoin={onJoin} onHaveAccount={() => setHave(true)} {...(deviceClass==='desktop'?{initial:{stage:'steps' as const,step:0}}:{onDownload:()=>{(globalThis as {open?:(url:string,target:string,features:string)=>unknown}).open?.(VYRE_DOWNLOADS,'_blank','noopener,noreferrer');}})} {...(appLink?{onOpenApp:()=>{(globalThis as {location?:{assign(url:string):void}}).location?.assign(appLink);}}:{})} />;
}

/** Everyone in this Space must use its single sign-on: a new person proves the invitation's address first, in a browser window, and then chooses their name and the password that wraps their keys. */
function JoinSso({ providers, started, onStart, onDone }: { providers: readonly { key: string; title: string }[]; started: string | null; onStart: (key: string) => void; onDone: () => void }): ReactElement {
  return <JoinFrame><Panel bar={<Bar cont={started ? <Button label="I signed in" testID="join-sso-done" onPress={onDone} /> : <Button label={`Continue with ${providers[0]!.title}`} testID="join-sso" onPress={() => onStart(providers[0]!.key)} />} />}><Step id="join-sso-step"><Title title={started ? "Finish in the window that opened" : "This Space uses your work sign-in"} /></Step></Panel></JoinFrame>;
}

/** A link into a Space this device is already signed in to: open it, or use another account. Never a second account by accident. */
function AlreadyIn({ session, onOpen, onOther }: { session: StoredSession; onOpen: () => void; onOther: () => void }): ReactElement {
  return <JoinFrame><Panel space={session.def.name} below={<Links><TextButton label="Use another account" testID="already-other" onPress={onOther}/></Links>} bar={<Bar cont={<Button label={`Open ${session.def.name}`} testID="already-open" onPress={onOpen}/>}/>}><Step id="already-in"><Title title={`You are in ${session.def.name}`} {...(session.username?{sub:`Signed in as ${session.username}`}:{})}/></Step></Panel></JoinFrame>;
}

/** The Space on this computer did not start: say so, and offer the two things that can help. */
function StartFailed({ onRetry, onSignIn }: { onRetry: () => void; onSignIn: () => void }): ReactElement {
  return <JoinFrame><Panel below={<Links><TextButton label="Sign in" testID="start-failed-sign-in" onPress={onSignIn}/></Links>} bar={<Bar cont={<Button label="Try again" testID="start-failed-retry" onPress={onRetry}/>}/>}><Step id="start-failed"><Title title="Vyre did not start"/><ErrorLine testID="start-failed-line">Your Space could not start on this computer.</ErrorLine></Step></Panel></JoinFrame>;
}

/** A Personal Space that never answers must end on a screen: the wait is long enough for a cold start on a slow Mac, and past it the person gets Try again. */
export function withinStart<T>(work:Promise<T>,limit=60_000):Promise<T>{return new Promise((done,fail)=>{const t=setTimeout(()=>fail(new Error('Personal Space did not start')),limit);work.then(v=>{clearTimeout(t);done(v);},e=>{clearTimeout(t);fail(e);});});}

async function resumePersonal(local:{address:string;spaceId:string},old:StoredSession,open:NonNullable<SessionGateProps['open']>):Promise<StoredSession>{const stored=await openVerifiedSession({baseUrl:local.address,token:old.token,...(old.username?{username:old.username}:{}),continuity:{id:local.spaceId,marker:old.marker},open:()=>open({baseUrl:local.address,token:old.token}),getSpace:()=>authenticatedSpace(local.address,old.token)});if(old.baseUrl!==local.address)clearStored(undefined,old.baseUrl);return stored;}

/** The device a sign-in registers: the one answer every way in gives (join/logic.ts deviceFor). */
const signInDevice = (): { deviceName: string; deviceClass: "desktop" | "web" } => deviceFor(desktopBridge() ? "desktop" : "web");

export function SessionGate(props: SessionGateProps): ReactElement {
  // What the first-launch screen reads about this window (the desktop app, the Mac, the width) is known only in the browser: the static page is drawn without it, so the first client
  // render must be drawn without it too (a different door count or title is a hydration mismatch, React #418); it is read right after mount and follows the window size.
  const [windowKnown, setWindowKnown] = useState(false);
  const [windowWidth, setWindowWidth] = useState(1280);
  useEffect(() => {
    const g = globalThis as { innerWidth?: number; addEventListener?: (t: string, f: () => void) => void; removeEventListener?: (t: string, f: () => void) => void };
    const read = (): void => setWindowWidth(g.innerWidth ?? 1280);
    read(); setWindowKnown(true);
    g.addEventListener?.("resize", read);
    return () => g.removeEventListener?.("resize", read);
  }, []);
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
  const [entryStart, setEntryStart] = useState<'choice'|'join'|'team'>('choice');
  // A claim that runs in this app: the Personal Space or a Mac server (local), or a team Space's owner link pasted here or handed over from a browser (rc.14), which keeps the account this app has.
  const [personalClaim,setPersonalClaim]=useState<{address:string;token:string;fragment:string;local?:false}|null>(null);
  const [locked, setLocked] = useState<LockedIdentity|null>(null);
  const [returnSession, setReturnSession] = useState<StoredSession|null>(null);
  const [loadedProp, setLoadedProp] = useState<string | null | undefined>("");
  const [startTry, setStartTry] = useState(0);
  const [forgot, setForgot] = useState(false);
  const [otherAccount, setOtherAccount] = useState(false);
  const [allow, setAllow] = useState<Extract<DesktopRoute, { kind: "allow" }> | null>(null);
  const bridge = useMemo(() => desktopBridge(), []);

  useEffect(() => {
    setLoadedProp(props.baseUrl);
    if(props.baseUrl===null){setLoadedAddress(null);setReady(true);return;}
    const changed = previousAddress.current !== undefined && previousAddress.current !== null && previousAddress.current !== baseUrl;
    previousAddress.current = baseUrl;
    if (changed) { setNotice(false); setDesktopRoute(null); setConnectedAddress(null); }
    const stored = readStored(undefined, baseUrl ?? undefined);
    const href=(globalThis as {location?:{href?:string}}).location?.href;
    const incoming=href?entryTarget(href):null;
    const phonePair=href&&baseUrl&&!stored?pairFromUrl(href,baseUrl):null;
    if(phonePair){const loc=(globalThis as {location?:{pathname:string;hash:string};history?:History}).location;const url=new URL(href!);url.searchParams.delete('pair');globalThis.history?.replaceState(null,'',url.pathname+url.search+(loc?.hash??''));setDesktopRoute(phonePair);setPhase({kind:'signin'});}
    else if(baseUrl!==null&&incoming?.kind==='join'){setDesktopRoute(incoming);setPhase({kind:'signin'});}
    else if(stored?.def.kind==='personal'&&isLoopbackUrl(stored.baseUrl)&&bridge){
      const invoke=(globalThis as {__TAURI__?:{core?:{invoke?:Invoke}}}).__TAURI__?.core?.invoke;
      if(invoke){let alive=true;setPhase({kind:'opening-personal'});setLoadedAddress(baseUrl);setReady(true);void withinStart(ensurePersonalSpace(invoke).then(async local=>{if(local.spaceId!==stored.def.spaceId||local.claimUrl)throw new Error('Personal Space identity changed');return{local,resumed:await resumePersonal(local,stored,open)};})).then(({local,resumed})=>{if(alive){setConnectedAddress(local.address);setPhase({kind:'shell',stored:resumed});}}).catch((failure:unknown)=>{if(!alive)return;if(failure instanceof Error&&failure.message==='Personal Space identity changed'){setPhase({kind:'signin'});setNotice(true);}else setPhase({kind:'start-failed',stored});});return()=>{alive=false;};}
      setPhase(phaseForStoredAddress(stored));
    } else setPhase(phaseForStoredAddress(stored));
    setLocked(readLock());
    setLoadedAddress(baseUrl);
    setReady(true);
  }, [baseUrl, props.baseUrl, bridge, open, startTry]);
  useEffect(() => {
    if (!bridge) return undefined;
    let alive = true;
    let unlisten: (() => void) | undefined;
    void consumeDesktopBootstrap(bridge, (route) => {
      if (!alive) return;
      // an app asked to join: the Allow screen over whatever the person is doing. Not signed in to that Space here: the normal sign-in first, then the same screen.
      if (route.kind === "claim") { setEntry(false); setOtherAccount(false); setDesktopRoute(null); setNotice(false); setPersonalClaim({ address: route.address, token: route.token, fragment: route.fragment, local: false }); return; }
      if (route.kind === "allow") {
        setAllow(route);
        if (!readStored(undefined, route.address)) { setEntry(false); setPersonalClaim(null); setDesktopRoute({ kind: "signin", address: route.address }); setPhase({ kind: "signin" }); }
        return;
      }
      // a link to one thing in a Space this computer is signed in to opens in place, through reach: no sign-in screen, nobody signed out for it
      if (route.kind === "signin" && route.item) { holdOpen(route.item); if (readStored(undefined, route.address)) return; }
      // a link opens its own screen from wherever the person is: the doors, a half-filled entry, a Personal claim
      setEntry(false);
      setPersonalClaim(null);
      setOtherAccount(false);
      setDesktopRoute(route);
      setNotice(false);
      setPhase({ kind: "signin" });
    }).then((off) => { if (alive) unlisten = off; else off(); }).catch(() => undefined);
    return () => { alive = false; unlisten?.(); };
  }, [bridge]);

  const activateAddress=(stored:StoredSession,restoreTabs:boolean):boolean=>{
    const loc=(globalThis as {location?:{origin:string;search:string;pathname:string;hash:string;assign(url:string):void};history?:History}).location;if(!loc)return true;
    const where=restoreTabs?storedPlace(stored,(()=>{try{return globalThis.localStorage;}catch{return undefined;}})()):null;
    if(where){const destination=activationUrl(stored,loc,where);if(destination.external){loc.assign(destination.url);return false;}globalThis.history?.replaceState(globalThis.history.state,'',destination.url);}
    else if(isPackagedOrigin(loc.origin)){const query=new URLSearchParams(loc.search);query.set('space',stored.baseUrl);globalThis.history?.replaceState(globalThis.history.state,'',loc.pathname+'?'+query+loc.hash);}
    return true;
  };
  const switchSpace=async(spaceId:string):Promise<void>=>{
    if(phase.kind!=='shell'||phase.stored.def.spaceId===spaceId)return;const target=readStoredSpace(spaceId);if(!target)return;const previous=phase.stored;setReturnSession(previous);setNotice(false);setLocked(null);setDesktopRoute(null);
    let chosen=target;
    if(target.def.kind==='personal'&&bridge){const native=(globalThis as {__TAURI__?:{core?:{invoke?:Invoke}}}).__TAURI__?.core?.invoke;if(native){setPhase({kind:'opening-personal'});try{const local=await ensurePersonalSpace(native);if(local.spaceId!==target.def.spaceId||local.claimUrl)throw new Error('Personal Space identity changed');chosen=await resumePersonal(local,target,open);}catch{setConnectedAddress(target.baseUrl);setNotice(true);setPhase({kind:'signin'});return;}}}
    if(!activateAddress(chosen,true))return;setConnectedAddress(chosen.baseUrl);setPhase({kind:'shell',stored:chosen});
  };
  const signedOut = useCallback((why?: "manual", selected?: string) => { clearStored(undefined, selected); setNotice(why !== "manual"); setPhase({ kind: "signin" }); }, []);
  const signedIn = useCallback((stored: StoredSession) => {activateAddress(stored,!!returnSession);clearLock();setLocked(null);setEntry(false);setReturnSession(null);setPhase({ kind: "shell", stored });}, [returnSession]);
  const signedInFromDesktop = useCallback((stored: StoredSession) => {activateAddress(stored,true);consumeBrowserInvite();clearLock();setLocked(null);setEntry(false);setReturnSession(null);setDesktopRoute((route) => consumeDesktopRoute(route)); setPhase({ kind: "shell", stored }); }, []);

  const connectSpace = (address: string): void => { setConnectedAddress(address); setDesktopRoute(null); setNotice(false); };
  const chooseEntry=async(target:EntryTarget):Promise<void>=>{const page=(globalThis as {location?:Location}).location;if(page&&!isPackagedOrigin(page.origin)&&new URL(target.kind==='claim'?target.url:target.address).origin!==page.origin){page.assign(target.kind==='claim'?target.url:new URL('/chat',target.address).href);return;}if(target.kind==='claim'){if(bridge){const link=new URL(target.url);setPersonalClaim({address:target.address,token:link.pathname.slice('/claim/'.length),fragment:link.hash,local:false});setEntry(false);return;}(globalThis as {location?:{assign(url:string):void}}).location?.assign(target.url);return;}if(bridge){const refusal=await desktopEntryRefusal(target);if(refusal)throw new Error(refusal);}if(target.kind==='signin'){const have=readStored(undefined,target.address);if(have){setConnectedAddress(have.baseUrl);signedIn(have);return;}try{await createCapCaller({baseUrl:target.address,token:()=>null})('identity.sign_in_options',{});}catch{throw new Error(OFFLINE_SPACE);}}clearLock();setEntry(false);setLocked(null);setConnectedAddress(target.address);setDesktopRoute(target);setNotice(false);setPhase({kind:'signin'});};
  const invoke=(globalThis as {__TAURI__?:{core?:{invoke?:Invoke}}}).__TAURI__?.core?.invoke;
  const createPersonal=async():Promise<void>=>{if(!invoke)throw new Error('Desktop shell required');const local=await ensurePersonalSpace(invoke);if(local.claimUrl){const link=new URL(local.claimUrl);setPersonalClaim({address:local.address,token:link.pathname.slice('/claim/'.length),fragment:link.hash});setEntry(false);}else {const old=readStoredSpace(local.spaceId);if(old?.def.kind==='personal'&&isLoopbackUrl(old.baseUrl)){const stored=await resumePersonal(local,old,open);setConnectedAddress(local.address);signedIn(stored);}else await chooseEntry({kind:'signin',address:local.address});}};
  const createMacServer=async():Promise<void>=>{if(!invoke)throw new Error('Desktop shell required');const local=await ensureMacServer(invoke);if(local.claimUrl){const link=new URL(local.claimUrl);setPersonalClaim({address:local.address,token:link.pathname.slice('/claim/'.length),fragment:link.hash});setEntry(false);}else await chooseEntry({kind:'signin',address:local.address});};
  // first launch on the desktop app: three doors; elsewhere (and for a person who already has a Space) the plain connect screen
  const connectScreen=(back?:()=>void):ReactElement=><ConnectSpaceWelcome onConnect={connectSpace} onGetStarted={()=>{setEntryStart('choice');setEntry(true);}} {...(back?{onBack:back}:{})} />;
  // the Personal Space this computer just joined restarts on its copy: wait for it to answer as that Space, then sign in there
  // the password typed to join already opened the account: sign in with it once here and hand the key to this computer's daemon, so the person is never asked again (owner rule). A second factor,
  // or a sign-in that fails, falls back to the sign-in screen at the joined Space.
  const joinedPersonal=async({space,username,password}:{space:string;username:string;password:string}):Promise<void>=>{if(!invoke)return;for(let i=0;i<120;i++){let local:{address:string;spaceId:string;claimUrl?:string|null}|null=null;try{local=await ensurePersonalSpace(invoke);}catch{/* restarting */}if(local&&local.spaceId===space&&!local.claimUrl){try{const r=await passwordSignIn(local.address,open,{username,password});if(r.status==='ok'){setConnectedAddress(local.address);signedIn(r.stored);return;}}catch{/* the sign-in screen says why */}await chooseEntry({kind:'signin',address:local.address});return;}await new Promise(r=>setTimeout(r,500));}setPhase({kind:'signin'});};
  const existingScreen=invoke?((back:()=>void):ReactElement=><DesktopSignInDoor invoke={invoke} back={back} connect={connectScreen} onJoined={o=>void joinedPersonal(o)} />):connectScreen;
  const device=windowKnown?deviceOf({desktop:!!invoke,mac:isMacShell(),width:windowWidth}):deviceOf({desktop:false,mac:false,width:1280});
  const getApp=():void=>{(globalThis as {open?:(url:string,target?:string)=>unknown}).open?.(VYRE_DOWNLOADS,'_blank');};
  const emailApp=():void=>{(globalThis as {location?:{assign(url:string):void}}).location?.assign(`mailto:?subject=${encodeURIComponent('Get Vyre')}&body=${encodeURIComponent(VYRE_DOWNLOADS)}`);};
  const firstScreen=<FirstLaunch device={device} existing={existingScreen} {...(device==='web'?{onGetApp:getApp}:{})} onDoor={async door=>{if(door==='invited'){setEntryStart('join');setEntry(true);return;}if(door==='server'){setEntryStart('team');setEntry(true);return;}if(door==='app'){emailApp();return;}wantTeamNext(door==='team');await createPersonal();}} />;
  if(personalClaim)return <Suspense fallback={<Opening />}><LocalClaim deviceClass="desktop" local={personalClaim.local!==false} token={personalClaim.token} address={personalClaim.address} fragment={personalClaim.fragment} onBack={()=>setPersonalClaim(null)} onDone={()=>{const address=personalClaim.address,stored=readStored(undefined,address);setPersonalClaim(null);if(stored){setConnectedAddress(address);signedIn(stored);}else void chooseEntry({kind:'signin',address});}} onSignIn={()=>{const address=personalClaim.address;setPersonalClaim(null);void chooseEntry({kind:'signin',address});}}/></Suspense>;
  if(entry)return <SpaceEntry startAt={entryStart} {...(invoke?{onCreatePersonal:createPersonal}:{})} {...(invoke&&isMacShell()?{onCreateMacServer:createMacServer}:{})} onTarget={chooseEntry} onBack={()=>{setEntry(false);setDesktopRoute(null);const previous=returnSession??readStored(undefined,baseUrl??undefined);if(previous){activateAddress(previous,true);setConnectedAddress(previous.baseUrl);consumeBrowserInvite();setDesktopRoute(null);setPhase({kind:'shell',stored:previous});}setReturnSession(null);}}/>;
  if (allow) {
    const present = readStored(undefined, allow.address);
    if (present) return <Suspense fallback={<Opening />}><AllowScreen call={createCapCaller({ baseUrl: allow.address, token: () => present.token })} requestId={allow.request} me={present.username ?? "you"} onDone={() => setAllow(null)} /></Suspense>;
  }
  // the first frame of every path: the mark on the sheet, the same in the static page, the first client render and the moment before a stored session is read, so no screen shows for one frame and swaps
  if (loadedAddress !== baseUrl || !ready || loadedProp !== props.baseUrl) return <Opening />;
  if(phase.kind==='opening-personal')return <Opening testID="opening-personal" />;
  if(phase.kind==='start-failed')return <StartFailed onRetry={()=>setStartTry(n=>n+1)} onSignIn={()=>{clearStored(undefined,phase.stored.baseUrl);setPhase({kind:'signin'});setConnectedAddress(null);}} />;
  if(phase.kind==='shell'&&forgot)return <SpaceImageContext.Provider value={phase.stored.def.image}><RecoverScreen baseUrl={phase.stored.baseUrl} space={phase.stored.def.name} username={phase.stored.username} open={open} onBack={()=>setForgot(false)} onSignedIn={(stored)=>{setForgot(false);signedIn(stored);}} /></SpaceImageContext.Provider>;
  if (phase.kind === "shell") return <KeyGate baseUrl={phase.stored.baseUrl} token={phase.stored.token} name={lockName(phase.stored)} onSignOut={() => signedOut("manual", phase.stored.baseUrl)} onForgot={() => setForgot(true)}><Suspense fallback={<View style={styles.fill} />}><SignedInShell key={phase.stored.baseUrl+phase.stored.personId} stored={phase.stored} open={open} onSignedOut={(why) => signedOut(why, phase.stored.baseUrl)} onHub={onHub} voice={props.voice} onSwitchSpace={id=>void switchSpace(id)} onAddSpace={()=>{setReturnSession(phase.stored);setEntryStart('choice');setEntry(true);}} onLocked={(identity)=>{clearStored();setReturnSession(null);setLocked(identity);setNotice(false);setPhase({kind:'signin'});}} /></Suspense></KeyGate>;
  if (desktopRoute?.kind === "pair") return <DesktopPairScreen key={`${desktopRoute.address}:${desktopRoute.code}`} route={desktopRoute} open={open} onSignedIn={signedInFromDesktop} onSignIn={()=>{const address=desktopRoute.address;setDesktopRoute({kind:'signin',address});}} />;
  if (desktopRoute?.kind === "join") {
    const present=otherAccount?null:readStored(undefined,desktopRoute.address);
    if(present)return <AlreadyIn session={present} onOpen={()=>{setDesktopRoute(null);signedInFromDesktop(present);}} onOther={()=>setOtherAccount(true)} />;
    return <WithSpaceImage address={desktopRoute.address}><DesktopJoinScreen key={`${desktopRoute.address}:${desktopRoute.code}`} route={desktopRoute} open={open} onSignedIn={signedInFromDesktop} onBack={()=>{setEntryStart('choice');setEntry(true);}} onSignIn={()=>{const address=desktopRoute.address;setDesktopRoute({kind:'signin',address});}} deviceClass={bridge?"desktop":"web"} /></WithSpaceImage>;
  }
  const activeAddress = desktopRoute?.address ?? connectedAddress ?? locked?.address ?? baseUrl;
  if (!activeAddress) return firstScreen;
  return <WithSpaceImage address={activeAddress}><SignInScreen baseUrl={activeAddress} open={open} onSignedIn={signedIn} notice={notice} onBack={()=>{if(returnSession){activateAddress(returnSession,true);setConnectedAddress(returnSession.baseUrl);setPhase({kind:'shell',stored:returnSession});setReturnSession(null);}else{setEntryStart('choice');setEntry(true);}}} {...(locked?{unlock:true}:{})} /></WithSpaceImage>;
}

const styles = StyleSheet.create({ fill: { flex: 1, backgroundColor: "var(--win)" as string } });
