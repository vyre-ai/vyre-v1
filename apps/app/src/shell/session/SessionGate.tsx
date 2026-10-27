// The production root (ARCH 7.0): no stored session shows sign-in; a stored session paints the shell frame at once from the Space card kept on this device, then opens the real
// session behind it (whoami, the Space, the live link) and hands the runtime to the places. A 401 or a sign-out clears the stored session and returns to sign-in. A Space that cannot
// be reached keeps the frame and says so with Try again; it never shows another Space's rows.
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { States } from "../../../../../ui/src/States/index.tsx";
import { JoinFlow } from "../../join/JoinFlow.tsx";
import type { JoinValues } from "../../join/JoinFlow.tsx";
import type { JoinInvite } from "../../join/logic.ts";
import { mark } from "../../startup/marks.ts";
import { CmdK, NewTabSearch } from "../cmdk/CmdK.tsx";
import { createGateSearch, loadRecent } from "../cmdk/gate.ts";
import type { Hit } from "../cmdk/model.ts";
import { createShellHub } from "../spaces/hub.ts";
import type { PlaceId } from "../rail/kits.ts";
import type { ShellHub } from "../spaces/hub.ts";
import { Shell } from "../spaces/Shell.tsx";
import type { PlaceContext } from "../spaces/Shell.tsx";
import { dropKeyOnOwnNode, holdKeyOnOwnNode } from "../../../../../client/src/gateway/local-key.ts";
import { CapError, createCapCaller } from "./caps.ts";
import { formatHash } from "../hash/hash.ts";
import { webPurgeClient, wipeBrowserStorage } from "../spaces/purge.ts";
import type { ShellPurge } from "../spaces/purge.ts";
import { PlaceHost } from "./PlaceHost.tsx";
import { PHONE_BELOW } from "./mobile-map.ts";
import { openPhone } from "./phone.ts";
import type { LoadVoiceDevice, Phone } from "./phone.ts";
import { openRealSession } from "./session.ts";
import type { OpenSessionOptions, RealSession } from "./session.ts";
import { clearStored, phaseForStoredAddress, readStored, signInAndVerify, spaceAddress, spaceEndpoint, verifyStoredSession, writeStored } from "./stored.ts";
import type { SignInOptions, StoredSession } from "./stored.ts";
import { acceptDesktopJoin, consumeDesktopBootstrap, consumeDesktopRoute, desktopBridge, previewDesktopJoin, redeemDesktopPair } from "./desktop.ts";
import type { DesktopRoute } from "./desktop.ts";

/** The phone shell (and mobile/shell with it) loads only when the window is a phone's, so desktop never pays for it. */
const PhoneHost = lazy(() => import("./PhoneHost.tsx").then((m) => ({ default: m.PhoneHost })));

export interface SessionGateProps {
  /** Overrides, for tests: where the Space is, and how a session opens. */
  baseUrl?: string | null;
  open?: (o: OpenSessionOptions) => Promise<RealSession>;
  /** Called with the hub once it exists, for the URL sync. */
  onHub?: (hub: ShellHub | null) => void;
  /** Loads the Twilio Voice device for a token. Without it (or without a number and the telephony key) the shell has no phone and draws no dock. */
  voice?: LoadVoiceDevice;
}

const tabsStorage = () => {
  const ls = (globalThis as { localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void } }).localStorage;
  return ls ? { getItem: (k: string) => { try { return ls.getItem(k); } catch { return null; } }, setItem: (k: string, v: string) => { try { ls.setItem(k, v); } catch { /* blocked */ } } } : null;
};

type Phase = { kind: "signin" } | { kind: "shell"; stored: StoredSession };

const noHub = (): void => undefined;
const hostOf = (baseUrl: string): string => baseUrl.replace(/^https?:\/\//, "").split(":")[0] ?? baseUrl;

/** Opens the person key with the password and gives it to this computer's own daemon. The key lives only in this function; a Space on another machine never gets it, and a failure leaves sign-in working with personal keys locked. */
async function unlockOwnKey(baseUrl: string, token: string, password: string, keys: { personKeyByPassword: string; personKeyByRecovery?: string; publicKey: string; privateKeyWrapped: string }): Promise<void> {
  try {
    const { openBundle, wipe } = await import("../../../../../client/src/crypto/keys.ts");
    const opened = await openBundle(password, { ...keys, personKeyByRecovery: keys.personKeyByRecovery ?? "" });
    try { await holdKeyOnOwnNode(baseUrl, token, opened.personKey); } finally { wipe(opened.personKey); wipe(opened.privateKey); }
  } catch { /* personal keys stay locked; signing in does not depend on them */ }
}

/** The calm line after the Space ended the session (a 401, a purge): one sentence on the sign-in page, never a blank or a frozen place. */
export const SIGNED_OUT_LINE = "You were signed out. Sign in again to continue.";

/** Sign-in options may name this Space and show its display marker. Provider buttons wait for complete handlers. */
export function signInInvite(baseUrl: string, options: SignInOptions | null): JoinInvite {
  return {
    space: options?.name ?? hostOf(baseUrl), host: hostOf(baseUrl), by: "", role: "", fingerprint: options?.fingerprint,
    sso: [], github: false, adminKey: false,
  };
}

function SignInScreen({ baseUrl, open, onSignedIn, notice }: { baseUrl: string; open: NonNullable<SessionGateProps["open"]>; onSignedIn: (s: StoredSession) => void; notice?: boolean }): ReactElement {
  useEffect(() => { mark("app.usable"); }, []);
  const anonymous = useMemo(() => createCapCaller({ baseUrl, token: () => null }), [baseUrl]);
  const [options, setOptions] = useState<SignInOptions | null>(null);
  useEffect(() => {
    let active = true;
    void (anonymous("identity.sign_in_options", {}) as Promise<SignInOptions>).then((found) => { if (active) setOptions(found); }).catch(() => undefined);
    return () => { active = false; };
  }, [anonymous]);
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
    if (result.status === "second_factor_required") return result.status;
    onSignedIn(result.stored);
    return "ok";
  }, [anonymous, baseUrl, onSignedIn, open, options]);
  return <JoinFlow invite={invite} initial={{ stage: "signin", ...(notice ? { error: SIGNED_OUT_LINE } : {}) }} onSignIn={signIn} />;
}

function ConnectSpaceWelcome(): ReactElement {
  return <States kind="empty" title="Connect a Space" icon="search" />;
}

async function authenticatedSpace(baseUrl: string, token: string): Promise<{ id: string; marker: string }> {
  const authenticated = createCapCaller({ baseUrl, token: () => token });
  const space = ((await authenticated("spaces.get", {})) as { space: { id: string; fingerprint: string } }).space;
  return { id: space.id, marker: space.fingerprint };
}

/** Pair codes are redeemed only once, then verified with whoami and spaces.get before the shell receives a stored session. Ciphertext returned by pairing never unlocks Mine. */
function DesktopPairScreen({ route, open, onSignedIn }: { route: Extract<DesktopRoute, { kind: "pair" }>; open: NonNullable<SessionGateProps["open"]>; onSignedIn: (s: StoredSession) => void }): ReactElement {
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let alive = true;
    const anonymous = createCapCaller({ baseUrl: route.address, token: () => null });
    void redeemDesktopPair(route, {
      anonymous,
      open: (token) => open({ baseUrl: route.address, token }),
      getSpace: (token) => authenticatedSpace(route.address, token),
    }).then((stored) => { if (alive) onSignedIn(stored); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [onSignedIn, open, route]);
  return failed
    ? <States kind="error" message="Couldn’t finish pairing" cause="The pairing link is unavailable or expired." />
    : <States kind="empty" title="Pairing this desktop" icon="search" />;
}

/** Desktop joins preview the public routing id before displaying the invite, then seal a new Space key to it and re-check it after the anonymous accept. */
function DesktopJoinScreen({ route, open, onSignedIn }: { route: Extract<DesktopRoute, { kind: "join" }>; open: NonNullable<SessionGateProps["open"]>; onSignedIn: (s: StoredSession) => void }): ReactElement {
  const anonymous = useMemo(() => createCapCaller({ baseUrl: route.address, token: () => null }), [route.address]);
  const [join, setJoin] = useState<Awaited<ReturnType<typeof previewDesktopJoin>> | null>(null);
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
      const stored = await acceptDesktopJoin(join, values, {
        anonymous,
        open: (token) => open({ baseUrl: route.address, token }),
        getSpace: (token) => authenticatedSpace(route.address, token),
      });
      onSignedIn(stored);
    } catch {
      throw new Error("Could not finish joining this Space. Try again.");
    }
  }, [anonymous, join, onSignedIn, open, route.address]);
  if (failed) return <States kind="error" message="Couldn’t open this invite" cause="The invite is unavailable or expired." retryable onRetry={() => setAttempt((n) => n + 1)} />;
  if (!join) return <States kind="empty" title="Preparing your invite" icon="search" />;
  const invite: JoinInvite = { space: join.preview.spaceName, host: hostOf(route.address), by: join.preview.invitedBy, role: join.preview.role, fingerprint: join.preview.fingerprint, sso: [], github: false, adminKey: false };
  return <JoinFlow invite={invite} onJoin={onJoin} />;
}

export interface ShellHostProps {
  stored: StoredSession;
  open: NonNullable<SessionGateProps["open"]>;
  /** `manual` when the person pressed Sign out; anything else is the Space ending the session (the sign-in page then says so). */
  onSignedOut: (why?: "manual") => void;
  onHub: (h: ShellHub | null) => void;
  /** For tests: a hub made outside, and the search sheet already open. */
  hub?: ShellHub;
  initialSearchOpen?: boolean;
  voice?: LoadVoiceDevice | undefined;
}

export function ShellHost({ stored, open, onSignedOut, onHub, hub: given, initialSearchOpen = false, voice }: ShellHostProps): ReactElement {
  const navRef = useRef<ShellHub | null>(null);
  const phoneGo = useRef<((p: PlaceId, hash: string) => void) | null>(null);
  const width = useWindowDimensions().width;
  const narrow = width > 0 && width < PHONE_BELOW;
  const registerGo = useCallback((go: ((p: PlaceId, hash: string) => void) | null) => { phoneGo.current = go; }, []);
  const hub = useMemo(() => {
    if (given) { navRef.current = given; return given; }
    const h = createShellHub({ spaces: [{ ...stored.def, starred: true }], openId: stored.def.spaceId, personId: stored.personId, deviceId: "web", storage: tabsStorage() });
    navRef.current = h;
    return h;
  }, [given, stored.def, stored.personId]);
  const [session, setSession] = useState<RealSession | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [searchOpen, setSearchOpen] = useState(initialSearchOpen);
  const recent = useRef<readonly Hit[]>([]);
  const flags = useRef({ away: false, offline: false });

  useEffect(() => { onHub(hub); return () => onHub(null); }, [hub, onHub]);

  useEffect(() => {
    let off = false;
    let opened: RealSession | null = null;
    setFailed(null);
    const options: OpenSessionOptions = { baseUrl: stored.baseUrl, token: stored.token, ...(stored.syncEpoch !== undefined ? { syncEpoch: stored.syncEpoch } : {}), onSyncEpoch: (e) => { const now = readStored(undefined, stored.baseUrl); if (now && now.token === stored.token) writeStored({ ...now, syncEpoch: e }); }, navigate: (p, hash) => { if (phoneGo.current) phoneGo.current(p, hash); else navRef.current?.go(p, hash); },
      shell: (screen) => {
        const h = navRef.current;
        if (!h) return;
        if (screen === "shell.cmdk") setSearchOpen(true);
        else if (screen === "shell.new-tab") h.newTab();
        else h.flash("Switch Spaces from the tile at the top of the rail");
      },
      onSignedOut };
    verifyStoredSession({
      stored,
      open: () => open(options),
      getSpace: async (s) => {
        const space = ((await s.call("spaces.get", {})) as { space: { id: string; fingerprint: string } }).space;
        return { id: space.id, marker: space.fingerprint };
      },
    })
      .then((s) => {
        if (off) { s.close("superseded before it opened"); return; }
        opened = s;
        setSession(s);
      })
      .catch((e: unknown) => {
        if (off) return;
        if ((e instanceof CapError && e.status === 401) || (e instanceof Error && /no longer matches/i.test(e.message))) { onSignedOut(); return; }
        setFailed(e instanceof Error && e.message ? e.message : "The Space did not answer.");
      });
    return () => { off = true; opened?.close("shell effect cleanup"); setSession(null); };
  }, [open, stored.baseUrl, stored.token, onSignedOut, attempt]);

  // The runtime's online flag feeds the title bar's offline line.
  useEffect(() => {
    if (!session) return undefined;
    const sync = (): void => hub.setOnline(session.runtime.connection.get() === "online", 0);
    sync();
    return session.runtime.connection.subscribe(sync);
  }, [session, hub]);

  // Recent is read ahead so the sheet draws it in the same frame it opens.
  useEffect(() => {
    if (!session) return;
    let off = false;
    void loadRecent(session.runtime).then((hits) => { if (!off) recent.current = hits; });
    return () => { off = true; };
  }, [session]);

  const search = useMemo(() => (session ? createGateSearch({ runtime: session.runtime, nav: hub, state: flags.current, recent: () => recent.current }) : null), [session, hub]);

  // The phone: made once the Space is open and only when a telephony provider is connected (read first, so a Space without Twilio never asks for a token and logs no error). A provider that then
  // refuses the token (provider.auth_failed: no key in the Vault) means calls are not set up: no dock, nothing said. The dock wraps the shell when it exists.
  const [phone, setPhone] = useState<Phone | undefined>(undefined);
  const connections = useMemo(() => (session ? session.hooks.capQuery<{ connections: { connector: string; state: string }[] }>("connections.list", {}) : null), [session]);
  const telephony = useSyncExternalStore(
    connections ? connections.subscribe : () => () => undefined,
    () => { const s = connections?.getSnapshot(); return s?.status === "ready" && s.data.connections.some((c) => c.state === "active" && /twilio|telephony/i.test(c.connector)); },
    () => false,
  );
  useEffect(() => {
    if (!session || !telephony) return undefined;
    let off = false;
    let made: Phone | undefined;
    openPhone(session, { loadDevice: voice, openConversation: (id) => navRef.current?.go("inbox", id) })
      .then((p) => { if (off) { p?.close(); return; } made = p; setPhone(p); })
      .catch(() => undefined);
    return () => { off = true; made?.close(); setPhone(undefined); };
  }, [session, voice, telephony]);

  // A purge signal from the server (a revoke or an epoch bump): the wipe of what this browser holds, the ack, then back to sign-in.
  const purge = useMemo<ShellPurge | undefined>(() => (session ? {
    client: webPurgeClient({ deviceId: "web", call: session.call, wipe: () => { wipeBrowserStorage(); clearStored(); }, done: () => onSignedOut() }),
    subscribe: (l) => session.onPurge(l),
  } : undefined), [session, onSignedOut]);

  const renderPlace = (ctx: PlaceContext): ReactElement => failed !== null && session === null
    ? <States kind="error" message={`Couldn't reach ${stored.def.name}`} cause={failed} next="Try again" retryable onRetry={() => setAttempt((n) => n + 1)} />
    : <PlaceHost place={ctx.place} runtime={session?.runtime ?? null} hash={ctx.hash} opened={(t) => { const next = formatHash(t); if (next !== ctx.hash) hub.go(ctx.place, next); }} />;
  const signOut = (): void => {
    void dropKeyOnOwnNode(stored.baseUrl, stored.token).catch(() => undefined);
    void session?.call("identity.sign_out", {}).catch(() => undefined);
    onSignedOut("manual");
  };
  const onSpaceAction = (a: string): void => { if (a === "sign-out") signOut(); };
  const renderNewTab = (): ReactElement => (search ? <NewTabSearch data={search} /> : <States kind="empty" title="Open anything, or start something" icon="search" />);
  if (narrow) return <Suspense fallback={<View style={styles.fill} />}><PhoneHost session={session} needsYou={stored.def.counts.chats ?? 0} registerGo={registerGo} onSignOut={signOut} /></Suspense>;
  return (
    <>
      <Shell hub={hub} renderPlace={renderPlace} renderNewTab={renderNewTab} onSearch={() => setSearchOpen(true)} onSpaceAction={onSpaceAction} {...(phone ? { phone: { device: phone.device, data: phone.data } } : {})} {...(purge ? { purge } : {})} />
      {searchOpen && search ? <CmdK data={search} onClose={() => setSearchOpen(false)} /> : null}
    </>
  );
}

export function SessionGate(props: SessionGateProps): ReactElement {
  const baseUrl = props.baseUrl === undefined ? spaceAddress() : props.baseUrl === null ? null : spaceEndpoint(props.baseUrl);
  const open = props.open ?? openRealSession;
  const onHub = props.onHub ?? noHub;
  const [phase, setPhase] = useState<Phase>({ kind: "signin" });
  const [ready, setReady] = useState(false);
  const [loadedAddress, setLoadedAddress] = useState<string | null | undefined>(undefined);
  const previousAddress = useRef<string | null | undefined>(undefined);
  const [notice, setNotice] = useState(false);
  const [desktopRoute, setDesktopRoute] = useState<DesktopRoute | null>(null);
  const bridge = useMemo(() => desktopBridge(), []);

  // Read the stored session after mount, never during the first render: the static export pre-renders the sign-in markup and must match it.
  useEffect(() => {
    const changed = previousAddress.current !== undefined && previousAddress.current !== baseUrl;
    previousAddress.current = baseUrl;
    if (changed) {
      setNotice(false);
      setDesktopRoute(null);
    }
    const stored = readStored(undefined, baseUrl ?? undefined);
    setPhase(phaseForStoredAddress(stored));
    setLoadedAddress(baseUrl);
    setReady(true);
  }, [baseUrl]);

  // Bootstrap also installs the native listener before draining its pending link.
  // The alive gate makes an unmount between either await harmless.
  useEffect(() => {
    if (!bridge) return undefined;
    let alive = true;
    let unlisten: (() => void) | undefined;
    void consumeDesktopBootstrap(bridge, (route) => {
      if (!alive) return;
      setDesktopRoute(route);
      setNotice(false);
      setPhase({ kind: "signin" });
    }).then((off) => {
      if (alive) unlisten = off;
      else off();
    }).catch(() => undefined);
    return () => { alive = false; unlisten?.(); };
  }, [bridge]);

  const signedOut = useCallback((why?: "manual", selected?: string) => { clearStored(undefined, selected); setNotice(why !== "manual"); setPhase({ kind: "signin" }); }, []);
  const signedIn = useCallback((stored: StoredSession) => setPhase({ kind: "shell", stored }), []);
  const signedInFromDesktop = useCallback((stored: StoredSession) => { setDesktopRoute((route) => consumeDesktopRoute(route)); setPhase({ kind: "shell", stored }); }, []);

  if (loadedAddress !== baseUrl) return baseUrl ? <View style={styles.fill} /> : <ConnectSpaceWelcome />;
  if (!ready) return baseUrl ? <View style={styles.fill} /> : <ConnectSpaceWelcome />;
  if (phase.kind === "shell") return <ShellHost stored={phase.stored} open={open} onSignedOut={(why) => signedOut(why, phase.stored.baseUrl)} onHub={onHub} voice={props.voice} />;
  if (desktopRoute?.kind === "pair") return <DesktopPairScreen key={`${desktopRoute.address}:${desktopRoute.code}`} route={desktopRoute} open={open} onSignedIn={signedInFromDesktop} />;
  if (desktopRoute?.kind === "join") return <DesktopJoinScreen key={`${desktopRoute.address}:${desktopRoute.code}`} route={desktopRoute} open={open} onSignedIn={signedInFromDesktop} />;
  const activeAddress = desktopRoute?.address ?? baseUrl;
  if (!activeAddress) return <ConnectSpaceWelcome />;
  return <SignInScreen baseUrl={activeAddress} open={open} onSignedIn={signedIn} notice={notice} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "var(--win)" as string },
});
