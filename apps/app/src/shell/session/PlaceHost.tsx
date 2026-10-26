// Draws the open place inside the shell (ARCH 7): the place module loads on demand behind its registered loader, and the Space's runtime is handed to it through context.
// Before the runtime exists (the session is still opening) the place draws its own loading frame, the size of the page. `app.usable` is marked once the place module has drawn.
import { Component, Suspense, lazy, useCallback, useEffect, useRef } from "react";
import type { ComponentType, ErrorInfo, LazyExoticComponent, ReactElement, ReactNode } from "react";
import { States } from "../../../../../ui/src/States/index.tsx";
import { PlaceHashProvider } from "../hash/context.tsx";
import type { PlaceHash } from "../hash/context.tsx";
import { mark } from "../../startup/marks.ts";
import { webUiStateStore } from "../../startup/persisted.ts";
import { loaderFor } from "../../startup/places.ts";
import { SHELL_PLACES, registerShellPlaces } from "../places.ts";
import { ShellRuntimeProvider } from "../providers/runtime.tsx";
import type { ShellRuntime } from "../providers/runtime.tsx";
import type { PlaceId } from "../rail/kits.ts";

type PlaceComponent = LazyExoticComponent<ComponentType<{ place: string }>>;
const lazies = new Map<string, PlaceComponent>();

function lazyFor(routeId: string): PlaceComponent {
  let c = lazies.get(routeId);
  if (!c) {
    registerShellPlaces();
    c = lazy(loaderFor(routeId));
    lazies.set(routeId, c);
  }
  return c;
}

/** The route id (src/startup/places.ts) of a rail place, or null for a place the shell has no screen for (console, join). */
export function routeIdOf(place: PlaceId): string | null {
  return SHELL_PLACES.find((p) => p.screens === place)?.id ?? null;
}

/** The rail place of a route id, for deep links. */
export function railPlaceOf(routeId: string): PlaceId | null {
  const p = SHELL_PLACES.find((x) => x.id === routeId);
  return p ? (p.screens as PlaceId) : null;
}

/**
 * A place that throws (or loops, React #185) takes only itself down: the shell around it stays, the person sees one calm error with Try again, and the console says which component did it
 * (the component stack, which the production build keeps) so a crash is found by name, not by a blank page. An error boundary has to be a class.
 */
class PlaceBoundary extends Component<{ place: string; children?: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`vyre place crashed: ${this.props.place}: ${error.message.slice(0, 160)} in${(info.componentStack ?? "").replace(/\s+/g, " ").slice(0, 700)}`);
  }
  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return <States kind="error" message="Couldn't draw this page" cause="Something went wrong here. The rest of Vyre is fine." retryable onRetry={() => this.setState({ failed: false })} />;
  }
}

function Usable({ place }: { place: string }): null {
  useEffect(() => {
    webUiStateStore().write({ lastPlace: place });
    mark("app.usable");
  }, [place]);
  return null;
}

export function PlaceHost({ place, runtime, hash = "", opened }: { place: PlaceId; runtime: ShellRuntime | null; hash?: string; opened?: PlaceHash["opened"] }): ReactElement | null {
  const latest = useRef(opened);
  latest.current = opened;
  const stable = useCallback<PlaceHash["opened"]>((t) => latest.current?.(t), []);
  const routeId = routeIdOf(place);
  if (!routeId) return null;
  const Place = lazyFor(routeId);
  const body = (
    <PlaceHashProvider hash={hash} opened={stable}>
      <PlaceBoundary place={routeId}>
        <Suspense fallback={null}>
          <Place place={routeId} />
          <Usable place={routeId} />
        </Suspense>
      </PlaceBoundary>
    </PlaceHashProvider>
  );
  return runtime ? <ShellRuntimeProvider value={runtime}>{body}</ShellRuntimeProvider> : body;
}
