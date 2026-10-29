// Draws the open place inside the shell (ARCH 7): the place module loads on demand behind its registered loader, and the Space's runtime is handed to it through context.
// Before the runtime exists (the session is still opening) the place draws its own loading frame, the size of the page. `app.usable` is marked once the place module has drawn.
import { Component, Suspense, lazy, useCallback, useEffect, useRef } from "react";
import type { ComponentType, ErrorInfo, LazyExoticComponent, ReactElement, ReactNode } from "react";
import { States } from "../../../../../ui/src/States/index.tsx";
import { screenFromHash, setScreenContext } from "../ask/screen.ts";
import { PlaceHashProvider } from "../hash/context.tsx";
import type { PlaceHash } from "../hash/context.tsx";
import { mark, takeStartupMs } from "../../startup/marks.ts";
import { speed } from "../../speed/recorder.ts";
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

function Usable({ place, spaceId }: { place: string; spaceId: string | null }): null {
  useEffect(() => {
    webUiStateStore().write({ lastPlace: place });
    mark("app.usable");
    // the first usable screen of this page load is a real startup measurement for the Space it opened in
    const perf = (globalThis as { performance?: { getEntriesByType?: (t: string) => { name: string; startTime: number }[] } }).performance;
    const ms = spaceId ? takeStartupMs(perf?.getEntriesByType?.("mark") ?? []) : null;
    if (spaceId && ms !== null) speed.record(spaceId, "startup", ms);
  }, [place, spaceId]);
  return null;
}

/** The shell tells Ask Vyre where the person is whenever the place or its tab hash changes. Chats does not count: an Ask pane is about the place it was opened from. */
function ScreenSignal({ place, hash }: { place: string; hash: string }): null {
  useEffect(() => { if (place !== "chats") setScreenContext(screenFromHash(place, hash)); }, [place, hash]);
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
      <PlaceBoundary key={routeId} place={routeId}>
        <Suspense fallback={null}>
          <Place place={routeId} />
          <ScreenSignal place={place} hash={hash} />
          <Usable place={routeId} spaceId={runtime?.space.id ?? null} />
        </Suspense>
      </PlaceBoundary>
    </PlaceHashProvider>
  );
  return runtime ? <ShellRuntimeProvider value={runtime}>{body}</ShellRuntimeProvider> : body;
}
