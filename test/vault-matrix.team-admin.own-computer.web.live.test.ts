// The Vault matrix (test/support/vault-matrix.ts): a Team Space, the admin, signed in from a browser, the turn on the own computer.
import { teamSlice } from "./support/vault-matrix.ts";

teamSlice({ who: "admin", runs: "own_computer", froms: ["web"] });
