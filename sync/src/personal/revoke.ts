// A phone of a Personal Space that the host revoked (ARCH 5.7, 5.13). The host bumps the device's epoch; the phone hears it on its next contact (the live frame, the hello or a pull that answers
// `reset: "purge"`), and the existing purge client wipes the replica. A phone that cannot reach its host keeps its replica until it can: revocation is a message, and there is nobody to carry it.
// The person is still active in their own Space, so unsent changes are kept as a Rejected archive they can copy out.
import { createPurgeClient } from "../purge/client.ts";
import type { PurgeClient } from "../purge/client.ts";
import type { PurgeOpts } from "../purge/purge.ts";

export interface PhonePurgeOpts {
  /** What a purge deletes and tells: the driver, the open store, documents, keychain, folder and status line. */
  purge: Omit<PurgeOpts, "reason" | "epoch" | "personActive">;
  /** The epoch this phone last took part in, so an old frame is ignored. */
  currentEpoch?: () => number;
}

export function createPhonePurge(o: PhonePurgeOpts): PurgeClient {
  return createPurgeClient({ purge: o.purge, personActive: () => true, ...(o.currentEpoch ? { currentEpoch: o.currentEpoch } : {}) });
}
