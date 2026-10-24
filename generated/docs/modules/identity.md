# Identity (identity)

Lane L7a. Kind module. Status stub. Version 0.1.0.

Requires: access, members.

## Capabilities (26)

- [identity.change_password](../capabilities/identity.change_password.md): Change my own password; keys are re-wrapped on the device first
- [identity.github_link](../capabilities/identity.github_link.md): Link a GitHub account so it can sign in once the Space is named
- [identity.github_sign_in](../capabilities/identity.github_sign_in.md): Sign in with GitHub once the Space is named
- [identity.github_unlink](../capabilities/identity.github_unlink.md): Remove the GitHub link
- [identity.keys_get](../capabilities/identity.keys_get.md): Fetch the wrapped key bundle for the signed-in person (ciphertext only)
- [identity.keys_put](../capabilities/identity.keys_put.md): Store or replace the wrapped key bundle (first device, password change, recovery, new Space key epoch)
- [identity.pair_create](../capabilities/identity.pair_create.md): A signed-in device makes a short pair code for another device, the extension or the local daemon (valid 10 minutes)
- [identity.pair_redeem](../capabilities/identity.pair_redeem.md): Trade a pair code or invite code for a session on a new device
- [identity.passkey_register](../capabilities/identity.passkey_register.md): Add a passkey as a second factor (ships later)
- [identity.passkey_remove](../capabilities/identity.passkey_remove.md): Remove a passkey (ships later)
- [identity.recovery_restore](../capabilities/identity.recovery_restore.md): Set a new password with a recovery code (keys unwrapped by the code, re-wrapped by the password)
- [identity.recovery_save](../capabilities/identity.recovery_save.md): Save a recovery code so a reset keeps Mine vault items, private chats and personal memory
- [identity.reset_complete](../capabilities/identity.reset_complete.md): The person sets a new password from the reset link and makes fresh keys
- [identity.reset_preview](../capabilities/identity.reset_preview.md): Admin: what a password reset would lose for this person (Mine items, private chats, personal memory) and whether a recovery code exists
- [identity.reset_start](../capabilities/identity.reset_start.md): Admin: start a password reset and get a one-time link for the person (valid 24 hours); their other devices are signed out
- [identity.sign_in](../capabilities/identity.sign_in.md): Sign in with Space, username and password; asks for the second factor when one is set
- [identity.sign_in_options](../capabilities/identity.sign_in_options.md): What the sign-in page offers for this Space: name, logo, key fingerprint, password, GitHub, SSO providers, second factor floor
- [identity.sign_out](../capabilities/identity.sign_out.md): End this session; the device keeps nothing it should not
- [identity.sso_sign_in](../capabilities/identity.sso_sign_in.md): Finish an OIDC sign-in (Google, Microsoft, Okta) with the provider code; reserved until SSO config lands in members
- [identity.totp_begin](../capabilities/identity.totp_begin.md): Start a TOTP enrolment; returns the shared secret once as a setup URI
- [identity.totp_confirm](../capabilities/identity.totp_confirm.md): Confirm a TOTP enrolment with the first code
- [identity.totp_remove](../capabilities/identity.totp_remove.md): Remove my TOTP factor (refused when the Space requires a second factor)
- [identity.username_available](../capabilities/identity.username_available.md): Check a username is free (join page)
- [identity.verify_second_factor](../capabilities/identity.verify_second_factor.md): Finish a sign-in with the second factor code
- [identity.whoami](../capabilities/identity.whoami.md): Who the caller is here: person, roles, clearance, device, epoch
- [invites.accept_create_account](../capabilities/invites.accept_create_account.md): Join by invite with no account yet: creates the person, sets the password, stores the wrapped keys and joins the Space with the invite's role and groups

## Events (10)

- [factor.enrolled](../events/factor.enrolled.md): A second factor was added
- [factor.removed](../events/factor.removed.md): A second factor was removed
- [github.linked](../events/github.linked.md): A GitHub account was linked to the sign-in
- [github.unlinked](../events/github.unlinked.md): The GitHub link was removed
- [keys.stored](../events/keys.stored.md): A wrapped key bundle was stored or re-wrapped
- [password.changed](../events/password.changed.md): A person changed their own password (keys re-wrapped)
- [password.reset](../events/password.reset.md): An admin reset a password and the person set a new one (Mine items lost unless a recovery code was saved)
- [recovery.saved](../events/recovery.saved.md): A recovery code was saved (the code itself is never sent)
- [signin.failed](../events/signin.failed.md): A sign-in attempt failed (counted for lockout; no password stored)
- [signin.succeeded](../events/signin.succeeded.md): A person signed in
