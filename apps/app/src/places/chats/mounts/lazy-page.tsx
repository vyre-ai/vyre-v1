// A page loaded on first draw; once loaded it is drawn directly. One stable element tree either way (Suspense > Inner > page): when the chunk arrives while the page is already on screen,
// nothing remounts, so text typed into it survives (rc.39 drew Lazy first and Loaded after: a different element type, so the page remounted and dropped typed text).
import { Suspense } from "react";
import type { ComponentType, ReactElement } from "react";

export function lazyPage<P extends object>(
  load: () => Promise<ComponentType<P>>,
): {
  Draw: (props: P) => ReactElement;
  preload: () => Promise<void>;
} {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const get = (): Promise<ComponentType<P>> =>
    (pending ??= load().then((c) => {
      loaded = c;
      return c;
    }));
  function Inner(props: P): ReactElement {
    if (!loaded) throw get();
    const Loaded = loaded;
    return <Loaded {...props} />;
  }
  function Draw(props: P): ReactElement {
    return (
      <Suspense fallback={null}>
        <Inner {...props} />
      </Suspense>
    );
  }
  return { Draw, preload: () => get().then(() => undefined) };
}
