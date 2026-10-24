# auth.invalid_code

The code or invite is wrong, used or expired.

HTTP 401. Retryable: no.

## Raised by

- access.actors.redeem
- connections.complete_auth
- forms.submit
- identity.github_sign_in
- identity.pair_redeem
- identity.recovery_restore
- identity.reset_complete
- identity.sign_in
- identity.sso_sign_in
- identity.totp_confirm
- identity.verify_second_factor
- mcp.token.register
- members.accept
- members.invites.preview
