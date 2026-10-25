// memory module entry (lane L2). The host loads the generated stubs while host/modules.json says `status: 'stub'`; the lane's live packet flips it (ruling 25) after the contract tests
// pass against these handlers. All 30 capabilities of manifests/memory.ts have a handler here.
//
// Also here: the seam for the capture pass. memory.capture asks an extractor which sentences of a closed or idle chat are facts. The default is a set of rules; the host binds a cheap-model
// pass with setCaptureExtractor at boot, which is where permission.provider_label comes from when a chat's label forbids sending it to a provider.
import { handlers as table } from "./handlers/index.ts";
import { setCaptureExtractor, heuristicExtract } from "./handlers/facts.ts";
import type { Candidate, CaptureMessage, Extractor } from "./handlers/facts.ts";
import type { Handler } from "../../host/src/invoke.ts";

export const handlers: Record<string, Handler> = table as unknown as Record<string, Handler>;

export { setCaptureExtractor, heuristicExtract };
export type { Candidate, CaptureMessage, Extractor };
export { ensure } from "./projections.ts";
