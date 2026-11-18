// Draw the fallback, not a Suspense fallback, until a load is done, and the children once it is. A component that suspends makes React commit the boundary's fallback and then wait until 300 ms after it
// before it reveals what came (its own Suspense throttle): a visit whose code arrived in the meantime still waited out the rest of the 300 ms (r40: the first screen was revealed exactly 300 ms after the
// shell's fallback). Here nothing suspends: the fallback is an ordinary render, and the children are drawn when the load says it is done. A load that fails draws the children, which load again and show the failure.
import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";

export function AfterLoad({
  load,
  ready,
  fallback,
  children,
}: {
  load(): Promise<unknown>;
  ready(): boolean;
  fallback: ReactNode;
  children: ReactNode;
}): ReactElement {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (ready()) {
      setDone(true);
      return undefined;
    }
    let live = true;
    load().then(
      () => live && setDone(true),
      () => live && setDone(true),
    );
    return () => {
      live = false;
    };
  }, [load, ready]);
  return <>{done || ready() ? children : fallback}</>;
}
