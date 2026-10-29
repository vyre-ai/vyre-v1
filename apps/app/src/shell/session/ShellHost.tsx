import{sessionTheme}from'./space-theme.ts';
import{sessionCatalogue}from'./space-catalog.ts';
// The authenticated application shell. Kept behind SessionGate's lazy boundary so a signed-out
// first paint does not parse the screen registry, virtual lists, command surface, or place chrome.
import { speed } from "../../speed/recorder.ts";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { View, useWindowDimensions } from "react-native";
import { States } from "../../../../../ui/src/States/index.tsx";
import { dropKeyOnOwnNode } from "../../../../../client/src/gateway/local-key.ts";
import { CmdK, NewTabSearch } from "../cmdk/CmdK.tsx";
import { createGateSearch, loadRecent } from "../cmdk/gate.ts";
import type { Hit } from "../cmdk/model.ts";
import { formatHash } from "../hash/hash.ts";
import type { PlaceId } from "../rail/kits.ts";
import { createShellHub } from "../spaces/hub.ts";
import type { ShellHub } from "../spaces/hub.ts";
import { watchPurge, webPurgeClient, wipeBrowserStorage } from "../spaces/purge.ts";
import type { ShellPurge } from "../spaces/purge.ts";
import { HubProvider, useHubState } from "../spaces/context.tsx";
import { Shell } from "../spaces/Shell.tsx";
import type { PlaceContext } from "../spaces/Shell.tsx";
import { CapError } from "./caps.ts";
import { PHONE_BELOW } from "./mobile-map.ts";
import { openPhone } from "./phone.ts";
import type { LoadVoiceDevice, Phone } from "./phone.ts";
import { PlaceHost } from "./PlaceHost.tsx";
import { OnboardingHost } from "../../onboarding/OnboardingHost.tsx";
import type { OpenSessionOptions, RealSession } from "./session.ts";
import { clearStored, readStored, verifyStoredSession, writeStored } from "./stored.ts";
import type { StoredSession } from "./stored.ts";
import { isMacShell, lockedIdentity, storeLock } from "./entry.ts";
import type { LockedIdentity } from "./entry.ts";

const PhoneHost = lazy(() => import("./PhoneHost.tsx").then((m) => ({ default: m.PhoneHost })));

const tabsStorage = () => {
  const ls = (globalThis as { localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void } }).localStorage;
  return ls ? { getItem: (k: string) => { try { return ls.getItem(k); } catch { return null; } }, setItem: (k: string, v: string) => { try { ls.setItem(k, v); } catch { /* blocked */ } } } : null;
};

export interface ShellHostProps {
  stored: StoredSession;
  open: (o: OpenSessionOptions) => Promise<RealSession>;
  onSignedOut: (why?: "manual") => void;
  onHub: (h: ShellHub | null) => void;
  hub?: ShellHub;
  initialSearchOpen?: boolean;
  voice?: LoadVoiceDevice | undefined;
  onAddSpace?:()=>void;
  onSwitchSpace?:(spaceId:string)=>void;
  onLocked?:(identity:LockedIdentity)=>void;
}

export function ShellHost({ stored, open, onSignedOut, onHub, hub: given, initialSearchOpen = false, voice, onAddSpace, onSwitchSpace, onLocked }: ShellHostProps): ReactElement {
  const navRef = useRef<ShellHub | null>(null);
  const signedOutRef=useRef(onSignedOut);signedOutRef.current=onSignedOut;
  const phoneGo = useRef<((p: PlaceId, hash: string) => void) | null>(null);
  const width = useWindowDimensions().width;
  const narrow = width > 0 && width < PHONE_BELOW;
  const registerGo = useCallback((go: ((p: PlaceId, hash: string) => void) | null) => { phoneGo.current = go; }, []);
  const [openedSession, setSession] = useState<RealSession | null>(null);
  const session=openedSession?.def.spaceId===stored.def.spaceId&&openedSession.baseUrl===stored.baseUrl?openedSession:null;
  const activeStored=session?{...stored,def:session.def}:stored;
  const catalogue=sessionCatalogue(activeStored);const catalogueKey=JSON.stringify(catalogue.map(item=>[item.baseUrl,item.personId,item.def]));
  const hub = useMemo(() => {
    if (given) { navRef.current = given; return given; }
    const h = createShellHub({ spaces: catalogue.map(item=>({...item.def,starred:item.def.spaceId===stored.def.spaceId})), openId: stored.def.spaceId, personId: stored.personId, personIds:Object.fromEntries(catalogue.map(item=>[item.def.spaceId,item.personId])), deviceId: "web", storage: tabsStorage() });
    navRef.current = h;
    return h;
  }, [given, catalogueKey, stored.def.spaceId, stored.personId]);
  const location = useHubState(hub);
  const theme=useMemo(()=>sessionTheme(activeStored),[stored.personId,stored.def.spaceId,activeStored.def.skinDefault]);
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
    const options: OpenSessionOptions = { baseUrl: stored.baseUrl, token: stored.token, spaceCards:catalogue.map(item=>item.def), ...(stored.syncEpoch !== undefined ? { syncEpoch: stored.syncEpoch } : {}), onSyncEpoch: (e) => { const now = readStored(undefined, stored.baseUrl); if (now && now.token === stored.token) writeStored({ ...now, syncEpoch: e }); }, navigate: (p, hash) => { navRef.current?.go(p,hash);if(phoneGo.current)phoneGo.current(p,hash); },
      shell: (screen,args) => {
        const h = navRef.current;
        if (!h) return;
        if(screen==="spaces.switcher"&&typeof args.id==="string"&&onSwitchSpace){onSwitchSpace(args.id);return;}
        if (screen === "shell.cmdk") setSearchOpen(true);
        else if (screen === "shell.new-tab") h.newTab();
        else h.flash("Switch Spaces from the tile at the top of the rail");
      },
      onSignedOut:()=>signedOutRef.current() };
    verifyStoredSession({ stored, open: () => open(options), getSpace: async (s) => {
      const space = ((await s.call("spaces.get", {})) as { space: { id: string; fingerprint: string } }).space;
      return { id: space.id, marker: space.fingerprint };
    } })
      .then((s) => { if (off) { s.close("superseded before it opened"); return; } opened = s; writeStored({...stored,def:s.def,personId:s.me.id});setSession(s); })
      .catch((e: unknown) => {
        if (off) return;
        if ((e instanceof CapError && e.status === 401) || (e instanceof Error && /no longer matches/i.test(e.message))) { signedOutRef.current(); return; }
        setFailed(e instanceof Error && e.message ? e.message : "The Space did not answer.");
      });
    return () => { off = true; opened?.close("shell effect cleanup"); setSession(null); };
  }, [open, stored.baseUrl, stored.token, attempt]);

  useEffect(() => {
    if (!session) return undefined;
    const sync = (): void => hub.setOnline(session.runtime.connection.get() === "online", 0);
    sync();
    return session.runtime.connection.subscribe(sync);
  }, [session, hub]);
  useEffect(() => {
    if (!session) return;
    let off = false;
    void loadRecent(session.runtime).then((hits) => { if (!off) recent.current = hits; });
    return () => { off = true; };
  }, [session]);
  const search = useMemo(() => (session ? createGateSearch({ runtime: session.runtime, nav: hub, state: flags.current, recent: () => recent.current }) : null), [session, hub]);

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

  const purge = useMemo<ShellPurge | undefined>(() => (session ? {
    client: webPurgeClient({ deviceId: "web", call: session.call, wipe: () => { wipeBrowserStorage(); clearStored(); }, done: () => onSignedOut() }),
    subscribe: (l) => session.onPurge(l),
  } : undefined), [session, onSignedOut]);
  useEffect(() => location.place === "console" && purge ? watchPurge(purge, (e) => hub.flash(`Couldn't remove this device's data: ${e instanceof Error ? e.message : "try again"}`)) : undefined, [location.place, purge, hub]);
  const renderPlace = (ctx: PlaceContext): ReactElement => failed !== null && session === null
    ? <States kind="error" message={`Couldn't reach ${stored.def.name}`} cause={failed} next="Try again" retryable onRetry={() => setAttempt((n) => n + 1)} />
    : <PlaceHost place={ctx.place} runtime={session?.runtime ?? null} hash={ctx.hash} opened={(t) => { const next = formatHash(t); if (next !== ctx.hash) hub.go(ctx.place, next); }} />;
  const signOut = (): void => {
    void dropKeyOnOwnNode(stored.baseUrl, stored.token).catch(() => undefined);
    void session?.call("identity.sign_out", {}).catch(() => undefined);
    onSignedOut("manual");
  };
  const lock=():void=>{
    const identity=lockedIdentity({...stored,name:session?.me.name??stored.def.name});
    storeLock(identity);clearStored();
    void dropKeyOnOwnNode(stored.baseUrl,stored.token).catch(()=>undefined);
    void session?.call("identity.sign_out",{}).catch(()=>undefined);
    if(onLocked)onLocked(identity);else onSignedOut("manual");
  };
  const selectSpace=(id:string):void=>{if(id===stored.def.spaceId)return;const target=catalogue.find(item=>item.def.spaceId===id);if(!target||!onSwitchSpace)return;sessionTheme(target,false);onSwitchSpace(id);};
  const renderNewTab = (): ReactElement => (search ? <NewTabSearch data={search} /> : <States kind="empty" title="Open anything, or start something" icon="search" />);
  // the onboarding screen opens over whatever the shell shows, the first time a person enters a Space and when asked
  const wrap = (el: ReactElement): ReactElement => <OnboardingHost call={session?.call ?? null} space={{ kind: stored.def.kind === "personal" ? "personal" : "team", name: stored.def.name }} mac={isMacShell()} {...(onAddSpace?{onAddSpace}:{})}>{el}</OnboardingHost>;
  if (location.place === "console") return wrap(<HubProvider hub={hub}>{renderPlace({ place: "console", hash: location.hash } as PlaceContext)}</HubProvider>);
  if (narrow) return wrap(<Suspense fallback={<View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />}><PhoneHost session={session} location={{ place: location.place, hash: location.hash }} needsYou={stored.def.counts.chats ?? 0} registerGo={registerGo} onSignOut={signOut} onLock={lock} {...(onSwitchSpace?{onSwitchSpace:selectSpace}:{})} {...(onAddSpace?{onAddSpace}:{})} /></Suspense>);
  return wrap(
    <>
      <Shell hub={hub} {...(theme?{theme}:{})} {...(onSwitchSpace?{onSwitchSpace:selectSpace}:{})} renderPlace={renderPlace} renderNewTab={renderNewTab} onSearch={() => setSearchOpen(true)} onSpaceAction={(a) => { if (a === "sign-out") signOut(); else if(a==='lock')lock();else if(a==='add')onAddSpace?.(); }} {...(phone ? { phone: { device: phone.device, data: phone.data } } : {})} {...(purge ? { purge } : {})} />
      {searchOpen && search ? <CmdK data={search} onClose={() => setSearchOpen(false)} onTiming={(name, ms) => { if (name === "local" && session) speed.record(session.runtime.space.id, "search", ms); }} /> : null}
    </>
  );
}
