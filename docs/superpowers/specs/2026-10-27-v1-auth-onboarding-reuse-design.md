# V1 Auth and Onboarding Reuse Design

**Approved:** 2026-10-27

## Outcome

Vyre v1 reuses the strongest 0.6.8 auth and onboarding work without reviving the 0.6 runtime. The first-run experience feels like the clean 0.6.8 native sign-in screens, uses the polished onboarding prototype's sequence and copy, and calls only v1 capabilities.

## Visual contract

- The welcome/auth/onboarding canvas may use the polished prototype's restrained animated halftone field. It is the only v1 surface allowed to use that treatment.
- Every credential, invite, recovery, device, AI-account, progress, and completion step uses the clean 0.6.8 language: one centred column, system typography, calm spacing, quiet dark/light palettes, plain inputs, and decisive primary actions.
- The field becomes quieter behind form steps and renders a still treatment when reduced motion is enabled. It pauses when the page is hidden.
- Desktop, desktop web, and mobile web share the same components. Mobile keeps full-width native spacing and touch targets.
- After authentication, the app returns to the binding v1 prototype. No halftone, glass, or 0.6 shell styling enters the signed-in application.

## Flow contract

1. Welcome: Vyre mark, time-aware greeting, Space address, Sign in, and Get started.
2. Existing person: connect/name the Space, username and password, optional GitHub/SSO, required TOTP when requested, verify the Space, persist the session, open the app.
3. Invited person: preview the inviter, Space identity and fingerprint; name; username/password; recovery code; device; AI account; setup progress; open the Space.
4. Desktop without a stored Space: show Connect a Space. Never infer `tauri://localhost` as a Space.
5. Desktop deep link: consume `vyre://join`, `open`, `pair`, or `signin`, validate the named HTTPS Space and any fingerprint/code, then enter the corresponding v1 flow.
6. Returning person: use the remembered, verified Space session. A 401 clears only that stored session and returns to Connect/Sign in.

## Architecture boundary

Keep:

- `identity.sign_in_options`, `identity.sign_in`, `identity.whoami`, `identity.pair_redeem`
- `members.invites.preview`, `members.invites.accept`
- `spaces.get`, `spaces.switcher`, and `spaces.onboarding.*`
- gateway authorization, actor context, idempotency, audit, fingerprint pinning, and the v1 event/projection model
- a device-local remembered-Space list assembled from individually verified Spaces

Do not reuse:

- 0.6 relay or centralized Space discovery
- 0.6 presence/passkey/PKCE implementation or browser key store
- 0.6 client-owned setup status
- any ambient desktop admin token, generic native network proxy, or conversion of the device daemon into a Space

## Desktop transport

The Tauri shell must expose a narrow bootstrap surface, not an arbitrary proxy. The page reads the pending deep link and listens for later deep links. The connection flow accepts only normalized HTTPS Space addresses outside explicit local development. It calls the selected Space through the existing capability client when WebView CORS permits; otherwise the native bridge may expose only an allowlisted capability transport for the auth/bootstrap operations listed above. Tokens and one-time codes never enter logs.

The device sidecar remains `--role device`. Creating or hosting a Personal Space is a separate explicit lifecycle. The v1 RC must connect to a real existing Space; it must not pretend the local device daemon is one.

## Acceptance

- No packaged screen says `Sign in to tauri`, `nan.tauri`, or version `0.0.0`.
- The 0.6.8-inspired sign-in and onboarding screens render in dark/light desktop and mobile widths.
- Reduced-motion auth screens remain complete and legible.
- Password, GitHub/SSO, TOTP, invite acceptance, recovery, and setup failures retain actionable v1 error states.
- A successful session is persisted only after `identity.whoami` and `spaces.get` succeed for the selected Space.
- A packaged desktop deep link reaches the correct flow without exposing its code or token in logs.
- Browser auth behavior remains functional.
- Signed-in screens remain visually unchanged except for the removal of the invalid Tauri bootstrap state.
