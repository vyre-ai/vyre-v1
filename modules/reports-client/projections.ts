// reports-client keeps no projection: its table is written by the handlers.
import type { AsyncConsumer, ProjectionDef } from "../../kernel/src/store/projection.ts";

export const projections: ProjectionDef[] = [];
export const inline = {};
export const consumers: Record<string, AsyncConsumer> = {};
