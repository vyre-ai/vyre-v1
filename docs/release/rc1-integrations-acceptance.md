# Integrations acceptance checklist

Approved direction: the v1 Console uses shared ObjectList and ObjectPage, named people/resources, typed choices, reviewed destructive actions and actual readback. Auth-only 0.6.8 styling does not apply here. Root owns these four pages; the auth owner takes the four Comms pages after its current handoff.

- Connectors: searchable paged catalogue; typed creation; named object header; domain/action/secret-name inspection; real test case results; build/diff/publish/version/rollback/remove with reviewed changes; actual export folder opens in Files.
- Connections: searchable paged catalogue and named owner; creation from a selected connector with Vault handles only; declared scopes, rename, pause/resume, probe and reconnect results; review deletion and verify readback. Provider sign-in uses actual returned HTTPS URL, never invented success.
- Webhooks: typed event choices, name/URL editing, paged delivery failures and reviewed replay; enable/disable and deletion; reviewed rotation with ephemeral signing secret display, clear on close/unmount/timeout. Preserve existing filters unless explicitly edited.
- API keys: existing ten-minute, one-time registration contract; typed client/scope/channel controls, reveal/copy audit, expiry and ephemeral display; named paged sessions, reviewed close and outside-actor management. Do not invent a long-lived API key protocol.

Use existing module contracts in manifests/connectors.ts, events.ts and mcp.ts. Keep real protocol gaps visible and separate from UI completion. Verify representative lifecycle over the actual gateway/browser; provider fixture evidence cannot prove a production account connected.

Current API-key evidence: actual issue with selected scopes, reveal/copy audit, no browser storage, real one-time registration/replay denial, session open, copied session reload and reviewed close all passed. Public session metadata now distinguishes recent closed/expired sessions without exposing hashes. Full scoped Activity and broader list/filter/bulk interaction acceptance remain; this is primary lifecycle proof, not whole-page sign-off.
