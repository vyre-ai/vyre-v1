// The production root. Every place is registered behind its dynamic loader before the first route renders; the session gate shows sign-in or the shell with the Space's real data.
// The routes (index, [place]) still exist for the static export and deep links: the shell draws the place, and the address follows it (UrlSync).
import { Suspense, lazy, useEffect, useState } from "react";
import { usePathname, useRouter } from "expo-router";
import { claimToken } from "../src/claim/logic.ts";
import { SessionGate } from "../src/shell/session/SessionGate.tsx";
import { UrlSync } from "../src/shell/session/UrlSync.tsx";
import type { ShellHub } from "../src/shell/spaces/hub.ts";
import { registerShellPlaces } from "../src/shell/places.ts";

registerShellPlaces();

/** /claim/<token>: the first screen on a fresh install (ruling 71). Loaded only when that address is opened. */
const ClaimRoute = lazy(() => import("../src/claim/ClaimRoute.tsx").then((m) => ({ default: m.ClaimRoute })));

export default function Layout() {
  const [hub, setHub] = useState<ShellHub | null>(null);
  // The static export is one page per route and the daemon serves the root page for any address (a claim link included), so the first client render must be the page's own first frame;
  // the address decides what to draw only after mount (a hydration mismatch, React #418, otherwise).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const pathname = usePathname();
  const token = mounted ? claimToken(pathname) : null;
  const router = useRouter();
  if (token) {
    return (
      <Suspense fallback={null}>
        <ClaimRoute token={token} onDone={() => router.replace("/home")} onSignIn={() => router.replace("/home")} />
      </Suspense>
    );
  }
  return (
    <>
      {/* No voice loader at start: asking for a Twilio token when the app opens made every Space without a Twilio key log a 502. The phone opens when a call is started (follow-up), not before. */}
      <SessionGate onHub={setHub} />
      {hub ? <UrlSync hub={hub} /> : null}
    </>
  );
}
