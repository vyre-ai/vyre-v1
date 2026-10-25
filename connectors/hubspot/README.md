# HubSpot connector

The built-in example connector (spec 2.10). `connector.toml` is the whole definition; `tests/recorded/` holds HubSpot answers (personal data replaced) that the tests replay with no network.

- Sign-in: OAuth with PKCE, or a private app token. The token is the Vault item `HubSpot_Token`; this folder never holds a value.
- Reaches only `api.hubapi.com` and `app.hubspot.com`.
- Synced types: `contact` (HubSpot contacts, matched on email) and `company` (companies, matched on domain). Name, email and phone on contacts and company name are Both; company domain is Pull.
- Off until a person turns it on: create at source, deletes travelling to HubSpot. A conflict on a person asks.
- Webhooks: `/hooks/hubspot`, verified by signature, deduplicated on the provider event id.
- Health: `GET /account-info/v3/details`.

Run the replay: `node --test connectors/hubspot/tests/replay.test.ts` (CI runs it).
