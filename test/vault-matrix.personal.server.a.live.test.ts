// The Vault matrix (test/support/vault-matrix.ts): a Personal Space with a server of its owner's added, from the app and a browser.
import { personalSlice } from "./support/vault-matrix.ts";

personalSlice({ froms: ["desktop", "web"], server: true });
