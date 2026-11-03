// The Vault matrix (support/vault-matrix.ts): a Team Space, the member sso, signed in from a phone, with the owner's own server joined to the Space.
import { teamSlice } from "./support/vault-matrix.ts";

teamSlice({ who: "member_sso", runs: "owner_server", froms: ["phone"] });
