// The Vault matrix (support/vault-matrix.ts): a Team Space, the guest, signed in from a browser, with the owner's own server joined to the Space.
import { teamSlice } from "./support/vault-matrix.ts";

teamSlice({ who: "guest", runs: "owner_server", froms: ["web"] });
