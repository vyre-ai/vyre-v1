// The Vault matrix (test/support/vault-matrix.ts): a Team Space, the owner, signed in from an outside agent over MCP, the turn on the own computer.
import { teamSlice } from "./support/vault-matrix.ts";

teamSlice({ who: "owner", runs: "own_computer", froms: ["mcp"] });
