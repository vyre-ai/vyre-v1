// Keeps the address bar and the shell's open place in step: a deep link (/records) opens that place, and moving to another place in the shell updates the address.
// The shell owns the open place; the URL follows it. Back and forward are URL changes the shell has not made itself, so they move the shell.
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "expo-router";
import { useHubState } from "../spaces/context.tsx";
import type { ShellHub } from "../spaces/hub.ts";
import { railPlaceOf, routeIdOf } from "./place-map.ts";

const segment = (pathname: string): string => pathname.split("/")[1] ?? "";

export function UrlSync({ hub }: { hub: ShellHub }): null {
  const pathname = usePathname();
  const router = useRouter();
  const place = useHubState(hub).place;
  const pushed = useRef<string | null>(null);

  useEffect(() => {
    const id = segment(pathname);
    if (id === pushed.current) return;
    const rail = railPlaceOf(id);
    if (rail && rail !== hub.state().place) hub.go(rail);
  }, [pathname, hub]);

  useEffect(() => {
    const id = routeIdOf(hub.state().place);
    if (!id || segment(pathname) === id) return;
    pushed.current = id;
    router.replace(`/${id}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the address follows the shell's place, not the other way round
  }, [place]);

  return null;
}
