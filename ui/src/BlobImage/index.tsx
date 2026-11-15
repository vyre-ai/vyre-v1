// One way to show a picture the Space serves. A blob address (/spaces/<space>/blobs/<id>) is answered only to a caller with the person's token, and an image element sends none: drawn bare it gets 401
// and stays an empty frame (every picture in Files, from the first viewer commit until 13 Nov 2026). The shell gives this module a function that fetches an address with the token and returns one the page can
// draw (a blob: address); a picture drawn through BlobImage or useBlobSrc is fetched that way, and any other address (a data: address, another site's) is used as it is. ui/src/BlobImage/guard.test.ts fails a
// bare image source anywhere else.
import { createContext, createElement, useContext, useEffect, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Image, Platform } from "react-native";
import type { ImageProps } from "react-native";
import { isSpaceBlob } from "./address.ts";

type Fetcher = (path: string) => Promise<string>;
interface Door {
  fetcher: Fetcher;
  /** The Space's own origin: the only host a picture is fetched from with the person's sign-in. */
  origin: string | undefined;
}
const Ctx = createContext<Door | undefined>(undefined);

export function BlobUrlProvider({
  fetcher,
  origin,
  children,
}: {
  fetcher: Fetcher | undefined;
  origin?: string | undefined;
  children: ReactNode;
}): ReactElement {
  const door = useMemo(() => (fetcher === undefined ? undefined : { fetcher, origin }), [fetcher, origin]);
  return <Ctx.Provider value={door}>{children}</Ctx.Provider>;
}

export { isSpaceBlob };

interface Entry {
  p: Promise<string>;
  url?: string;
  refs: number;
}
/** What was fetched, per fetcher: a fetcher belongs to one sign-in on one Space, so another person or Space never shares a picture (a new sign-in is a new fetcher and an empty cache). */
const caches = new WeakMap<Fetcher, Map<string, Entry>>();
const MAX_KEPT = 300;
const revoke = (url: string | undefined): void => {
  if (url === undefined) return;
  try {
    (globalThis as { URL?: { revokeObjectURL?(u: string): void } }).URL?.revokeObjectURL?.(url);
  } catch {
    /* an address already gone */
  }
};
const cacheOf = (f: Fetcher): Map<string, Entry> => {
  let c = caches.get(f);
  if (!c) caches.set(f, (c = new Map()));
  return c;
};
/** Drop an entry and give its object address back to the browser. */
const forget = (c: Map<string, Entry>, uri: string): void => {
  const e = c.get(uri);
  c.delete(uri);
  if (e) {
    if (e.url !== undefined) revoke(e.url);
    else void e.p.then(revoke, () => undefined);
  }
};
/** For tests: how many addresses a fetcher holds. */
export const keptFor = (f: Fetcher): number => caches.get(f)?.size ?? 0;

/** The address to draw for `uri`: undefined while a blob address is being fetched (or could not be), `uri` itself for any other address and wherever no fetcher is given (a test, a sample). */
export function useBlobSrc(uri: string | undefined): string | undefined {
  const door = useContext(Ctx);
  const needs = uri !== undefined && uri !== "" && door !== undefined && isSpaceBlob(uri, door.origin);
  const [drawn, setDrawn] = useState<{ from: string; url: string } | null>(null);
  useEffect(() => {
    if (!needs || uri === undefined || door === undefined) return undefined;
    const c = cacheOf(door.fetcher);
    let e = c.get(uri);
    if (!e) {
      // the oldest entry nobody is showing goes when the cache is full
      if (c.size >= MAX_KEPT)
        for (const [k, v] of c)
          if (v.refs === 0) {
            forget(c, k);
            break;
          }
      const made: Entry = { p: door.fetcher(uri), refs: 0 };
      made.p.then(
        (u) => void (made.url = u),
        () => {
          if (c.get(uri) === made) c.delete(uri);
        },
      );
      c.set(uri, (e = made));
    }
    const mine = e;
    mine.refs += 1;
    let live = true;
    void mine.p.then(
      (url) => live && setDrawn({ from: uri, url }),
      () => undefined,
    );
    return () => {
      live = false;
      mine.refs -= 1;
      // the last picture using it has left the screen: the address goes back to the browser (a moment later, so a re-draw in the same breath keeps it)
      if (mine.refs === 0)
        setTimeout(() => {
          if (mine.refs === 0 && c.get(uri) === mine) forget(c, uri);
        }, 1000);
    };
  }, [needs, uri, door]);
  if (uri === undefined || uri === "") return undefined;
  if (!needs) return uri;
  return drawn?.from === uri ? drawn.url : undefined;
}

/** A React Native Image for a picture the Space may serve. */
export function BlobImage({ uri, ...rest }: Omit<ImageProps, "source"> & { uri: string }): ReactElement | null {
  const src = useBlobSrc(uri);
  if (src === undefined) return null;
  return <Image {...rest} source={{ uri: src }} />;
}

/** A plain <img> (web) for a picture the Space may serve; nothing off the web. */
export function BlobImg({ src, ...rest }: { src: string } & Record<string, unknown>): ReactElement | null {
  const drawn = useBlobSrc(src);
  if (Platform.OS !== "web" || drawn === undefined) return null;
  return createElement("img", { ...rest, src: drawn });
}
