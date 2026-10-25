// Read a stream store from React. useSyncExternalStore makes every change a synchronous update: the commit happens in the task that ran the frame callback, before the browser paints, so the
// text a frame carried is on that frame and not the next.
import { useSyncExternalStore } from "react";
import type { StreamSnapshot, StreamStore } from "./store.ts";

export function useStream(store: StreamStore): StreamSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
