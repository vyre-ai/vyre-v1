// The Vault matrix (support/vault-matrix.ts): a Team Space, the member, signed in from the desktop app, with the owner's own server joined to the Space.
import { teamSlice } from "./support/vault-matrix.ts";

teamSlice({ who: "member", runs: "owner_server", froms: ["desktop"] });
