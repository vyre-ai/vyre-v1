// Home module (lane L6). The host loads these handlers once the module is live (host/modules.json, ARCH 12.4).
// The aggregate reads call tasks, projects, runs, agents, scheduler and spaces through the registry; the digest is the module's own `digest` entity.
import { handlers } from "./handlers/index.ts";

export { handlers };
export { AT_RISK_RULE, KIND_RANK, rankItems, reasonsOf } from "./projections.ts";
