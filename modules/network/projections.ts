// network keeps no projection: its tables are written by the handlers and by the host daemon's reports.
import type { AsyncConsumer, ProjectionDef } from "../../kernel/src/store/projection.ts";

export const projections: ProjectionDef[] = [];
export const inline = {};
export const consumers: Record<string, AsyncConsumer> = {};
