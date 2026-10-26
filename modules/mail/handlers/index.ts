// One handler per mail capability this module has built so far. The rest of mail's capabilities (mailbox admin, message reads,
// send, status, domains, routes) belong to later packets and are served by their generated stubs until then.
import { connect, ingest, syncNow } from "./ingest.ts";
import { draft, draftsDiscard, draftsList } from "./drafts.ts";
import { send, sendAs, sendPreview } from "./send.ts";

export { connect, ingest, syncNow, draft, draftsDiscard, draftsList, send, sendAs, sendPreview };
export { messageErase } from "./purge.ts";
