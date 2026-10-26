// Draws the open place inside the shell (ARCH 7): the place module loads on demand behind its registered loader, and the Space's runtime is handed to it through context.
// Before the runtime exists (the session is still opening) the place draws its own loading frame, the size of the page. `app.usable` is marked once the place module has drawn.
import { Suspense, lazy, useEffect } from "react";
import type { ComponentType, LazyExoticComponent, ReactElement } from "react";
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

function Usable({ place }: { place: string }): null {
  useEffect(() => {
    webUiStateStore().write({ lastPlace: place });
    mark("app.usable");
  }, [place]);
  return null;
}

export function PlaceHost({ place, runtime }: { place: PlaceId; runtime: ShellRuntime | null }): ReactElement | null {
  const routeId = routeIdOf(place);
  if (!routeId) return null;
  const Place = lazyFor(routeId);
  const body = (
    <Suspense fallback={null}>
      <Place place={routeId} />
      <Usable place={routeId} />
    </Suspense>
  );
  return runtime ? <ShellRuntimeProvider value={runtime}>{body}</ShellRuntimeProvider> : body;
}
