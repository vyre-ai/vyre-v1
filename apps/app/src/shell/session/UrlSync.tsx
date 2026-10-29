// The URL carries both the place and its item. Browser history and copied links
// use the same hub navigation as opening an item inside a place.
import { useEffect } from "react";
import { useHubState } from "../spaces/context.tsx";
import type { ShellHub } from "../spaces/hub.ts";
import { hubUrl, readUrlIntoHub } from "./url.ts";

export function UrlSync({ hub }: { hub: ShellHub }): null {
  const state = useHubState(hub);

  useEffect(() => {
    if (typeof window === "undefined" || !window.location) return;
    const read = (): void => {
      readUrlIntoHub(hub, window.location);
    };
    read();
    window.addEventListener("popstate", read);
    window.addEventListener("hashchange", read);
    return () => { window.removeEventListener("popstate", read); window.removeEventListener("hashchange", read); };
  }, [hub]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.location) return;
    const next = hubUrl(hub, window.location.search);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (!next || next === current) return;
    // The shell already owns the rendered tab. Routing the URL through Expo can
    // replay older asynchronous transitions and remount an editor after typing.
    // Commit history synchronously; copied loads and Back/Forward still use read.
    window.history.pushState(window.history.state, "", next);
  }, [state.place, state.hash, hub]);

  return null;
}
