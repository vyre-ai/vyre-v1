// The production shell under the phone breakpoint (spec 3.11): the five bottom tabs and one history from mobile/shell, over the same session as the desktop shell. A tab's first screen is
// the place itself; opening an item (a chat, a record, a file) puts it on top and Back returns to where you came from. The places are the same modules the desktop draws; the ones that
// have a list and a detail (Chats) draw one at a time under their compact width.
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { View } from "react-native";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { MobileShell, YouScreen } from "../../mobile/shell/index.ts";
import type { Entry, MobileNav } from "../../mobile/shell/index.ts";
import type { LiveQuery, QueryState } from "../../../../../client/src/index.ts";
import type { CapMap } from "../../../../../generated/types.ts";
import type { PlaceHash } from "../hash/context.tsx";
import type { PlaceId } from "../rail/kits.ts";
import { PlaceHost } from "./PlaceHost.tsx";
import { entryFor, placeOf } from "./mobile-map.ts";
import type { RealSession } from "./session.ts";

const NEVER: LiveQuery<never> = { subscribe: () => () => undefined, getSnapshot: () => ({ status: "loading" }) };
function useLive<T>(q: LiveQuery<T> | null): QueryState<T> {
  const live = (q ?? NEVER) as LiveQuery<T>;
  return useSyncExternalStore(live.subscribe, live.getSnapshot, live.getSnapshot);
}

function You({ session, nav, onSignOut }: { session: RealSession; nav: MobileNav; onSignOut(): void }): ReactElement {
  const work = useLive(session.hooks.capQuery<CapMap["tasks.my_work"]["out"]>("tasks.my_work", {}));
  const stars = useLive(session.hooks.capQuery<CapMap["stars.list"]["out"]>("stars.list", {}));
  return (
    <View style={{ flex: 1 }}>
      <YouScreen nav={nav} data={{ name: session.me.name, space: session.def.name, workOpen: work.status === "ready" ? work.data.tasks.length : 0, starred: stars.status === "ready" ? stars.data.stars.length : 0 }} />
      {session.runtime.space.kind === "team" ? <Row id="you-apps" title="Apps" note="Forms, campaigns and templates" onPress={() => nav.open(entryFor("apps", "")!)} /> : null}
      <Row id="you-sign-out" title="Sign out" note={`Of ${session.def.name} on this device`} onPress={onSignOut} />
    </View>
  );
}

export interface PhoneHostProps {
  session: RealSession | null;
  /** What waits on you: the badge on the Chats tab. */
  needsYou: number;
  /** The shell's one door for opening a place and hash (rt.open): the host hands it the function that moves the phone's history. */
  registerGo(go: ((place: PlaceId, hash: string) => void) | null): void;
  /** Sign out of this Space on this device: lock the key on this computer, end the session, return to sign-in. */
  onSignOut(): void;
}

export function PhoneHost({ session, needsYou, registerGo, onSignOut }: PhoneHostProps): ReactElement {
  const navRef = useRef<MobileNav | null>(null);

  const go = useCallback((place: PlaceId, hash: string): void => {
    const nav = navRef.current;
    const e = entryFor(place, hash);
    if (!nav || !e) return;
    if (e.screen === e.tab) nav.selectTab(e.tab);
    else nav.open(e);
  }, []);
  useEffect(() => { registerGo(go); return () => registerGo(null); }, [go, registerGo]);

  const render = (e: Entry, nav: MobileNav): ReactNode => {
    navRef.current = nav;
    if (e.screen === "you") return session ? <You session={session} nav={nav} onSignOut={onSignOut} /> : null;
    const where = placeOf(e);
    if (!where) return null;
    const opened: PlaceHash["opened"] = (t) => {
      const sub = t.subject;
      if (sub) nav.open({ tab: e.tab, screen: `${sub.type}:${sub.id}` });
    };
    return <PlaceHost place={where.place} runtime={session?.runtime ?? null} hash={where.hash} opened={opened} />;
  };
  return <MobileShell renderScreen={render} needsYou={needsYou} initialTab="chats" ownsHeader={(entry) => entry.screen.startsWith("apps:") && placeOf(entry)?.hash !== ""} />;
}
