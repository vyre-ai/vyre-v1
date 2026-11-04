import{lookApplier,restoreLook}from'../providers/settings-look.ts';
import{sessionTheme}from'./space-theme.ts';
import{sessionCatalogue}from'./space-catalog.ts';
// The authenticated application shell. Kept behind SessionGate's lazy boundary so a signed-out
// first paint does not parse the screen registry, virtual lists, command surface, or place chrome.
import { subscribeUpdates, updateState, updateWaiting } from "../../startup/update/store.ts";
import { ConsoleAlone, onConsoleHost } from "../console-host.ts";
import { speed } from "../../speed/recorder.ts";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { View, useWindowDimensions } from "react-native";
import { States } from "../../../../../ui/src/States/index.tsx";
import { forgetKey } from "../../../../../client/src/gateway/key-keeper.ts";
import { dropKeyOnOwnNode } from "../../../../../client/src/gateway/local-key.ts";
import { CmdK, NewTabSearch } from "../cmdk/CmdK.tsx";
import { createGateSearch, loadRecent } from "../cmdk/gate.ts";
import type { Hit } from "../cmdk/model.ts";
import { formatHash, parseHash } from "../hash/hash.ts";
import { tabKey } from "../tabs/store.ts";
import { followTitle, screenAsk, titleAsk, typeTitleAsk } from "../tabs/titles.ts";
import { railPlaces } from "../rail/kits.ts";
import type { PlaceId } from "../rail/kits.ts";
import { createShellHub } from "../spaces/hub.ts";
import { INBOX_TIP, followInboxSources, rememberInbox, seedInbox, takeInboxTip } from "../rail/inbox-sources.ts";
import type { ShellHub } from "../spaces/hub.ts";
import { watchPurge, webPurgeClient, wipeBrowserStorage } from "../spaces/purge.ts";
import type { ShellPurge } from "../spaces/purge.ts";
import { HubProvider, useHubState } from "../spaces/context.tsx";
import { Shell } from "../spaces/Shell.tsx";
import type { PlaceContext } from "../spaces/Shell.tsx";
import { CapError, createCapCaller } from "./caps.ts";
import { isLoopbackUrl } from "../../../../../client/src/gateway/local-key.ts";
import { linkComputer, unlinkComputer } from "./computer-link.ts";
import { PHONE_BELOW } from "./mobile-map.ts";
import { openPhone } from "./phone.ts";
import { readUrlIntoHub } from "./url.ts";
import type { LoadVoiceDevice, Phone } from "./phone.ts";
import { PlaceHost } from "./PlaceHost.tsx";
import { OnboardingHost } from "../../onboarding/OnboardingHost.tsx";
import type { OpenSessionOptions, RealSession } from "./session.ts";
import { clearStored, readStored, verifyStoredSession, writeStored } from "./stored.ts";
import type { StoredSession } from "./stored.ts";
import { VaultUnlockHost } from "./VaultUnlockHost.tsx";
import { teamActions } from "./team-actions.ts";
import { ReportHost } from "../report/ReportHost.tsx";
import { useNotificationNotices, useUpdateNotice } from "../noticeslot/bridge.ts";
import type { NotificationNoticesProps, UpdateSource } from "../noticeslot/bridge.ts";
import { desktopUpdates, localStore, setUpdateState } from "../../startup/update/store.ts";
import { FROM_KEY, noteUpdateFrom } from "../../startup/update/model.ts";
import { isMacShell, lockedIdentity, storeLock } from "./entry.ts";
import { anyUnread } from "../../places/chats/sidebar/model.ts";
import type { RecentOut } from "../../places/chats/sidebar/model.ts";
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
  const catalogue=sessionCatalogue(activeStored);const catalogueKey=JSON.stringify(catalogue.map(item=>{const{image:_image,...def}=item.def;return[item.baseUrl,item.personId,def];}));// the image's file id (imageKey) stands for its bytes, so the key stays small
  const hub = useMemo(() => {
    if (given) { navRef.current = given; return given; }
    // Inbox starts where this device last saw it for this person and Space, so the rail does not jump while the reads answer
    const h = createShellHub({ spaces: catalogue.map(item=>({...seedInbox(item.def,tabsStorage(),item.personId),starred:item.def.spaceId===stored.def.spaceId})), openId: stored.def.spaceId, personId: stored.personId, personIds:Object.fromEntries(catalogue.map(item=>[item.def.spaceId,item.personId])), deviceId: "web", storage: tabsStorage() });
    // a link in the address wins over the restored tabs from the first frame, so nothing else is drawn first (UrlSync takes over from here)
    const page = (globalThis as { location?: { pathname?: string; hash?: string } }).location;
    if (page?.pathname !== undefined && page.hash !== undefined) readUrlIntoHub(h, { pathname: page.pathname, hash: page.hash });
    navRef.current = h;
    return h;
  }, [given, catalogueKey, stored.def.spaceId, stored.personId]);
  const location = useHubState(hub);
  const theme=useMemo(()=>{const th=sessionTheme(activeStored);lookApplier({me:{id:activeStored.personId},space:{id:activeStored.def.spaceId}} as never).apply(restoreLook(activeStored.personId));return th;},[stored.personId,stored.def.spaceId,activeStored.def.skinDefault]);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [searchOpen, setSearchOpen] = useState(initialSearchOpen);
  // where new chats run by default in a Team Space: this computer (engine.local_runs on) or the Space (off)
  const [runsOn, setRunsOn] = useState<"device" | "space">("device");
  const recent = useRef<readonly Hit[]>([]);
  const flags = useRef<{ away: boolean; offline: boolean; terminal?: boolean; inbox?: boolean }>({ away: false, offline: false });

  useEffect(() => { onHub(hub); return () => onHub(null); }, [hub, onHub]);
  // this computer runs the person's own chats in each Team Space they are signed in to here (computer-link.ts): at app start and whenever the signed-in Spaces change
  useEffect(() => { void linkComputer(catalogue); }, [catalogueKey, stored.token]);
  useEffect(() => {
    let off = false;
    let opened: RealSession | null = null;
    setFailed(null);
    const options: OpenSessionOptions = { baseUrl: stored.baseUrl, token: stored.token, ...(stored.username ? { username: stored.username } : {}), spaceCards:catalogue.map(item=>item.def), ...(stored.syncEpoch !== undefined ? { syncEpoch: stored.syncEpoch } : {}), onSyncEpoch: (e) => { const now = readStored(undefined, stored.baseUrl); if (now && now.token === stored.token) writeStored({ ...now, syncEpoch: e }); }, notice: (text) => { navRef.current?.flash(text); }, navigate: (p, hash, background) => { navRef.current?.go(p,hash,background);if(phoneGo.current&&background!==true)phoneGo.current(p,hash); },
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
      .then((s) => { if (off) { s.close("superseded before it opened"); return; } opened = s; writeStored({...stored,def:s.def,personId:s.me.id,...(s.me.name?{displayName:s.me.name}:{})});setSession(s); })
      .catch((e: unknown) => {
        if (off) return;
        if ((e instanceof CapError && e.status === 401) || (e instanceof Error && /no longer matches/i.test(e.message))) { signedOutRef.current(); return; }
        setFailed(e instanceof Error && e.message ? e.message : "The Space did not answer.");
      });
    return () => { off = true; opened?.close("shell effect cleanup"); setSession(null); };
  }, [open, stored.baseUrl, stored.token, attempt]);

  useEffect(() => {
    if (!session) return undefined;
    // A Personal Space on several computers (lane l-multidevice): changes made here that no other computer of the Space has taken yet are the ones waiting. While this computer reaches
    // another one they are being sent; when it has reached none for a minute, the title bar says it is offline with them waiting.
    let peers = { waiting: 0, reached: true };
    const sync = (): void => { const up = session.runtime.connection.get() === "online"; hub.setOnline(up && peers.reached, peers.waiting); };
    sync();
    const offConn = session.runtime.connection.subscribe(sync);
    if (stored.def.kind !== "personal") return offConn;
    let off = false;
    const read = (): void => { void session.call("network.peers", {}).then((out) => {
      if (off) return;
      const o = out as { waiting?: number; syncedAt?: number; computers?: unknown[] };
      peers = { waiting: o.waiting ?? 0, reached: (o.computers?.length ?? 0) < 2 || (o.waiting ?? 0) === 0 || (typeof o.syncedAt === "number" && Date.now() - o.syncedAt < 60_000) };
      sync();
    }, () => undefined); };
    read();
    const t = setInterval(read, 10_000);
    return () => { off = true; clearInterval(t); offConn(); };
  }, [session, hub, stored.def.kind]);
  useEffect(() => {
    if (!session) return;
    let off = false;
    void loadRecent(session.runtime).then((hits) => { if (!off) recent.current = hits; });
    return () => { off = true; };
  }, [session]);
  // Invite People and Set Yourself Away reach the Space: a real link on the clipboard, and away stored where teammates see it (team-actions.ts)
  const team = useMemo(() => (session ? teamActions({ call: session.call, hub, space: session.def.name }) : null), [session, hub]);
  useEffect(() => {
    if (!team) return undefined;
    let off = false;
    void team.load().then((a) => { if (!off) flags.current.away = a; });
    return () => { off = true; };
  }, [team]);
  const setAway = useCallback((on: boolean): void => { flags.current.away = on; void team?.away(on); }, [team]);
  const teamProp = useMemo(() => (team ? { invite: () => { void team.invite(); }, away: setAway } : undefined), [team, setAway]);
  const search = useMemo(() => (session ? (flags.current.terminal = session.def.terminal, createGateSearch({ runtime: session.runtime, nav: hub, state: flags.current, recent: () => recent.current, viewer: () => ({ id: session.runtime.me.id, spaceId: session.def.spaceId, places: new Set(railPlaces(hub.rail())) }), ...(team ? { away: setAway } : {}) })) : null), [session, hub, team, setAway]);

  useEffect(() => {
    if (!session || stored.def.kind !== "team") return undefined;
    let off = false;
    session.call("settings.get", { key: "engine.local_runs" }).then((out) => { if (!off) setRunsOn((out as { row?: { value?: unknown } }).row?.value === false ? "space" : "device"); }, () => undefined);
    return () => { off = true; };
  }, [session, stored.def.kind]);
  const runsOnProp = useMemo(() => (session && stored.def.kind === "team" ? {
    value: runsOn,
    set: (v: "device" | "space") => { void session.call("settings.set", { key: "engine.local_runs", value: v === "device" }).then(() => setRunsOn(v), () => hub.flash("Could not change where chats run")); },
  } : undefined), [session, stored.def.kind, runsOn, hub]);
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

  // a tab opened on an item is named for it: read the item's name once the tab shows and give the tab that title
  useEffect(() => {
    if (!session) return;
    const target = parseHash(location.hash);
    const ask = target.subject ? titleAsk(target.subject, target.args) : screenAsk(target.screen, target.args) ?? typeTitleAsk(location.place, target.args);
    if (!ask) return;
    const key = tabKey(location.place, location.hash);
    return followTitle(session, ask, (t, empty) => hub.retitle(key, t, empty));
  }, [session, hub, location.place, location.hash]);

  // Inbox is on the rail once something flows in: the answer follows the mailbox, calendar and number reads (and their change events), and is kept for the next launch
  useEffect(() => {
    if (!session) return undefined;
    const store = tabsStorage();
    const me = session.me.id;
    const space = session.def.spaceId;
    const was = hub.session().def.inbox;
    if (was === undefined) delete flags.current.inbox; else flags.current.inbox = was;
    return followInboxSources(session.hooks, me, (has) => {
      flags.current.inbox = has;
      rememberInbox(store, me, space, has);
      const joins = has && hub.session().def.inbox === false;
      hub.setInbox(has, joins ? { tip: takeInboxTip(store, me, space) ? INBOX_TIP : null } : undefined);
    });
  }, [session, hub]);

  // the Space image follows Console: the tile's own read (spaces.switcher) names the image file, and only a different file fetches the picture (spaces.image); this device keeps it for the next launch
  useEffect(() => {
    if (!session) return undefined;
    const q = session.hooks.capQuery<{ logoFileId?: string }>("spaces.switcher");
    let asked: string | null | undefined;
    const read = (): void => {
      const s = q.getSnapshot();
      if (s.status !== "ready") return;
      const want = s.data.logoFileId ?? null;
      const have = hub.session().def.imageKey ?? null;
      if (want === have || want === asked) return;
      asked = want;
      const keep = (face: { image: string; imageKey: string } | null): void => {
        hub.setFace(face);
        const now = readStored(undefined, stored.baseUrl);
        if (now && now.token === stored.token) { const { image: _i, imageKey: _k, ...def } = now.def; writeStored({ ...now, def: face ? { ...def, ...face } : def }); }
      };
      if (want === null) { keep(null); return; }
      void (session.call("spaces.image", { known: have ?? undefined }) as Promise<{ logoFileId?: string; image?: string }>).then((out) => {
        if (out.logoFileId === undefined) keep(null);
        else if (typeof out.image === "string") keep({ image: out.image, imageKey: out.logoFileId });
      }, () => { asked = undefined; });
    };
    const off = q.subscribe(read);
    read();
    return off;
  }, [session, hub, stored.baseUrl, stored.token]);

  // the one badge: what waits on this person, from the one count, on the same tick as everything else on screen
  const [needsYou, setNeedsYou] = useState(0);
  useEffect(() => {
    if (!session) return undefined;
    const q = session.hooks.capQuery<{ count: number }>("tasks.count_needs_you");
    const read = (): void => { const s = q.getSnapshot(); if (s.status === "ready") { setNeedsYou(s.data.count); hub.count("chats", s.data.count); } };
    const off = q.subscribe(read);
    read();
    return off;
  }, [session, hub]);

  // the quiet dot on Chats: anything unread for this person (a chat, a channel, a thread they are in), from the same live reads the Chats list draws, so it clears when they read it
  useEffect(() => {
    if (!session) return undefined;
    const recent = session.hooks.capQuery<RecentOut>("chat.recent", { filter: "all" });
    const channels = session.hooks.capQuery<{ channels: readonly { unread: number }[] }>("channels.list", {});
    const read = (): void => {
      const r = recent.getSnapshot(), c = channels.getSnapshot();
      hub.dot("chats", anyUnread(r.status === "ready" ? r.data : null, c.status === "ready" ? c.data.channels : []));
    };
    const offs = [recent.subscribe(read), channels.subscribe(read)];
    read();
    return () => { for (const off of offs) off(); };
  }, [session, hub]);

  // the quiet dot on Settings: a newer Vyre waits to install (the person turned automatic updates off, or the start did not hear in time); it clears when it installs
  useEffect(() => {
    const read = (): void => hub.dot("settings", updateWaiting(updateState()));
    const off = subscribeUpdates(read);
    read();
    return off;
  }, [hub]);

  const purge = useMemo<ShellPurge | undefined>(() => (session ? {
    client: webPurgeClient({ deviceId: "web", call: session.call, wipe: () => { wipeBrowserStorage(); clearStored(); }, done: () => onSignedOut() }),
    subscribe: (l) => session.onPurge(l),
  } : undefined), [session, onSignedOut]);
  useEffect(() => location.place === "console" && purge ? watchPurge(purge, (e) => hub.flash(`Couldn't remove this device's data: ${e instanceof Error ? e.message : "try again"}`)) : undefined, [location.place, purge, hub]);
  // The Console is a Team Space place. A Personal Space has none, so a saved or stale address that names it goes to Chats, never to a page with no way back.
  const deadConsole = location.place === "console" && stored.def.kind === "personal";
  useEffect(() => { if (deadConsole) hub.go("chats"); }, [deadConsole, hub]);
  // console.<address> is the Console's own door: whatever a saved session last had open, this address opens the Console
  const consoleDoor = onConsoleHost() && stored.def.kind !== "personal";
  useEffect(() => { if (consoleDoor && location.place !== "console") hub.go("console"); }, [consoleDoor, location.place, hub]);
  const renderPlace = (ctx: PlaceContext): ReactElement => failed !== null && session === null
    ? <States kind="error" message={`Couldn't reach ${stored.def.name}`} cause={failed} next="Try again" retryable onRetry={() => setAttempt((n) => n + 1)} />
    : <PlaceHost place={ctx.place} runtime={session?.runtime ?? null} hash={ctx.hash} opened={(t) => { const next = formatHash(t); if (next !== ctx.hash) hub.move(ctx.place, next); }} />;
  const signOut = (): void => {
    forgetKey(); void dropKeyOnOwnNode(stored.baseUrl, stored.token).catch(() => undefined); void unlinkComputer(stored);
    void session?.call("identity.sign_out", {}).catch(() => undefined);
    onSignedOut("manual");
  };
  const lock=():void=>{
    const identity=lockedIdentity({...stored,name:session?.me.name??stored.def.name});
    storeLock(identity);clearStored();
    forgetKey();void dropKeyOnOwnNode(stored.baseUrl,stored.token).catch(()=>undefined);void unlinkComputer(stored);
    void session?.call("identity.sign_out",{}).catch(()=>undefined);
    if(onLocked)onLocked(identity);else onSignedOut("manual");
  };
  const selectSpace=(id:string):void=>{if(id===stored.def.spaceId)return;const target=catalogue.find(item=>item.def.spaceId===id);if(!target||!onSwitchSpace)return;sessionTheme(target,false);onSwitchSpace(id);};
  const renderNewTab = (): ReactElement => (search ? <NewTabSearch data={search} /> : <States kind="empty" title="Open anything, or start something" icon="search" />);
  // the onboarding screen opens over whatever the shell shows, the first time a person enters a Space and when asked
  // the Personal Space on this computer, so a Team Space can offer "use the same AI account" (never copied without a yes)
  const personalCall = useMemo(() => { const p = catalogue.find((item) => item.def.kind === "personal" && item.def.spaceId !== stored.def.spaceId && isLoopbackUrl(item.baseUrl)); return p ? createCapCaller({ baseUrl: p.baseUrl, token: () => p.token }) : null; }, [catalogueKey, stored.def.spaceId]);
  // what needs me (replies, mentions, held approvals, alerts) and an update that is ready are persisting notices in the top bar's slot; pressing one opens what it is about
  const banners = useMemo<NotificationNoticesProps | null>(() => (session ? {
    query: (cap, input) => session.hooks.capQuery(cap, input),
    call: (cap, input) => session.call(cap, input),
    open: (t) => { if (t.subject) session.runtime.open({ subject: t.subject }); else if (t.place) hub.go(t.place as PlaceId); },
  } : null), [session, hub]);
  useNotificationNotices(banners);
  const updateSource = useMemo<UpdateSource | null>(() => {
    const u = desktopUpdates();
    if (!u) return null;
    return {
      state: updateState, subscribe: subscribeUpdates,
      install: async () => {
        const check = updateState().check;
        if (check) noteUpdateFrom(localStore(), check.current);
        setUpdateState({ installing: true });
        try { await u.install(() => undefined); } catch { /* the Settings page says it did not finish */ } finally { try { localStore()?.removeItem(FROM_KEY); } catch { /* nothing kept */ } setUpdateState({ installing: false }); }
      },
    };
  }, []);
  useUpdateNotice(updateSource);
  const wrap = (el: ReactElement): ReactElement => <OnboardingHost call={session?.call ?? null} space={{ kind: stored.def.kind === "personal" ? "personal" : "team", name: stored.def.name }} mac={isMacShell()} runtime={session?.runtime ?? null} person={session?.me.id ?? null} personName={session?.me.name ?? null} address={stored.baseUrl} personalCall={personalCall} onGo={(place, hash) => hub.go(place as PlaceId, hash ?? "")} {...(onAddSpace?{onAddSpace}:{})}><>{el}<VaultUnlockHost /><ReportHost call={session?.call ?? null} place={location.place} /></></OnboardingHost>;
  if (deadConsole) return <View testID="console-redirect" style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  // on a computer the Console is a place in the shell; at its own address nothing surrounds it. In the app on a phone it is not there (owner ruling, 3 Nov): PhoneHost draws the Chat-about-it line
  if (consoleDoor && location.place !== "console") return <View testID="console-redirect" style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  if (location.place === "console" && consoleDoor) return wrap(<ConsoleAlone value><HubProvider hub={hub}>{renderPlace({ place: "console", hash: location.hash } as PlaceContext)}</HubProvider></ConsoleAlone>);
  if (narrow) return wrap(<Suspense fallback={<View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />}><PhoneHost session={session} location={{ place: location.place, hash: location.hash }} needsYou={needsYou} registerGo={registerGo} onSignOut={signOut} onLock={lock} {...(onSwitchSpace?{onSwitchSpace:selectSpace}:{})} {...(onAddSpace?{onAddSpace}:{})} /></Suspense>);
  return wrap(
    <>
      <Shell hub={hub} {...(teamProp ? { team: teamProp } : {})} {...(session ? { me: { id: session.me.id, name: session.me.name } } : {})} onOpenMe={() => hub.go("settings", "profile")} {...(runsOnProp ? { runsOn: runsOnProp } : {})} {...(theme?{theme}:{})} {...(onSwitchSpace?{onSwitchSpace:selectSpace}:{})} renderPlace={renderPlace} renderNewTab={renderNewTab} onSearch={() => setSearchOpen(true)} onSpaceAction={(a) => { if (a === "sign-out") signOut(); else if(a==='lock')lock();else if(a==='add')onAddSpace?.(); }} {...(phone ? { phone: { device: phone.device, data: phone.data } } : {})} {...(purge ? { purge } : {})} />
      {searchOpen && search ? <CmdK data={search} onClose={() => setSearchOpen(false)} onTiming={(name, ms) => { if (name === "local" && session) speed.record(session.runtime.space.id, "search", ms); }} /> : null}
    </>
  );
}
