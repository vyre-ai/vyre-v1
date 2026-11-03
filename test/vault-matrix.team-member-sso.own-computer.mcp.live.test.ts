// The Vault matrix (test/support/vault-matrix.ts): a Team Space, the member sso, signed in from an outside agent over MCP, the turn on the own computer.
import { teamSlice } from "./support/vault-matrix.ts";

teamSlice({ who: "member_sso", runs: "own_computer", froms: ["mcp"] });
