# auth.invalid_code

The code or invite is wrong, used or expired.

HTTP 401. Retryable: no.

## Raised by

- access.actors.redeem
- connections.complete_auth
- dropbox.connect.complete
- forms.submit
- identity.claim_owner
- identity.github_sign_in
- identity.pair_redeem
- identity.recovery_fetch
- identity.recovery_restore
- identity.reset_complete
- identity.sign_in
- identity.sso_sign_in
- identity.totp_confirm
- identity.verify_second_factor
- invites.accept_create_account
- mcp.token.register
- members.accept
- members.invites.preview
- network.enroll
- network.enroll_status
