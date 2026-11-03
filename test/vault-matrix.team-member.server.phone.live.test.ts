// The Vault matrix (test/support/vault-matrix.ts): a Team Space, the member, signed in from a phone, the turn on the server.
import { teamSlice } from "./support/vault-matrix.ts";

teamSlice({ who: "member", runs: "server", froms: ["phone"] });
