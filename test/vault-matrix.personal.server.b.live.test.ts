// The Vault matrix (test/support/vault-matrix.ts): a Personal Space with a server of its owner's added, from a phone and an outside agent.
import { personalSlice } from "./support/vault-matrix.ts";

personalSlice({ froms: ["phone", "mcp"], server: true });
