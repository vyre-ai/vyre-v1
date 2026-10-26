// The production root. Every place is registered behind its dynamic loader before the first route renders; the session gate shows sign-in or the shell with the Space's real data.
// The routes (index, [place]) still exist for the static export and deep links: the shell draws the place, and the address follows it (UrlSync).
import { Suspense, lazy, useState } from "react";
import { usePathname, useRouter } from "expo-router";
import { claimToken } from "../src/claim/logic.ts";
import { SessionGate } from "../src/shell/session/SessionGate.tsx";
import { loadTwilioDevice } from "../src/shell/session/voice.ts";
import { UrlSync } from "../src/shell/session/UrlSync.tsx";
import type { ShellHub } from "../src/shell/spaces/hub.ts";
import { registerShellPlaces } from "../src/shell/places.ts";

registerShellPlaces();

/** /claim/<token>: the first screen on a fresh install (ruling 71). Loaded only when that address is opened. */
const ClaimRoute = lazy(() => import("../src/claim/ClaimRoute.tsx").then((m) => ({ default: m.ClaimRoute })));

export default function Layout() {
  const [hub, setHub] = useState<ShellHub | null>(null);
  const token = claimToken(usePathname());
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
      <SessionGate onHub={setHub} voice={loadTwilioDevice} />
      {hub ? <UrlSync hub={hub} /> : null}
    </>
  );
}
