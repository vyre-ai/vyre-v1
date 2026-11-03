// The Vault matrix (support/vault-matrix.ts): a Team Space, the owner, signed in from an outside agent over MCP, with the owner's own server joined to the Space.
import { teamSlice } from "./support/vault-matrix.ts";

teamSlice({ who: "owner", runs: "owner_server", froms: ["mcp"] });
