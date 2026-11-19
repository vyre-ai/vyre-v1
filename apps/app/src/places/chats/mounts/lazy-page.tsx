// A page of the Chats place loaded on first draw; once loaded it is drawn directly. The part itself (one element tree, a failed chunk not kept, a small Retry in place, a page's own crash going on to
// the place) is ui/src/Lazy; this adds the Suspense with what stands in while the code is out (a part is never an empty frame where the person can see it).
import { Suspense } from "react";
import type { ComponentType, ReactElement, ReactNode } from "react";
import { lazyPart } from "../../../../../../ui/src/Lazy/index.tsx";

export function lazyPage<P extends object>(
  load: () => Promise<ComponentType<P>>,
  /** What stands in while the code is out. Leave out where nothing should show (a part drawn on a press, over something already there). */
  placeholder?: (props: P) => ReactNode,
): {
  Draw: (props: P) => ReactElement;
  preload: () => Promise<void>;
} {
  const Part = lazyPart<ComponentType<P>>(() => load().then((c) => ({ default: c })));
  function Draw(props: P): ReactElement {
    return (
      <Suspense fallback={placeholder ? placeholder(props) : null}>
        <Part {...props} />
      </Suspense>
    );
  }
  return { Draw, preload: Part.preload };
}
