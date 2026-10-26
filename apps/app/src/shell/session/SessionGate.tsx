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
import { CmdK } from "../cmdk/CmdK.tsx";
import { createGateSearch, loadRecent } from "../cmdk/gate.ts";
import type { Hit } from "../cmdk/model.ts";
import { realNewTabData } from "../newtab/data.ts";
import { NewTabPage } from "../newtab/NewTabPage.tsx";
import { createShellHub } from "../spaces/hub.ts";
import type { ShellHub } from "../spaces/hub.ts";
import { Shell } from "../spaces/Shell.tsx";
import type { PlaceContext } from "../spaces/Shell.tsx";
import { CapError, createCapCaller } from "./caps.ts";
import { PlaceHost } from "./PlaceHost.tsx";
import { openRealSession } from "./session.ts";
import type { OpenSessionOptions, RealSession } from "./session.ts";
import { clearStored, readStored, spaceAddress, writeStored } from "./stored.ts";
import type { StoredSession } from "./stored.ts";

export interface SessionGateProps {
  /** Overrides, for tests: where the Space is, and how a session opens. */
  baseUrl?: string | null;
  open?: (o: OpenSessionOptions) => Promise<RealSession>;
  /** Called with the hub once it exists, for the URL sync. */
  onHub?: (hub: ShellHub | null) => void;
}

const tabsStorage = () => {
  const ls = (globalThis as { localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void } }).localStorage;
  return ls ? { getItem: (k: string) => { try { return ls.getItem(k); } catch { return null; } }, setItem: (k: string, v: string) => { try { ls.setItem(k, v); } catch { /* blocked */ } } } : null;
};

type Phase = { kind: "signin" } | { kind: "shell"; stored: StoredSession };

const noHub = (): void => undefined;
const hostOf = (baseUrl: string): string => baseUrl.replace(/^https?:\/\//, "").split(":")[0] ?? baseUrl;

function SignInScreen({ baseUrl, onSignedIn }: { baseUrl: string; onSignedIn: (s: StoredSession) => void }): ReactElement {
  useEffect(() => { mark("app.usable"); }, []);
  const invite: JoinInvite = useMemo(() => ({ space: hostOf(baseUrl), host: hostOf(baseUrl), by: "", role: "", sso: [], github: false, adminKey: false }), [baseUrl]);
  const anonymous = useMemo(() => createCapCaller({ baseUrl, token: () => null }), [baseUrl]);
  const signIn = useCallback(async (v: { username: string; password: string; code?: string }): Promise<"ok" | "second_factor_required"> => {
    const out = (await anonymous("identity.sign_in", {
      username: v.username, password: v.password, deviceName: "Web browser", deviceClass: "web", ...(v.code ? { totp: v.code } : {}),
    })) as { status: "ok" | "second_factor_required"; session?: { token: string } };
    if (out.status === "second_factor_required") return "second_factor_required";
    const token = out.session?.token;
    if (!token) throw new Error("The Space did not return a session. Try again.");
    const real = await openRealSession({ baseUrl, token });
    const stored: StoredSession = { baseUrl, token, def: real.def, personId: real.me.id };
    real.close();
    writeStored(stored);
    onSignedIn(stored);
    return "ok";
  }, [anonymous, baseUrl, onSignedIn]);
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
}

export function ShellHost({ stored, open, onSignedOut, onHub, hub: given, initialSearchOpen = false }: ShellHostProps): ReactElement {
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
    open({ baseUrl: stored.baseUrl, token: stored.token, navigate: (p, hash) => navRef.current?.go(p, hash),
      shell: (screen) => {
        const h = navRef.current;
        if (!h) return;
        if (screen === "shell.cmdk") setSearchOpen(true);
        else if (screen === "shell.new-tab") h.newTab();
        else h.flash("Switch Spaces from the tile at the top of the rail");
      },
      onSignedOut })
      .then((s) => {
        if (off) { s.close(); return; }
        opened = s;
        setSession(s);
      })
      .catch((e: unknown) => {
        if (off) return;
        if (e instanceof CapError && e.status === 401) { onSignedOut(); return; }
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

  const renderPlace = (ctx: PlaceContext): ReactElement => failed !== null && session === null
    ? <States kind="error" message={`Couldn't reach ${stored.def.name}`} cause={failed} next="Try again" retryable onRetry={() => setAttempt((n) => n + 1)} />
    : <PlaceHost place={ctx.place} runtime={session?.runtime ?? null} />;
  const newTab = useMemo(() => (session && search ? realNewTabData(search, session.runtime, hub, { folders: () => [], recordTypes: () => [] }) : null), [session, search, hub]);
  const renderNewTab = (): ReactElement => (newTab ? <NewTabPage data={newTab} /> : <States kind="empty" title="Open anything, or start something" icon="search" />);
  return (
    <>
      <Shell hub={hub} renderPlace={renderPlace} renderNewTab={renderNewTab} onSearch={() => setSearchOpen(true)} />
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
    const stored = readStored();
    if (stored && (!baseUrl || stored.baseUrl === baseUrl)) setPhase({ kind: "shell", stored });
    setReady(true);
  }, [baseUrl]);

  const signedOut = useCallback(() => { clearStored(); setPhase({ kind: "signin" }); }, []);
  const signedIn = useCallback((stored: StoredSession) => setPhase({ kind: "shell", stored }), []);

  if (!ready) return <View style={styles.fill} />;
  if (phase.kind === "shell") return <ShellHost stored={phase.stored} open={open} onSignedOut={signedOut} onHub={onHub} />;
  if (!baseUrl) return <States kind="error" message="No Space to connect to" cause="This page has no address for a Space." next="Open it from your Space's address" />;
  return <SignInScreen baseUrl={baseUrl} onSignedIn={signedIn} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "var(--win)" as string },
});
