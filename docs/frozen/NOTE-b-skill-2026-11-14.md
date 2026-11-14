# Frozen note: vault.assistant_grant.* (lane b-skill, 14 Nov 2026), for the lead to sign

Additive only. Three new capabilities in the vault module, version 1:
- `vault.assistant_grant.give` (write, use level, person's own hand only, `agent: false`): lets the Assistant use one Vault item inside one Automation, for the giver only.
- `vault.assistant_grant.revoke` (write, view level, `agent: false`): takes one grant, or every grant of an Automation or an item, back.
- `vault.assistant_grant.list` (read, view level): the grants a caller may see.

No event is added or changed. No existing capability changes its input, output or errors. The new table `vault_assistant_grant` is migration `modules/vault/migrations/0009_assistant_grant.sql` (new file; no migration already on main is edited).
Two names are added to the exact opt-out list in `modules/mcp/tests/server.parity.test.ts`: `vault.assistant_grant.give` and `vault.assistant_grant.revoke`.
Snapshot: `docs/frozen/snapshots/vault.json` regenerated with `node tools/gen/src/cli.ts --snapshots`.

Signed: ______________  Date: ____________
