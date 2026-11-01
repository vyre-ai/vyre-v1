import { useCallback, useMemo } from "react";
import type { ReactElement } from "react";
import { OAuthCallback } from "./OAuthCallback.tsx";
import { createCapCaller } from "../shell/session/caps.ts";
import { readStored, spaceAddress } from "../shell/session/stored.ts";

/** Binds the callback page to this browser's stored session for the Space it was served from. */
export function OAuthRoute(): ReactElement {
  const location = (globalThis as { location?: { origin: string; search: string; pathname: string; assign(url: string): void } }).location;
  const baseUrl = spaceAddress();
  // read once: the address is scrubbed right after, and a re-render must not lose what it carried
  const search = useMemo(() => location?.search ?? "", []);   // eslint-disable-line react-hooks/exhaustive-deps
  const stored = useMemo(() => (baseUrl ? readStored(undefined, baseUrl) : null), [baseUrl]);
  const call = useMemo(() => (stored && baseUrl ? createCapCaller({ baseUrl, token: () => stored.token }) : null), [stored, baseUrl]);
  const scrub = useCallback(() => { try { globalThis.history?.replaceState(null, "", "/oauth/callback"); } catch { /* the address stays as it is */ } }, []);
  return <OAuthCallback call={call} search={search} scrub={scrub} go={(path) => location?.assign(path)} {...(stored?.def.kind === "personal" ? { back: { path: "/home", label: "Back to Vyre" } } : {})} />;
}
