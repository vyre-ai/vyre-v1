// Write capabilities for this packet. Later records packets add their own handlers beside these.
export { createWriteHandlers, toRow } from "./write.ts";
export type { RecordRow, WriteCtx, WriteDeps, WriteHandlers } from "./write.ts";
