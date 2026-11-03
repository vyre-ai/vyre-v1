// Placement (ARCH 6.3): where a queued turn runs.
export { BUSY_BELOW, DEVICE_OFF_LINE, LOCAL_RUNS_OFF_LINE, isPrivate, movedLine, placeTurn } from "./place.ts";
export type { Origin, PlaceDevice, PlaceInput, PlaceReason, PlaceRoom, PlaceServer, PlaceThread, Placement } from "./place.ts";
export { roomLeft } from "../../../lib/room-left.ts";
export type { Room, RoomInput, RoomWhy } from "../../../lib/room-left.ts";
