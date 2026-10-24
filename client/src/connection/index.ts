// Connection manager (ARCH 5.9).
export { ENDPOINT_COOLDOWN_MS, endpoint, rank, usable } from "./endpoints.ts";
export type { Endpoint, EndpointKind, Health } from "./endpoints.ts";
export { readEvent, readHelloOk } from "./frames.ts";
export type { DeviceClass, EventBatch, FieldVal, HelloInfo, HelloOk, Mode, WireChange, WireHide } from "./frames.ts";
export { BACKOFF_BASE_MS, BACKOFF_CAP_MS, HEARTBEAT_DEAD_MS, HEARTBEAT_MS, HELLO_TIMEOUT_MS, IDLE_CLOSE_MS, connectionFor, createConnection, forgetConnections } from "./manager.ts";
export type { Connection, ConnectionOpts, Handle, Status } from "./manager.ts";
export { memoryLink } from "./memory.ts";
export type { MemoryLink } from "./memory.ts";
export { manualScheduler, realScheduler } from "./scheduler.ts";
export type { ManualScheduler, Scheduler } from "./scheduler.ts";
export type { Dial, Transport } from "./transport.ts";
