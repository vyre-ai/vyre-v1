// One way to show a picture the Space serves. A blob address (/spaces/<space>/blobs/<id>) is answered only to a caller with the person's token, and an image element sends none: drawn bare it gets 401
// and stays an empty frame (every picture in Files, from the first viewer commit until 13 Nov 2026). The shell gives this module a function that fetches an address with the token and returns one the page can
// draw (a blob: address); a picture drawn through BlobImage or useBlobSrc is fetched that way, and any other address (a data: address, another site's) is used as it is. ui/src/BlobImage/guard.test.ts fails a
// bare image source anywhere else.
import { createContext, createElement, useContext, useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Image, Platform } from "react-native";
import type { ImageProps } from "react-native";
import { isSpaceBlob } from "./address.ts";

type Fetcher = (path: string) => Promise<string>;
const Ctx = createContext<Fetcher | undefined>(undefined);

export function BlobUrlProvider({
  fetcher,
  children,
}: {
  fetcher: Fetcher | undefined;
  children: ReactNode;
}): ReactElement {
  return <Ctx.Provider value={fetcher}>{children}</Ctx.Provider>;
}

export { isSpaceBlob };

const made = new Map<string, Promise<string>>();
const MAX_KEPT = 300;

/** The address to draw for `uri`: undefined while a blob address is being fetched (or could not be), `uri` itself for any other address and wherever no fetcher is given (a test, a sample). */
export function useBlobSrc(uri: string | undefined): string | undefined {
  const fetcher = useContext(Ctx);
  const needs = uri !== undefined && uri !== "" && isSpaceBlob(uri) && fetcher !== undefined;
  const [drawn, setDrawn] = useState<{ from: string; url: string } | null>(null);
  useEffect(() => {
    if (!needs || uri === undefined || fetcher === undefined) return undefined;
    let live = true;
    let p = made.get(uri);
    if (!p) {
      p = fetcher(uri);
      if (made.size >= MAX_KEPT) made.delete(made.keys().next().value as string);
      made.set(uri, p);
      p.catch(() => made.delete(uri));
    }
    void p.then(
      (url) => live && setDrawn({ from: uri, url }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [needs, uri, fetcher]);
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
