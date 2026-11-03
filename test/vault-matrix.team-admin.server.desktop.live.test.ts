// The Vault matrix (test/support/vault-matrix.ts): a Team Space, the admin, signed in from the desktop app, the turn on the server.
import { teamSlice } from "./support/vault-matrix.ts";

teamSlice({ who: "admin", runs: "server", froms: ["desktop"] });
