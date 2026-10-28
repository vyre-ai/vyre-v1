import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { States } from "../../../../../ui/src/States/index.tsx";
import { createThemeController } from "../../../../../ui/src/theme/controller.ts";
import { ConsoleShell } from "../../console/shell/ConsoleShell.tsx";
import { ConsoleDataProvider } from "../../console/shell/data.tsx";
import type { ConsoleData } from "../../console/shell/data.tsx";
import { PAGES, pageById } from "../../console/shell/nav.ts";
import { Backups } from "../../console/pages/Backups.tsx";
import { Devices } from "../../console/pages/Devices.tsx";
import { Grants, People, Roles } from "../../console/pages/Access.tsx";
import { Checker } from "../../console/pages/Checker.tsx";
import { Models } from "../../console/pages/Models.tsx";
import { Spend } from "../../console/pages/Spend.tsx";
import { Logging, ReviewSampling } from "../../console/pages/AiSettings.tsx";
import { Incidents } from "../../console/pages/Incidents.tsx";
import { AiPolicy } from "../../console/pages/AiPolicy.tsx";
import { Assistant } from "../../console/Assistant.tsx";
import { usePlaceHash } from "../hash/context.tsx";
import { nameLookup } from "./records-live.ts";
import { useOptionalShellRuntime } from "./runtime.tsx";

export function consolePagesFromNav(out: { groups: Array<{ pages: Array<{ key: string }> }> }): ReadonlySet<string> {
  return new Set(out.groups.flatMap((group) => group.pages.map((page) => page.key)));
}
export function aiDataPageFor(id: string): ReactElement | null {
  if (id === "models") return <Models />;
  if (id === "spend" || id === "usage") return <Spend />;
  if (id === "logging") return <Logging />;
  if (id === "review") return <ReviewSampling />;
  if (id === "incidents") return <Incidents />;
  if (id === "aipolicy") return <AiPolicy />;
  return null;
}
export default function ConsolePlace(): ReactElement {
  const rt = useOptionalShellRuntime();
  const { target } = usePlaceHash();
  const [allowed, setAllowed] = useState<ReadonlySet<string> | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [skin, setSkin] = useState("system");
  useEffect(() => {
    if (!rt || rt.space.kind === "personal") return;
    let live = true;
    void rt.call("console.nav", {}).then((out) => { if (live) { setAllowed(consolePagesFromNav(out as Parameters<typeof consolePagesFromNav>[0])); setFailed(false); } }, () => { if (live) { setAllowed(null); setFailed(true); } });
    return () => { live = false; };
  }, [rt, attempt, target.screen]);
  const theme = useMemo(() => {
    const doc = (globalThis as { document?: Document }).document;
    if (!rt || !doc) return null;
    const root = doc.documentElement;
    let storage: Storage | null = null;
    try { storage = globalThis.localStorage ?? null; } catch { /* blocked storage keeps the theme in this window */ }
    return createThemeController({ personId: rt.me.id, spaceId: rt.space.id, spaceSkin: { [rt.space.id]: root.getAttribute("data-skin") ?? "system" }, prefersDark: globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false, storage, root: { setAttribute: (key, value) => root.setAttribute(key, value), setProperty: (key, value) => root.style.setProperty(key, value), removeProperty: (key) => root.style.removeProperty(key) } });
  }, [rt]);
  const data = useMemo<ConsoleData | null>(() => rt && allowed ? {
    screens: rt.screens, call: rt.call, me: { id: rt.me.id, name: rt.me.name, role: "" }, space: { id: rt.space.id, name: rt.space.name, address: "" },
    can: (permission) => permission === "console.access" || PAGES.some((page) => page.needs === permission && allowed.has(page.screen)), allowedScreens: allowed,
    name: nameLookup(rt), clock: rt.clock,
    nav: { openApp: (target) => rt.open(target ?? { screen: "home.today-starred-ask" }), openPage: (id, args) => { const page = pageById(id); if (page) rt.open({ screen: page.screen, args: { ...args, page: id } }); } },
  } : null, [rt, allowed]);
  if (rt?.space.kind === "personal") return <States kind="empty" title="Needs a Team Space" icon="search" />;
  if (failed) return <States kind="error" message="Couldn’t open the Console" cause="You may not have console access, or the server is unavailable." retryable onRetry={() => setAttempt((n) => n + 1)} />;
  if (!rt || !data) return <States kind="empty" title="Opening the Console…" icon="search" />;
  const requestedPage = target.args.page && pageById(target.args.page)?.screen === target.screen ? target.args.page : null;
  const page = requestedPage ?? PAGES.find((entry) => entry.screen === target.screen)?.id ?? "overview";
  return <ConsoleDataProvider value={data}><ConsoleShell initialPage={page} skin={skin} onSkin={(id) => { theme?.setSkin(id); setSkin(id); }} assistant={<Assistant rt={rt} page={target.screen ?? "console.overview"} />} renderPage={(id) => aiDataPageFor(id) ?? (id === "backups" ? <Backups /> : id === "sessions" ? <Devices /> : id === "people" ? <People /> : id === "roles" ? <Roles /> : id === "grants" ? <Grants {...(target.args.resourceType && target.args.resourceId ? { initialResource: { type: target.args.resourceType, id: target.args.resourceId } } : {})} /> : id === "checker" ? <Checker /> : <States kind="error" message={`${pageById(id)?.title ?? id} is not implemented in this candidate yet.`} />)} /></ConsoleDataProvider>;
}
