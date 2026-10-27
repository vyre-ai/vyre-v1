// The production root (ARCH 7.0): no stored session shows sign-in; a stored session paints the shell frame at once from the Space card kept on this device, then opens the real
// session behind it (whoami, the Space, the live link) and hands the runtime to the places. A 401 or a sign-out clears the stored session and returns to sign-in. A Space that cannot
// be reached keeps the frame and says so with Try again; it never shows another Space's rows.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { States } from "../../../../../ui/src/States/index.tsx";
import { JoinFlow } from "../../join/JoinFlow.tsx";
import type { JoinInvite } from "../../join/logic.ts";
import { mark } from "../../startup/marks.ts";
import { CmdK, NewTabSearch } from "../cmdk/CmdK.tsx";
import { createGateSearch, loadRecent } from "../cmdk/gate.ts";
import type { Hit } from "../cmdk/model.ts";
import { createShellHub } from "../spaces/hub.ts";
import type { ShellHub } from "../spaces/hub.ts";
import { Shell } from "../spaces/Shell.tsx";
import type { PlaceContext } from "../spaces/Shell.tsx";
import { CapError, createCapCaller } from "./caps.ts";
import { webPurgeClient, wipeBrowserStorage } from "../spaces/purge.ts";
import type { ShellPurge } from "../spaces/purge.ts";
import { PlaceHost } from "./PlaceHost.tsx";
import { openPhone } from "./phone.ts";
import type { LoadVoiceDevice, Phone } from "./phone.ts";
import { openRealSession } from "./session.ts";
import type { OpenSessionOptions, RealSession } from "./session.ts";
import { clearStored, readStored, signInAndVerify, spaceAddress, verifyStoredSession } from "./stored.ts";
import type { SignInOptions, StoredSession } from "./stored.ts";

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

/** Sign-in options may name this Space and show its display marker. Provider buttons wait for complete handlers. */
export function signInInvite(baseUrl: string, options: SignInOptions | null): JoinInvite {
  return {
    space: options?.name ?? hostOf(baseUrl), host: hostOf(baseUrl), by: "", role: "", fingerprint: options?.fingerprint,
    sso: [], github: false, adminKey: false,
  };
}

function SignInScreen({ baseUrl, open, onSignedIn }: { baseUrl: string; open: NonNullable<SessionGateProps["open"]>; onSignedIn: (s: StoredSession) => void }): ReactElement {
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
    const result = await signInAndVerify({
      baseUrl,
      discover: async () => options ?? (await anonymous("identity.sign_in_options", {}) as SignInOptions),
      signIn: async () => {
        const out = (await anonymous("identity.sign_in", {
          username: v.username, password: v.password, deviceName: "Web browser", deviceClass: "web", ...(v.code ? { totp: v.code } : {}),
        })) as { status: "ok" | "second_factor_required"; session?: { token: string } };
        token = out.session?.token ?? null;
        return out;
      },
      open: () => open({ baseUrl, token: token ?? "" }),
      getSpace: async () => {
        const authenticated = createCapCaller({ baseUrl, token: () => token });
        const space = ((await authenticated("spaces.get", {})) as { space: { id: string; fingerprint: string } }).space;
        return { id: space.id, marker: space.fingerprint };
      },
    });
    if (result.status === "second_factor_required") return result.status;
    onSignedIn(result.stored);
    return "ok";
  }, [anonymous, baseUrl, onSignedIn, open, options]);
  return <JoinFlow invite={invite} initial={{ stage: "signin" }} onSignIn={signIn} />;
}

export interface ShellHostProps {
  stored: StoredSession;
  open: NonNullable<SessionGateProps["open"]>;
  onSignedOut: () => void;
  onHub: (h: ShellHub | null) => void;
  /** For tests: a hub made outside, and the search sheet already open. */
  hub?: ShellHub;
  initialSearchOpen?: boolean;
  voice?: LoadVoiceDevice | undefined;
}

export function ShellHost({ stored, open, onSignedOut, onHub, hub: given, initialSearchOpen = false, voice }: ShellHostProps): ReactElement {
  const navRef = useRef<ShellHub | null>(null);
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
    const options: OpenSessionOptions = { baseUrl: stored.baseUrl, token: stored.token, navigate: (p, hash) => navRef.current?.go(p, hash),
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
        if (off) { s.close(); return; }
        opened = s;
        setSession(s);
      })
      .catch((e: unknown) => {
        if (off) return;
        if ((e instanceof CapError && e.status === 401) || (e instanceof Error && /no longer matches/i.test(e.message))) { onSignedOut(); return; }
        setFailed(e instanceof Error && e.message ? e.message : "The Space did not answer.");
      });
    return () => { off = true; opened?.close(); setSession(null); };
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

  // The phone: made once the Space is open and only when it has a number and the telephony key; the dock wraps the shell when it exists.
  const [phone, setPhone] = useState<Phone | undefined>(undefined);
  useEffect(() => {
    if (!session) return undefined;
    let off = false;
    let made: Phone | undefined;
    openPhone(session, { loadDevice: voice, openConversation: (id) => navRef.current?.go("inbox", id) })
      .then((p) => { if (off) { p?.close(); return; } made = p; setPhone(p); })
      .catch(() => undefined);
    return () => { off = true; made?.close(); setPhone(undefined); };
  }, [session, voice]);

  // A purge signal from the server (a revoke or an epoch bump): the wipe of what this browser holds, the ack, then back to sign-in.
  const purge = useMemo<ShellPurge | undefined>(() => (session ? {
    client: webPurgeClient({ deviceId: "web", call: session.call, wipe: () => { wipeBrowserStorage(); clearStored(); }, done: () => onSignedOut() }),
    subscribe: (l) => session.onPurge(l),
  } : undefined), [session, onSignedOut]);

  const renderPlace = (ctx: PlaceContext): ReactElement => failed !== null && session === null
    ? <States kind="error" message={`Couldn't reach ${stored.def.name}`} cause={failed} next="Try again" retryable onRetry={() => setAttempt((n) => n + 1)} />
    : <PlaceHost place={ctx.place} runtime={session?.runtime ?? null} />;
  const renderNewTab = (): ReactElement => (search ? <NewTabSearch data={search} /> : <States kind="empty" title="Open anything, or start something" icon="search" />);
  return (
    <>
      <Shell hub={hub} renderPlace={renderPlace} renderNewTab={renderNewTab} onSearch={() => setSearchOpen(true)} {...(phone ? { phone: { device: phone.device, data: phone.data } } : {})} {...(purge ? { purge } : {})} />
      {searchOpen && search ? <CmdK data={search} onClose={() => setSearchOpen(false)} /> : null}
    </>
  );
}

export function SessionGate(props: SessionGateProps): ReactElement {
  const baseUrl = props.baseUrl === undefined ? spaceAddress() : props.baseUrl;
  const open = props.open ?? openRealSession;
  const onHub = props.onHub ?? noHub;
  const [phase, setPhase] = useState<Phase>({ kind: "signin" });
  const [ready, setReady] = useState(false);

  // Read the stored session after mount, never during the first render: the static export pre-renders the sign-in markup and must match it.
  useEffect(() => {
    const stored = readStored(undefined, baseUrl ?? undefined);
    if (stored) setPhase({ kind: "shell", stored });
    setReady(true);
  }, [baseUrl]);

  const signedOut = useCallback((selected?: string) => { clearStored(undefined, selected); setPhase({ kind: "signin" }); }, []);
  const signedIn = useCallback((stored: StoredSession) => setPhase({ kind: "shell", stored }), []);

  if (!ready) return <View style={styles.fill} />;
  if (phase.kind === "shell") return <ShellHost stored={phase.stored} open={open} onSignedOut={() => signedOut(phase.stored.baseUrl)} onHub={onHub} voice={props.voice} />;
  if (!baseUrl) return <States kind="error" message="No Space to connect to" cause="This page has no address for a Space." next="Open it from your Space's address" />;
  return <SignInScreen baseUrl={baseUrl} open={open} onSignedIn={signedIn} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "var(--win)" as string },
});
