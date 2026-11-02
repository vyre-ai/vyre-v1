// company module entry: the one flow that connects a company's Google Workspace or Microsoft 365. See handlers/index.ts.
import type { Handler } from "../../host/src/invoke.ts";
import { handlers as table } from "./handlers/index.ts";

export const handlers: Record<string, Handler> = table as unknown as Record<string, Handler>;
