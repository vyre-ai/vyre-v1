// The URL carries both the place and its item. Browser history and copied links
// use the same hub navigation as opening an item inside a place.
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "expo-router";
import { useHubState } from "../spaces/context.tsx";
import type { ShellHub } from "../spaces/hub.ts";
import { hubUrl, readUrlIntoHub } from "./url.ts";

export function UrlSync({ hub }: { hub: ShellHub }): null {
  const pathname = usePathname();
  const router = useRouter();
  const state = useHubState(hub);
  const pushed = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.location) return;
    const read = (): void => {
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (current === pushed.current) return;
      pushed.current = null;
      readUrlIntoHub(hub, window.location);
    };
    read();
    window.addEventListener("popstate", read);
    window.addEventListener("hashchange", read);
    return () => { window.removeEventListener("popstate", read); window.removeEventListener("hashchange", read); };
  }, [pathname, hub]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.location) return;
    const next = hubUrl(hub, window.location.search);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (!next || next === current || next === pushed.current) return;
    pushed.current = next;
    router.push(next);
  }, [state.place, state.hash, hub, router]);

  return null;
}
