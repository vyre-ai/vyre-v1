import { NewTabSidebar } from "../tabs/NewTabSidebar.tsx";
import { takeOpenHow } from "../tabs/open-how.ts";
import { lookApplier, startupPlan } from "../providers/settings-look.ts";
import { sessionTheme } from "./space-theme.ts";
import { sessionCatalogue } from "./space-catalog.ts";
// The authenticated application shell. Kept behind SessionGate's lazy boundary so a signed-out
// first paint does not parse the screen registry, virtual lists, command surface, or place chrome.
import { REFUSED_CHAT_TAB, staleRefusalTab } from "../tabs/titles.ts";
import { osShell } from "../notifications/os-shell.ts";
import { windowFocused } from "../notifications/os-banner.ts";
import { OpenLink } from "../reach/OpenLink.tsx";
import { subscribeUpdates, updateState, updateWaiting } from "../../startup/update/store.ts";
import { ConsoleAlone, onConsoleHost } from "../console-host.ts";
import { speed } from "../../speed/recorder.ts";
import { PressProbe } from "../../../../../ui/src/theme/pending.ts";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { lazyPart } from "../../../../../ui/src/Lazy/index.tsx";
import type { ReactElement } from "react";
import { View, useWindowDimensions } from "react-native";
import { States } from "../../../../../ui/src/States/index.tsx";
import { forgetKey } from "../../../../../client/src/gateway/key-keeper.ts";
import { dropKeyOnOwnNode } from "../../../../../client/src/gateway/local-key.ts";
import { CmdK, NewTabSearch } from "../cmdk/CmdK.tsx";
import { PendingChat } from "../../places/chats/landing/PendingChat.tsx";
import { createGateSearch, loadRecent } from "../cmdk/gate.ts";
import type { Hit } from "../cmdk/model.ts";
import { formatHash } from "../hash/hash.ts";
import { followAllTabs } from "../tabs/titles.ts";
import { railPlaces } from "../rail/kits.ts";
import type { PlaceId } from "../rail/kits.ts";
import { createShellHub } from "../spaces/hub.ts";
import { INBOX_TIP, followInboxSources, rememberInbox, seedInbox, takeInboxTip } from "../rail/inbox-sources.ts";
import type { ShellHub } from "../spaces/hub.ts";
import { removeSpaceFromBrowser, watchPurge, webPurgeClient } from "../spaces/purge.ts";
import type { ShellPurge } from "../spaces/purge.ts";
import { HubProvider, useHubState } from "../spaces/context.tsx";
import { Shell } from "../spaces/Shell.tsx";
import { PROFILE_HASH } from "../tabs/store.ts";
import type { PlaceContext } from "../spaces/Shell.tsx";
import { CapError, createCapCaller } from "./caps.ts";
import { isLoopbackUrl } from "../../../../../client/src/gateway/local-key.ts";
import { linkComputer, unlinkComputer } from "./computer-link.ts";
import { PHONE_BELOW } from "./mobile-map.ts";
import { openPhone } from "./phone.ts";
import { readUrlIntoHub } from "./url.ts";
import type { LoadVoiceDevice, Phone } from "./phone.ts";
import { PlaceHost, routeIdOf } from "./PlaceHost.tsx";
import { loadPlace } from "../../startup/places.ts";
import { OnboardingHost } from "../../onboarding/OnboardingHost.tsx";
import { revokeToken } from "./revoke-token.ts";
import type { OpenSessionOptions, RealSession } from "./session.ts";
import { readStored, verifyStoredSession, writeStored } from "./stored.ts";
import { kept as keeper } from "./kept.ts";
import type { StoredSession } from "./stored.ts";
import { VaultUnlockHost } from "./VaultUnlockHost.tsx";
import { SignHost } from "./SignHost.tsx";
import { teamActions } from "./team-actions.ts";
import { ReportHost } from "../report/ReportHost.tsx";
import { useNotificationNotices, useUpdateNotice } from "../noticeslot/bridge.ts";
import type { NotificationNoticesProps, UpdateSource } from "../noticeslot/bridge.ts";
import { desktopUpdates, localStore, setUpdateState } from "../../startup/update/store.ts";
import { FROM_KEY, noteUpdateFrom } from "../../startup/update/model.ts";
import { isMacShell } from "./entry.ts";
import { anyUnread } from "../../places/chats/sidebar/model.ts";
import type { RecentOut } from "../../places/chats/sidebar/model.ts";

const PhoneHost = lazyPart(() => import("./PhoneHost.tsx").then((m) => ({ default: m.PhoneHost })));

const tabsStorage = () => {
  const ls = (
    globalThis as { localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void } }
  ).localStorage;
  return ls
    ? {
        getItem: (k: string) => {
          try {
            return ls.getItem(k);
          } catch {
            return null;
          }
        },
        setItem: (k: string, v: string) => {
          try {
            ls.setItem(k, v);
          } catch {
            /* blocked */
          }
        },
      }
    : null;
};

export interface ShellHostProps {
  stored: StoredSession;
  open: (o: OpenSessionOptions) => Promise<RealSession>;
  onSignedOut: (why?: "manual") => void;
  onHub: (h: ShellHub | null) => void;
  hub?: ShellHub;
  initialSearchOpen?: boolean;
  voice?: LoadVoiceDevice | undefined;
  onAddSpace?: () => void;
  /** The way out of a Space that will not open, besides trying again: the list of Spaces this device has used. */
  onYourSpaces?: () => void;
  onSwitchSpace?: (spaceId: string) => void;
  /** The saved Space could not be opened (not a sign-out): the gate asks where the Space is now. */
  onUnreachable?: () => void;
}

export function ShellHost({
  stored,
  open,
  onSignedOut,
  onHub,
  hub: given,
  initialSearchOpen = false,
  voice,
  onAddSpace,
  onYourSpaces,
  onSwitchSpace,
  onUnreachable,
}: ShellHostProps): ReactElement {
  const navRef = useRef<ShellHub | null>(null);
  const signedOutRef = useRef(onSignedOut);
  signedOutRef.current = onSignedOut;
  const unreachableRef = useRef(onUnreachable);
  unreachableRef.current = onUnreachable;
  const phoneGo = useRef<((p: PlaceId, hash: string) => void) | null>(null);
  const width = useWindowDimensions().width;
  const narrow = width > 0 && width < PHONE_BELOW;
  const registerGo = useCallback((go: ((p: PlaceId, hash: string) => void) | null) => {
    phoneGo.current = go;
  }, []);
  const [openedSession, setSession] = useState<RealSession | null>(null);
  const session =
    openedSession?.def.spaceId === stored.def.spaceId && openedSession.baseUrl === stored.baseUrl
      ? openedSession
      : null;
  const activeStored = session ? { ...stored, def: session.def } : stored;
  const catalogue = sessionCatalogue(activeStored);
  const catalogueKey = JSON.stringify(
    catalogue.map((item) => {
      const { image: _image, ...def } = item.def;
      return [item.baseUrl, item.personId, def];
    }),
  ); // the image's file id (imageKey) stands for its bytes, so the key stays small
  const hub = useMemo(() => {
    if (given) {
      navRef.current = given;
      return given;
    }
    // Inbox starts where this device last saw it for this person and Space, so the rail does not jump while the reads answer
    const h = createShellHub({
      spaces: catalogue.map((item) => ({
        ...seedInbox(item.def, tabsStorage(), item.personId),
        starred: item.def.spaceId === stored.def.spaceId,
      })),
      openId: stored.def.spaceId,
      personId: stored.personId,
      personIds: Object.fromEntries(catalogue.map((item) => [item.def.spaceId, item.personId])),
      deviceId: "web",
      storage: tabsStorage(),
    });
    // a link in the address wins over the restored tabs from the first frame, so nothing else is drawn first (UrlSync takes over from here)
    const page = (globalThis as { location?: { pathname?: string; hash?: string } }).location;
    if (page?.pathname !== undefined && page.hash !== undefined)
      readUrlIntoHub(h, { pathname: page.pathname, hash: page.hash }, { load: true });
    navRef.current = h;
    return h;
  }, [given, catalogueKey, stored.def.spaceId, stored.personId]);
  const location = useHubState(hub);
  const theme = useMemo(() => {
    const th = sessionTheme(activeStored);
    {
      const plan = startupPlan(
        activeStored.personId,
        (globalThis as { location?: { search?: string } }).location?.search ?? "",
      );
      if (plan.look)
        lookApplier({ me: { id: activeStored.personId }, space: { id: activeStored.def.spaceId } } as never).apply(
          plan.look,
          { skin: plan.paintSkin },
        );
    }
    return th;
  }, [stored.personId, stored.def.spaceId, activeStored.def.skinDefault]);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // The session opens from what this device kept of the Space (session/kept.ts), unless that was tried and the Space said otherwise: then it opens the plain way, which reports what is wrong.
  const plainOpen = useRef(false);
  const reopened = useRef(0);
  // This device kept this session's first screen: until the session is there (a few ms: it opens from the kept facts) the place is not drawn at all, so the loading frame is never the first
  // thing under the launch screen. It is given up after a moment, and the place then draws its loading frame as it always did.
  const [keptComing, setKeptComing] = useState(() =>
    keeper().has({ baseUrl: stored.baseUrl, personId: stored.personId, spaceId: stored.def.spaceId }),
  );
  useEffect(() => {
    if (!keptComing) return undefined;
    const t = setTimeout(() => setKeptComing(false), 400);
    return () => clearTimeout(t);
  }, [keptComing]);
  const [searchOpen, setSearchOpen] = useState(initialSearchOpen);
  // where new chats run by default in a Team Space: this computer (engine.local_runs on) or the Space (off)
  const [runsOn, setRunsOn] = useState<"device" | "space">("device");
  const recent = useRef<readonly Hit[]>([]);
  const flags = useRef<{ away: boolean; offline: boolean; terminal?: boolean; inbox?: boolean }>({
    away: false,
    offline: false,
  });

  useEffect(() => {
    onHub(hub);
    return () => onHub(null);
  }, [hub, onHub]);
  // this computer runs the person's own chats in each Team Space they are signed in to here (computer-link.ts): at app start and whenever the signed-in Spaces change
  useEffect(() => {
    void linkComputer(catalogue);
  }, [catalogueKey, stored.token]);
  useEffect(() => {
    let off = false;
    let opened: RealSession | null = null;
    setFailed(null);
    const options: OpenSessionOptions = {
      baseUrl: stored.baseUrl,
      token: stored.token,
      ...(stored.username ? { username: stored.username } : {}),
      spaceCards: catalogue.map((item) => item.def),
      ...(stored.syncEpoch !== undefined ? { syncEpoch: stored.syncEpoch } : {}),
      onSyncEpoch: (e) => {
        const now = readStored(undefined, stored.baseUrl);
        if (now && now.token === stored.token) writeStored({ ...now, syncEpoch: e });
      },
      notice: (text) => {
        navRef.current?.flash(text);
      },
      navigate: (p, hash, background, into) => {
        // how the person pressed (Cmd, the middle button, a menu's "Open in new tab") is read here once; no place reads the keyboard (tabs/open-how.ts, open-rule.ts)
        const how = takeOpenHow();
        const behind = background === true || how === "behind";
        if (into !== undefined) navRef.current?.fill(p, hash, undefined, into);
        else navRef.current?.go(p, hash, behind, false, how === "tab");
        if (phoneGo.current && !behind) phoneGo.current(p, hash);
      },
      shell: (screen, args) => {
        const h = navRef.current;
        if (!h) return;
        if (screen === "spaces.switcher" && typeof args.id === "string" && onSwitchSpace) {
          onSwitchSpace(args.id);
          return;
        }
        if (screen === "shell.cmdk") setSearchOpen(true);
        else if (screen === "shell.new-tab") h.newTab();
        else h.flash("Switch Spaces from the tile at the top of the rail");
      },
      onSignedOut: () => signedOutRef.current(),
      warmPlace: (p) => {
        const id = routeIdOf(p);
        if (id !== null) void loadPlace(id).catch(() => undefined);
      },
    };
    const whose = { baseUrl: stored.baseUrl, personId: stored.personId, spaceId: stored.def.spaceId };
    const failedOpen = (e: unknown): void => {
      if (off) return;
      if ((e instanceof CapError && e.status === 401) || (e instanceof Error && /no longer matches/i.test(e.message))) {
        signedOutRef.current();
        return;
      }
      setFailed(e instanceof Error && e.message ? e.message : "The Space did not answer.");
      // the gate asks where the Space is now: it may only need one more try, or it moved to Vyre's relay and opens in the browser (SessionGate shellUnreachable)
      unreachableRef.current?.();
    };
    const openPlain = (): void => {
      setKeptComing(false);
      void verifyStoredSession({
        stored,
        open: () => open({ ...options, kept: keeper().session(whose) }),
        getSpace: async (s) => {
          const space = ((await s.call("spaces.get", {})) as { space: { id: string; fingerprint: string } }).space;
          return { id: space.id, marker: space.fingerprint };
        },
      })
        .then((s) => {
          if (off) {
            s.close("superseded before it opened");
            return;
          }
          opened = s;
          writeStored({ ...stored, def: s.def, personId: s.me.id, ...(s.me.name ? { displayName: s.me.name } : {}) });
          setSession(s);
        })
        .catch(failedOpen);
    };
    // What this device kept of the Space for this person: the session opens from it in this frame, the first screen is drawn from it, and the Space is asked behind that screen (r41). The kept
    // facts must be this saved sign-in's own (the same person, Space and marker); anything else is forgotten and the session opens the plain way.
    const openKept = (): boolean => {
      const mine = keeper().session(whose);
      const boot = mine.boot() as {
        who?: { principal?: { id?: string } };
        space?: { id?: string; fingerprint?: string };
      } | null;
      if (boot === null) return false;
      if (
        boot.who?.principal?.id !== stored.personId ||
        boot.space?.id !== stored.def.spaceId ||
        boot.space?.fingerprint !== stored.marker
      ) {
        keeper().forget(whose);
        return false;
      }
      void open({
        ...options,
        kept: mine,
        bootFromKept: true,
        onBootChanged: () => {
          if (off) return;
          // a role, the Space's name, Kit or image changed since: open again from what the Space says now (once; a second change in a row opens the plain way)
          reopened.current += 1;
          if (reopened.current > 1) plainOpen.current = true;
          setAttempt((n) => n + 1);
        },
      })
        .then((s) => {
          if (off) {
            s.close("superseded before it opened");
            return;
          }
          opened = s;
          setSession(s);
          s.confirmed.then(
            (c) => {
              if (off) return;
              if (c.personId !== stored.personId || c.spaceId !== stored.def.spaceId || c.marker !== stored.marker) {
                keeper().forget(whose);
                signedOutRef.current();
                return;
              }
              writeStored({
                ...stored,
                def: s.def,
                personId: s.me.id,
                ...(s.me.name ? { displayName: s.me.name } : {}),
              });
            },
            (e: unknown) => {
              if (off) return;
              if (e instanceof CapError && e.status === 401) {
                signedOutRef.current();
                return;
              }
              // the Space refused in some other way: open the plain way, which says what is wrong
              plainOpen.current = true;
              setAttempt((n) => n + 1);
            },
          );
        })
        .catch(() => {
          if (off) return;
          plainOpen.current = true;
          openPlain();
        });
      return true;
    };
    // the kept record is read from the browser's store as the page starts (startup/warm.ts); it is waited for a moment at most
    void Promise.race([
      plainOpen.current ? Promise.resolve(null) : keeper().warm(whose),
      new Promise<null>((r) => setTimeout(() => r(null), 150)),
    ]).then(() => {
      if (off) return;
      if (plainOpen.current || !openKept()) openPlain();
    });
    return () => {
      off = true;
      opened?.close("shell effect cleanup");
      setSession(null);
    };
  }, [open, stored.baseUrl, stored.token, attempt]);

  // the reads a place watches are remembered as that place's, so pointing at it in the rail later brings them up to date (remote-hooks scope)
  useEffect(() => {
    session?.shownPlace(location.place);
  }, [session, location.place]);
  // Once the Space is open and the first screen has had its time, the code of every other place in the rail is loaded, one after another while nothing else is going on: the first visit to a
  // place then waits for its data alone (r41: a first visit took 310 to 350 ms, a second 80 to 100).
  useEffect(() => {
    if (!session) return undefined;
    let off = false;
    const idle =
      (globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number })
        .requestIdleCallback ?? ((f: () => void) => setTimeout(f, 200) as unknown as number);
    const places = railPlaces(hub.rail());
    let at = 0;
    const next = (): void => {
      if (off || at >= places.length) return;
      const id = routeIdOf(places[at++]!);
      const go = (): void => void idle(next, { timeout: 2000 });
      if (id === null) go();
      else loadPlace(id).then(go, go);
    };
    const start = setTimeout(() => void idle(next, { timeout: 2000 }), 2500);
    return () => {
      off = true;
      clearTimeout(start);
    };
  }, [session, hub]);

  useEffect(() => {
    if (!session) return undefined;
    // A Personal Space on several computers (lane l-multidevice): changes made here that no other computer of the Space has taken yet are the ones waiting. While this computer reaches
    // another one they are being sent; when it has reached none for a minute, the title bar says it is offline with them waiting.
    let peers = { waiting: 0, reached: true };
    const sync = (): void => {
      const up = session.runtime.connection.get() === "online";
      hub.setOnline(up && peers.reached, peers.waiting);
    };
    sync();
    const offConn = session.runtime.connection.subscribe(sync);
    if (stored.def.kind !== "personal") return offConn;
    let off = false;
    const read = (): void => {
      void session.call("network.peers", {}).then(
        (out) => {
          if (off) return;
          const o = out as { waiting?: number; syncedAt?: number; computers?: unknown[] };
          peers = {
            waiting: o.waiting ?? 0,
            reached:
              (o.computers?.length ?? 0) < 2 ||
              (o.waiting ?? 0) === 0 ||
              (typeof o.syncedAt === "number" && Date.now() - o.syncedAt < 60_000),
          };
          sync();
        },
        () => undefined,
      );
    };
    read();
    const t = setInterval(read, 10_000);
    return () => {
      off = true;
      clearInterval(t);
      offConn();
    };
  }, [session, hub, stored.def.kind]);
  useEffect(() => {
    if (!session) return;
    let off = false;
    void loadRecent(session.runtime).then((hits) => {
      if (!off) recent.current = hits;
    });
    return () => {
      off = true;
    };
  }, [session]);
  // Invite People and Set Yourself Away reach the Space: a real link on the clipboard, and away stored where teammates see it (team-actions.ts)
  const team = useMemo(
    () => (session ? teamActions({ call: session.call, hub, space: session.def.name }) : null),
    [session, hub],
  );
  useEffect(() => {
    if (!team) return undefined;
    let off = false;
    void team.load().then((a) => {
      if (!off) flags.current.away = a;
    });
    return () => {
      off = true;
    };
  }, [team]);
  const setAway = useCallback(
    (on: boolean): void => {
      flags.current.away = on;
      void team?.away(on);
    },
    [team],
  );
  const teamProp = useMemo(
    () =>
      team
        ? {
            invite: () => {
              void team.invite();
            },
            away: setAway,
          }
        : undefined,
    [team, setAway],
  );
  const search = useMemo(
    () =>
      session
        ? ((flags.current.terminal = session.def.terminal),
          createGateSearch({
            runtime: session.runtime,
            nav: hub,
            state: flags.current,
            recent: () => recent.current,
            viewer: () => ({
              id: session.runtime.me.id,
              spaceId: session.def.spaceId,
              places: new Set(railPlaces(hub.rail())),
            }),
            console: () => session.def.console === true,
            ...(team ? { away: setAway } : {}),
            retitle: (title) => hub.retitle(hub.session().tabs.state().active, title),
            fill: (place, hash, title, from) => hub.fill(place, hash, title, from),
            activeTab: () => hub.session().tabs.state().active,
            // the Space's own address, and the page's address when it differs (a Space reached by two names): itemLink writes the page's address on the web
            origins: () => {
              const here = (globalThis as { location?: { origin?: string } }).location?.origin;
              return here && /^https?:/.test(here) ? [stored.baseUrl, here] : [stored.baseUrl];
            },
            signOut: () => signOutRef.current(),
          }))
        : null,
    [session, hub, team, setAway],
  );

  useEffect(() => {
    if (!session || stored.def.kind !== "team") return undefined;
    let off = false;
    session.call("settings.get", { key: "engine.local_runs" }).then(
      (out) => {
        if (!off) setRunsOn((out as { row?: { value?: unknown } }).row?.value === false ? "space" : "device");
      },
      () => undefined,
    );
    return () => {
      off = true;
    };
  }, [session, stored.def.kind]);
  const runsOnProp = useMemo(
    () =>
      session && stored.def.kind === "team"
        ? {
            value: runsOn,
            set: (v: "device" | "space") => {
              void session.call("settings.set", { key: "engine.local_runs", value: v === "device" }).then(
                () => setRunsOn(v),
                () => hub.flash("Could not change where chats run"),
              );
            },
          }
        : undefined,
    [session, stored.def.kind, runsOn, hub],
  );
  const [phone, setPhone] = useState<Phone | undefined>(undefined);
  const connections = useMemo(
    () =>
      session
        ? session.hooks.capQuery<{ connections: { connector: string; state: string }[] }>("connections.list", {})
        : null,
    [session],
  );
  const telephony = useSyncExternalStore(
    connections ? connections.subscribe : () => () => undefined,
    () => {
      const s = connections?.getSnapshot();
      return (
        s?.status === "ready" &&
        s.data.connections.some((c) => c.state === "active" && /twilio|telephony/i.test(c.connector))
      );
    },
    () => false,
  );
  useEffect(() => {
    if (!session || !telephony) return undefined;
    let off = false;
    let made: Phone | undefined;
    openPhone(session, { loadDevice: voice, openConversation: (id) => navRef.current?.go("inbox", id) })
      .then((p) => {
        if (off) {
          p?.close();
          return;
        }
        made = p;
        setPhone(p);
      })
      .catch(() => undefined);
    return () => {
      off = true;
      made?.close();
      setPhone(undefined);
    };
  }, [session, voice, telephony]);

  // a tab has no title of its own: it reads as the current name of the item it shows, for EVERY tab and not only the selected one, so a chat that gets its real title (or is renamed) while another
  // tab is selected is renamed on its tab at once, and a tab restored from the last launch reads the current name, not the one it was saved with
  useEffect(() => {
    if (!session) return undefined;
    return followAllTabs(
      session,
      { tabs: () => hub.session().tabs.state().tabs, subscribe: (l) => hub.subscribe(l) },
      (key, t, empty) => {
        hub.retitle(key, t, empty);
        // a refused link reuses the one refusal tab instead of adding another
        if (t === REFUSED_CHAT_TAB) {
          const now = hub.session().tabs.state();
          const drop = staleRefusalTab(now.tabs, key, now.active);
          if (drop !== null) hub.session().tabs.close(drop);
        }
      },
    );
  }, [session, hub]);

  // Inbox is on the rail once something flows in: the answer follows the mailbox, calendar and number reads (and their change events), and is kept for the next launch
  useEffect(() => {
    if (!session) return undefined;
    const store = tabsStorage();
    const me = session.me.id;
    const space = session.def.spaceId;
    const was = hub.session().def.inbox;
    if (was === undefined) delete flags.current.inbox;
    else flags.current.inbox = was;
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
        if (now && now.token === stored.token) {
          const { image: _i, imageKey: _k, ...def } = now.def;
          writeStored({ ...now, def: face ? { ...def, ...face } : def });
        }
      };
      if (want === null) {
        keep(null);
        return;
      }
      void (
        session.call("spaces.image", { known: have ?? undefined }) as Promise<{ logoFileId?: string; image?: string }>
      ).then(
        (out) => {
          if (out.logoFileId === undefined) keep(null);
          else if (typeof out.image === "string") keep({ image: out.image, imageKey: out.logoFileId });
        },
        () => {
          asked = undefined;
        },
      );
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
    const read = (): void => {
      const s = q.getSnapshot();
      if (s.status === "ready") {
        setNeedsYou(s.data.count);
      }
    };
    const off = q.subscribe(read);
    read();
    return off;
  }, [session, hub]);

  // the rail's one number: what is addressed to this person in Chats (waiting tasks, mentions, new direct messages), the same sum the sidebar's own marks make, read from the sidebar's own answer so the two cannot disagree
  useEffect(() => {
    if (!session) return undefined;
    const q = session.hooks.capQuery<{ rail: number }>("chats.sidebar", {});
    const read = (): void => {
      const s = q.getSnapshot();
      if (s.status === "ready") hub.count("chats", s.data.rail);
    };
    const off = q.subscribe(read);
    read();
    return off;
  }, [session, hub]);

  // the quiet dot on Chats: anything unread for this person (a chat, a channel, a thread they are in), from the same live reads the Chats list draws, so it clears when they read it
  useEffect(() => {
    if (!session) return undefined;
    const recent = session.hooks.capQuery<RecentOut>("chat.recent", { filter: "all" });
    const channels = session.hooks.capQuery<{
      channels: readonly { unread: number; channelId: string; mainThreadId: string }[];
    }>("channels.list", {});
    // what the person muted makes no dot, the same rule the Chats list uses (lane l-polish, one unread total)
    const mutes = session.hooks.capQuery<{ mutes?: readonly { target: { kind: string; id: string } }[] }>(
      "notifications.mute.list",
      {},
    );
    const read = (): void => {
      const r = recent.getSnapshot(),
        c = channels.getSnapshot(),
        m = mutes.getSnapshot();
      const muted = new Set(
        m.status === "ready" ? (m.data.mutes ?? []).map((x) => `${x.target.kind}:${x.target.id}`) : [],
      );
      hub.dot(
        "chats",
        anyUnread(r.status === "ready" ? r.data : null, c.status === "ready" ? c.data.channels : [], (kind, id) =>
          muted.has(`${kind}:${id}`),
        ),
      );
    };
    const offs = [recent.subscribe(read), channels.subscribe(read), mutes.subscribe(read)];
    read();
    return () => {
      for (const off of offs) off();
    };
  }, [session, hub]);

  // the quiet dot on Settings: a newer Vyre waits to install (the person turned automatic updates off, or the start did not hear in time); it clears when it installs
  useEffect(() => {
    const read = (): void => hub.dot("settings", updateWaiting(updateState()));
    const off = subscribeUpdates(read);
    read();
    return off;
  }, [hub]);

  const purge = useMemo<ShellPurge | undefined>(
    () =>
      session
        ? {
            client: webPurgeClient({
              deviceId: "web",
              call: session.call,
              // this Space only: the other Spaces signed in on this browser stay signed in (spaces/purge.ts says what is kept on purpose)
              wipe: () => removeSpaceFromBrowser(stored),
              done: () => onSignedOut(),
            }),
            subscribe: (l) => session.onPurge(l),
          }
        : undefined,
    [session, onSignedOut, stored.baseUrl, stored.def.spaceId, stored.personId],
  );
  useEffect(
    () =>
      location.place === "console" && purge
        ? watchPurge(purge, (e) =>
            hub.flash(`Couldn't remove this device's data: ${e instanceof Error ? e.message : "try again"}`),
          )
        : undefined,
    [location.place, purge, hub],
  );
  // The Console is a Team Space place. A Personal Space has none, so a saved or stale address that names it goes to Chats, never to a page with no way back.
  const deadConsole = location.place === "console" && stored.def.kind === "personal";
  useEffect(() => {
    if (deadConsole) hub.go("chats");
  }, [deadConsole, hub]);
  // console.<address> is the Console's own door: whatever a saved session last had open, this address opens the Console
  const consoleDoor = onConsoleHost() && stored.def.kind !== "personal";
  useEffect(() => {
    if (consoleDoor && location.place !== "console") hub.go("console");
  }, [consoleDoor, location.place, hub]);
  const renderPlace = (ctx: PlaceContext): ReactElement =>
    failed !== null && session === null ? (
      <States
        kind="error"
        message={`Couldn't reach ${stored.def.name}`}
        cause={failed}
        next="Try again"
        retryable
        onRetry={() => setAttempt((n) => n + 1)}
        {...(onYourSpaces ? { second: { label: "Your Spaces", onPress: onYourSpaces } } : {})}
      />
    ) : session === null && keptComing ? (
      <View testID="place-kept-wait" style={{ flex: 1, backgroundColor: "var(--win)" as string }} />
    ) : (
      <PlaceHost
        place={ctx.place}
        runtime={session?.runtime ?? null}
        hash={ctx.hash}
        {...(ctx.links === undefined ? {} : { links: ctx.links })}
        {...(ctx.reports === undefined ? {} : { reports: ctx.reports })}
        opened={(t) => {
          const next = formatHash(t);
          if (next !== ctx.hash) hub.move(ctx.place, next, true);
        }}
      />
    );
  // Pointing at a place, focusing it or pressing down on it starts its code and its first reads, so both are on their way before the press is let go (r41). Both are asked for once however often this runs.
  const sessionRef = useRef<RealSession | null>(null);
  sessionRef.current = session;
  const prefetchPlace = useCallback((place: PlaceId): void => {
    const id = routeIdOf(place);
    if (id !== null) void loadPlace(id).catch(() => undefined);
    sessionRef.current?.prefetchPlace(place);
  }, []);
  const signOutRef = useRef<() => void>(() => undefined);
  const signOut = (): void => {
    forgetKey(stored.token);
    void dropKeyOnOwnNode(stored.baseUrl, stored.token).catch(() => undefined);
    void unlinkComputer(stored);
    // always through the revoke queue (revoke-token.ts): sent now with the stored token, whether or not the session has opened; if it gets no answer (offline, the Space down, the page closed) it is sent again at the next start
    void revokeToken({ baseUrl: stored.baseUrl, token: stored.token, spaceId: stored.def.spaceId });
    onSignedOut("manual");
  };
  signOutRef.current = signOut;
  const selectSpace = (id: string): void => {
    if (id === stored.def.spaceId) return;
    const target = catalogue.find((item) => item.def.spaceId === id);
    if (!target || !onSwitchSpace) return;
    sessionTheme(target, false);
    onSwitchSpace(id);
  };
  const renderNewTab = (): ReactElement => (
    <>
      <NewTabSidebar places={[...hub.rail().top, ...hub.rail().bottom]} onGo={(place) => navRef.current?.go(place)} />
      {renderNewTabBody()}
    </>
  );
  const renderNewTabBody = (): ReactElement =>
    search ? (
      <NewTabSearch
        data={search}
        {...(session
          ? {
              chatView: (c, a) => (
                <PendingChat
                  title={c.title}
                  text={c.text}
                  files={[]}
                  lead={session.runtime.assistant.name}
                  phase={c.phase}
                  {...(session.runtime.turns
                    ? { live: { turns: session.runtime.turns, asker: session.runtime.me.id, since: c.since } }
                    : {})}
                  {...(c.note ? { note: c.note } : {})}
                  onRetry={a.retry}
                  onDiscard={a.discard}
                />
              ),
            }
          : {})}
      />
    ) : (
      <States kind="empty" title="Open anything, or start something" icon="search" />
    );
  // the onboarding screen opens over whatever the shell shows, the first time a person enters a Space and when asked
  // the Personal Space on this computer, so a Team Space can offer "use the same AI account" (never copied without a yes)
  const personalCall = useMemo(() => {
    const p = catalogue.find(
      (item) => item.def.kind === "personal" && item.def.spaceId !== stored.def.spaceId && isLoopbackUrl(item.baseUrl),
    );
    return p ? createCapCaller({ baseUrl: p.baseUrl, token: () => p.token }) : null;
  }, [catalogueKey, stored.def.spaceId]);
  // what needs me (replies, mentions, held approvals, alerts) and an update that is ready are persisting notices in the top bar's slot; pressing one opens what it is about
  // in the desktop app the same notices also reach the operating system's banner while the window is not in front ("<Space> needs you", no content), and the dock or taskbar badge shows the
  // Needs you count
  const shellOs = useMemo(() => osShell(), []);
  // the kinds the person keeps off the desktop ("Notify me on" without Desktop): no banner for them
  const offDesktop = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!session || !shellOs) return undefined;
    const q = session.hooks.capQuery<{ kinds: readonly { key: string; mine?: { channels?: readonly string[] } }[] }>(
      "notifications.kinds.list",
    );
    const read = (): void => {
      const s = q.getSnapshot();
      if (s.status === "ready")
        offDesktop.current = new Set(
          s.data.kinds
            .filter((k) => k.mine?.channels !== undefined && !k.mine.channels.includes("desktop"))
            .map((k) => k.key),
        );
    };
    const off = q.subscribe(read);
    read();
    return off;
  }, [session, shellOs]);
  const banners = useMemo<NotificationNoticesProps | null>(
    () =>
      session
        ? {
            query: (cap, input) => session.hooks.capQuery(cap, input),
            call: (cap, input) => session.call(cap, input),
            open: (t) => {
              if (t.subject) session.runtime.open({ subject: t.subject });
              else if (t.place) hub.go(t.place as PlaceId);
            },
            ...(shellOs
              ? {
                  os: {
                    view: () => ({
                      focused: windowFocused(),
                      address: stored.baseUrl,
                      spaceName: stored.def.name,
                      now: Date.now(),
                      allows: (kind) => !offDesktop.current.has(kind),
                    }),
                    show: (b) => shellOs.notify(b),
                  },
                }
              : {}),
          }
        : null,
    [session, hub, shellOs, stored.baseUrl, stored.def.name],
  );
  useEffect(() => {
    shellOs?.badge(needsYou);
  }, [shellOs, needsYou]);
  // signed out, or another Space or person (the shell is keyed by both, so it unmounts): the dock keeps no one's count
  useEffect(
    () => () => {
      shellOs?.badge(0);
    },
    [shellOs],
  );
  useNotificationNotices(banners);
  const updateSource = useMemo<UpdateSource | null>(() => {
    const u = desktopUpdates();
    if (!u) return null;
    return {
      state: updateState,
      subscribe: subscribeUpdates,
      install: async () => {
        const check = updateState().check;
        if (check) noteUpdateFrom(localStore(), check.current);
        setUpdateState({ installing: true });
        try {
          await u.install(() => undefined);
        } catch {
          /* the Settings page says it did not finish */
        } finally {
          try {
            localStore()?.removeItem(FROM_KEY);
          } catch {
            /* nothing kept */
          }
          setUpdateState({ installing: false });
        }
      },
    };
  }, []);
  useUpdateNotice(updateSource);
  // a link held from the address or the desktop acts here, where the open Space's runtime is: reach decides, then the page or the safe peek
  const wrap = (el: ReactElement): ReactElement => (
    <>
      {/* a pressed row is lit at once and its page is made after that frame (ui/theme/pending.ts) */}
      <PressProbe />
      {session ? <OpenLink hub={hub} rt={session.runtime} me={session.me.id} spaceId={session.def.spaceId} /> : null}
      <OnboardingHost
        call={session?.call ?? null}
        space={{ kind: stored.def.kind === "personal" ? "personal" : "team", name: stored.def.name }}
        mac={isMacShell()}
        runtime={session?.runtime ?? null}
        person={session?.me.id ?? null}
        personName={session?.me.name ?? null}
        address={stored.baseUrl}
        personalCall={personalCall}
        onGo={(place, hash) => hub.go(place as PlaceId, hash ?? "")}
        {...(onAddSpace ? { onAddSpace } : {})}
      >
        <>
          {el}
          <VaultUnlockHost />
          <SignHost rt={session?.runtime ?? null} />
          <ReportHost
            call={session?.call ?? null}
            place={location.place}
            mayReadPolicy={session?.runtime.permissions?.has("policy.manage") ?? true}
          />
        </>
      </OnboardingHost>
    </>
  );
  if (deadConsole)
    return <View testID="console-redirect" style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  // on a computer the Console is a place in the shell; at its own address nothing surrounds it. In the app on a phone it is not there (owner ruling, 3 Nov): PhoneHost draws the Chat-about-it line
  if (consoleDoor && location.place !== "console")
    return <View testID="console-redirect" style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  if (location.place === "console" && consoleDoor)
    return wrap(
      <ConsoleAlone value>
        <HubProvider hub={hub}>{renderPlace({ place: "console", hash: location.hash } as PlaceContext)}</HubProvider>
      </ConsoleAlone>,
    );
  if (narrow)
    return wrap(
      <Suspense fallback={<View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />}>
        <PhoneHost
          session={session}
          location={{ place: location.place, hash: location.hash }}
          needsYou={needsYou}
          registerGo={registerGo}
          onSignOut={signOut}
          {...(onSwitchSpace ? { onSwitchSpace: selectSpace } : {})}
          {...(onAddSpace ? { onAddSpace } : {})}
        />
      </Suspense>,
    );
  return wrap(
    <>
      <Shell
        hub={hub}
        {...(teamProp ? { team: teamProp } : {})}
        // the person's face is at the foot of the rail from the first frame, from the saved sign-in: it does not arrive later and push the button above it up
        {...(session
          ? { me: { id: session.me.id, name: session.me.name } }
          : stored.displayName
            ? { me: { id: stored.personId, name: stored.displayName } }
            : {})}
        onOpenMe={() => hub.go("settings", PROFILE_HASH)}
        {...(runsOnProp ? { runsOn: runsOnProp } : {})}
        {...(theme ? { theme } : {})}
        {...(onSwitchSpace ? { onSwitchSpace: selectSpace } : {})}
        renderPlace={renderPlace}
        renderNewTab={renderNewTab}
        onPrefetchPlace={prefetchPlace}
        onSearch={() => setSearchOpen(true)}
        onSpaceAction={(a) => {
          if (a === "sign-out") signOut();
          else if (a === "add") onAddSpace?.();
        }}
        addsSpace={onAddSpace !== undefined}
        {...(phone ? { phone: { device: phone.device, data: phone.data } } : {})}
        {...(purge ? { purge } : {})}
      />
      {searchOpen && search ? (
        <CmdK
          data={search}
          onClose={() => setSearchOpen(false)}
          onTiming={(name, ms) => {
            if (name === "local" && session) speed.record(session.runtime.space.id, "search", ms);
          }}
        />
      ) : null}
    </>,
  );
}
