// projects module entry (lane L3). The host loads the generated stubs while host/modules.json says `status: 'stub'` and this file once it says `live` (ruling 25).
import type { Handler } from "../../host/src/invoke.ts";
import { handlers as table } from "./handlers/index.ts";

export const handlers: Record<string, Handler> = table as unknown as Record<string, Handler>;

export { planCascade, propose } from "./handlers/cascade.ts";
