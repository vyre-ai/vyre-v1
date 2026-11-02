// The production root, without a router. Every place is registered behind its dynamic loader before the first render; the session gate shows sign-in or the shell with the
// Space's real data, and the address follows the shell through window.history (UrlSync). On the web index.web.tsx mounts this directly; the static export renders it through
// expo-router (app/_layout.tsx), which only makes a page per route for deep links and the daemon.
import { Component, Suspense, lazy, useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { States } from "../../../../ui/src/States/index.tsx";
import { claimToken } from "../claim/logic.ts";
import { SessionGate } from "../shell/session/SessionGate.tsx";
import { hydrationBaseUrl } from "../shell/session/hydration.ts";
import { UrlSync } from "../shell/session/UrlSync.tsx";
import type { ShellHub } from "../shell/spaces/hub.ts";
import { loadTwilioDevice } from "../shell/session/voice.ts";
import { registerShellPlaces } from "../shell/places.ts";

registerShellPlaces();

/** /claim/<token>: the first screen on a fresh install (ruling 71). Loaded only when that address is opened. */
const OAuthRoute = lazy(() => import("../oauth/OAuthRoute.tsx").then((m) => ({ default: m.OAuthRoute })));
const ClaimRoute = lazy(() => import("../claim/ClaimRoute.tsx").then((m) => ({ default: m.ClaimRoute })));

const currentPath = (): string => (globalThis as { location?: { pathname?: string } }).location?.pathname ?? "/";

/** Leave the claim address for Chats without a router: replace the history entry and read the path again. */
function replacePath(path: string): void {
  const h = (globalThis as { history?: { state: unknown; replaceState(state: unknown, title: string, url: string): void } }).history;
  h?.replaceState(h.state, "", path);
}

/** The last net under the whole app: a crash outside any place (sign-in, the shell itself) is one themed page with a way to start over, never a blank window. */
class RootBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  override componentDidCatch(error: Error): void { console.error(`vyre root crashed: ${error.message.slice(0, 160)}`); }
  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return <States kind="error" message="Couldn't open Vyre" cause="Something went wrong while it started." retryable onRetry={() => (globalThis as { location?: { assign(url: string): void } }).location?.assign("/")} />;
  }
}

export function AppRoot(): ReactElement {
  return <RootBoundary><AppRoute /></RootBoundary>;
}

function AppRoute(): ReactElement {
  const [hub, setHub] = useState<ShellHub | null>(null);
  // The static export is one page per route and the daemon serves the root page for any address (a claim link included), so the first client render must be the page's own first frame;
  // the address decides what to draw only after mount (a hydration mismatch, React #418, otherwise).
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => setPath(currentPath()), []);
  const token = path === null ? null : claimToken(path);
  const home = (): void => { replacePath("/chat"); setPath("/chat"); };
  // /oauth/callback: where an app sends a person back after approving a connection; it finishes the sign-in as the signed-in person
  if (path === "/oauth/callback") return <Suspense fallback={null}><OAuthRoute /></Suspense>;
  if (token) {
    return (
      <Suspense fallback={null}>
        <ClaimRoute token={token} onDone={home} onSignIn={home} />
      </Suspense>
    );
  }
  return (
    <>
      <SessionGate baseUrl={hydrationBaseUrl(path !== null)} onHub={setHub} voice={loadTwilioDevice} />
      {hub ? <UrlSync hub={hub} /> : null}
    </>
  );
}
