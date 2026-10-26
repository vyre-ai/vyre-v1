// One handler per identity capability (26 including invites.accept_create_account). Passkeys answer internal.not_implemented until 1.1.0; SSO answers validation.unsupported until a Space has an SSO config.
import {
  githubLink, githubSignIn, githubUnlink, pairCreate, pairRedeem, passkeyRegister, passkeyRemove, signIn, signInOptions, signOut, ssoSignIn, totpBegin, totpConfirm,
  totpRemove, usernameAvailable, verifySecondFactor, whoami,
} from "./signin.ts";
import { claimOwner } from "./claim.ts";
import { acceptCreateAccount, changePassword, keysGet, keysPut, recoveryRestore, recoverySave, resetComplete, resetPreview, resetStart } from "./keys.ts";

export const handlers = {
  "invites.accept_create_account": acceptCreateAccount,
  "identity.change_password": changePassword,
  "identity.claim_owner": claimOwner,
  "identity.github_link": githubLink,
  "identity.github_sign_in": githubSignIn,
  "identity.github_unlink": githubUnlink,
  "identity.keys_get": keysGet,
  "identity.keys_put": keysPut,
  "identity.pair_create": pairCreate,
  "identity.pair_redeem": pairRedeem,
  "identity.passkey_register": passkeyRegister,
  "identity.passkey_remove": passkeyRemove,
  "identity.recovery_restore": recoveryRestore,
  "identity.recovery_save": recoverySave,
  "identity.reset_complete": resetComplete,
  "identity.reset_preview": resetPreview,
  "identity.reset_start": resetStart,
  "identity.sign_in": signIn,
  "identity.sign_in_options": signInOptions,
  "identity.sign_out": signOut,
  "identity.sso_sign_in": ssoSignIn,
  "identity.totp_begin": totpBegin,
  "identity.totp_confirm": totpConfirm,
  "identity.totp_remove": totpRemove,
  "identity.username_available": usernameAvailable,
  "identity.verify_second_factor": verifySecondFactor,
  "identity.whoami": whoami,
};
