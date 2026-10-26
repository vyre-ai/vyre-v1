// The production root. Every place is registered behind its dynamic loader before the first route renders; the session gate shows sign-in or the shell with the Space's real data.
// The routes (index, [place]) still exist for the static export and deep links: the shell draws the place, and the address follows it (UrlSync).
import { useState } from "react";
import { SessionGate } from "../src/shell/session/SessionGate.tsx";
import { UrlSync } from "../src/shell/session/UrlSync.tsx";
import type { ShellHub } from "../src/shell/spaces/hub.ts";
import { registerShellPlaces } from "../src/shell/places.ts";

registerShellPlaces();

export default function Layout() {
  const [hub, setHub] = useState<ShellHub | null>(null);
  return (
    <>
      <SessionGate onHub={setHub} />
      {hub ? <UrlSync hub={hub} /> : null}
    </>
  );
}
