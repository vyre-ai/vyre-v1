// The computers that joined this Space, as the engine's handlers see them (engine.placement.decide and options read who is linked now). Bound by the runtime from the host's seam
// (runtime.ts setEngineHost); null on a host without nodes, where nothing but the Space's own engine runs turns.
import type { NodeRelay } from "./node-turns.ts";

let bound: NodeRelay | null = null;
export function bindRelay(r: NodeRelay | null): void { bound = r; }
export function relayOf(): NodeRelay | null { return bound; }
