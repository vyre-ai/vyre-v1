// The Vault matrix (test/support/vault-matrix.ts): a Personal Space on its owner's computer, signed in from the app and a browser.
import { personalSlice } from "./support/vault-matrix.ts";

personalSlice({ froms: ["desktop", "web"] });
