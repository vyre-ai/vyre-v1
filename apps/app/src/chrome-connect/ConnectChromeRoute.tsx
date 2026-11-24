// /chrome/connect: binds the Connect Chrome page to this browser's stored session for the Space it was served from. Not signed in here: the normal sign-in, then this same page.
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { createCapCaller } from "../shell/session/caps.ts";
import { SessionGate } from "../shell/session/SessionGate.tsx";
import { readStored, spaceAddress } from "../shell/session/stored.ts";
import { spaceLabel } from "../shell/spaces/space-label.ts";
import { ConnectChromeScreen } from "./ConnectChromeScreen.tsx";

export function ConnectChromeRoute(): ReactElement {
  const location = (globalThis as { location?: { hash: string } }).location;
  const baseUrl = spaceAddress();
  // read once: the hash holds the value's hash and is dropped from the address after the page has it
  const hash = useMemo(() => location?.hash ?? "", []); // eslint-disable-line react-hooks/exhaustive-deps
  const [stored, setStored] = useState(() => (baseUrl ? readStored(undefined, baseUrl) : null));
  useEffect(() => {
    if (stored || !baseUrl) return undefined;
    const t = setInterval(() => {
      const s = readStored(undefined, baseUrl);
      if (s) setStored(s);
    }, 500);
    return () => clearInterval(t);
  }, [stored, baseUrl]);
  const call = useMemo(
    () => (stored && baseUrl ? createCapCaller({ baseUrl, token: () => stored.token }) : null),
    [stored, baseUrl],
  );
  if (!stored || !call) return <SessionGate />;
  return (
    <ConnectChromeScreen
      call={call}
      hash={hash}
      spaceName={spaceLabel(stored.def.name, baseUrl ?? undefined)}
      me={stored.username ?? "you"}
      onDone={() =>
        (globalThis as { close?: () => void; location?: { assign(url: string): void } }).location?.assign("/")
      }
    />
  );
}
