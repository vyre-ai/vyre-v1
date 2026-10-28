# Lane L7a: brief skeleton

Generated from the manifests. The lead completes it by hand (spec sections, reused 0.6 files, traps, first two hours).

## Modules

### access

Capabilities to implement: 58. Events to emit: 18. Contract tests that must go green: `generated/tests/access/`.

Capabilities:
- access.actors.create (write, access.manage, level view)
- access.actors.list (read, access.manage, level view)
- access.actors.redeem (write, grant only, level view)
- access.actors.revoke (write, access.manage, level view)
- access.actors.set_engineer_mcp (write, access.manage, level view)
- access.actors.update (write, access.manage, level view)
- access.check (read, access.manage, level view)
- access.grants.list (read, access.manage, level view)
- access.grants.update (write, grant only, level view)
- access.groups.add_member (write, access.manage, level view)
- access.groups.create (write, access.manage, level view)
- access.groups.defaults_get (read, grant only, level view)
- access.groups.defaults_set (write, access.manage, level view)
- access.groups.delete (write, access.manage, level view)
- access.groups.get (read, grant only, level view)
- access.groups.list (read, grant only, level view)
- access.groups.remove_member (write, access.manage, level view)
- access.groups.update (write, access.manage, level view)
- access.labels.list (read, grant only, level view)
- access.labels.set (write, policy.manage, level view)
- access.lists (read, grant only, level view)
- access.policies.list (read, policy.manage, level view)
- access.policies.reset (write, policy.manage, level view)
- access.policies.set (write, policy.manage, level view)
- access.principals.effective (read, access.manage, level view)
- access.principals.get (read, grant only, level view)
- access.principals.list (read, grant only, level view)
- access.projection_health (read, grant only, level view)
- access.propose_change (write, grant only, level view)
- access.request (write, grant only, level member)
- access.requests.approve (write, grant only, level view)
- access.requests.decline (write, grant only, level view)
- access.requests.list (read, grant only, level view)
- access.reviews.close (write, access.manage, level view)
- access.reviews.decide (write, access.manage, level view)
- access.reviews.get (read, access.manage, level view)
- access.reviews.list (read, access.manage, level view)
- access.reviews.start (write, access.manage, level view)
- access.roles.apply (write, access.manage, level view)
- access.roles.assign (write, access.manage, level view)
- access.roles.create (write, access.manage, level view)
- access.roles.delete (write, access.manage, level view)
- access.roles.get (read, grant only, level view)
- access.roles.list (read, grant only, level view)
- access.roles.preview (read, access.manage, level view)
- access.roles.unassign (write, access.manage, level view)
- access.roles.update (write, access.manage, level view)
- access.share (write, grant only, level view)
- access.shares_of (read, grant only, level view)
- access.unshare (write, grant only, level view)
- access.view_as (read, access.manage, level view)
- folders.create (write, grant only, level view)
- folders.delete (write, grant only, level manage, gate delete)
- folders.list (read, grant only, level view)
- folders.move (write, grant only, level manage)
- folders.place (write, grant only, level view)
- folders.rename (write, grant only, level manage)
- folders.unplace (write, grant only, level view)

Events:
- access.changed
- access.declined
- access.everyone_defaults_changed
- access.granted
- access.requested
- access_review.closed
- access_review.opened
- folder.shared
- grant.created
- grant.revoked
- grant.updated
- item.moved
- policy.changed
- principal.created
- principal.reactivated
- principal.suspended
- token.revoked
- view_as.started

### audit

Capabilities to implement: 10. Events to emit: 4. Contract tests that must go green: `generated/tests/audit/`.

Capabilities:
- audit.append (write, grant only, level view)
- audit.archive (write, grant only, level view)
- audit.archives.list (read, audit.read, level view)
- audit.chain_health (read, grant only, level view)
- audit.checkpoint (write, grant only, level view)
- audit.checkpoints.list (read, audit.read, level view)
- audit.export (read, audit.read, level view)
- audit.get (read, audit.read, level view)
- audit.list (read, audit.read, level view)
- audit.verify (read, audit.read, level view)

Events:
- audit.archived
- audit.checkpointed
- audit.exported
- audit.verified

### devices

Capabilities to implement: 14. Events to emit: 6. Contract tests that must go green: `generated/tests/devices/`.

Capabilities:
- devices.epoch (read, grant only, level view)
- devices.epoch_bump (write, grant only, level view)
- devices.get (read, grant only, level view)
- devices.list (read, access.manage, level view)
- devices.mine (read, grant only, level view)
- devices.purge_ack (write, grant only, level view)
- devices.register (write, grant only, level view)
- devices.rename (write, grant only, level view)
- devices.revoke (write, grant only, level view)
- devices.revoke_others (write, grant only, level view)
- devices.rotate_space_key (write, access.manage, level view)
- devices.sessions.list (read, grant only, level view)
- devices.sessions.revoke (write, grant only, level view)
- devices.touch (write, grant only, level view)

Events:
- device.purged
- device.registered
- device.revoked
- epoch.bumped
- session.revoked
- session.started

### governance

Capabilities to implement: 15. Events to emit: 6. Contract tests that must go green: `generated/tests/governance/`.

Capabilities:
- governance.erase.apply (write, policy.manage, level view, gate delete)
- governance.erase.find (read, policy.manage, level view)
- governance.erase.list (read, policy.manage, level view)
- governance.holds.list (read, records.hold, level view)
- governance.holds.place (write, records.hold, level view)
- governance.holds.release (write, records.hold, level view)
- governance.jobs.list (read, policy.manage, level view)
- governance.jobs.run_now (write, policy.manage, level view)
- governance.jobs.tick (write, grant only, level view)
- governance.jobs_health (read, grant only, level view)
- governance.retention.get (read, policy.manage, level view)
- governance.retention.reset (write, policy.manage, level view)
- governance.retention.set (write, policy.manage, level view)
- governance.tombstones.list (read, policy.manage, level view)
- governance.tombstones.reapply (write, grant only, level view, gate delete)

Events:
- erase.completed
- erase.started
- hold.placed
- hold.released
- retention.purged
- tombstones.reapplied

### identity

Capabilities to implement: 27. Events to emit: 10. Contract tests that must go green: `generated/tests/identity/`.

Capabilities:
- identity.change_password (write, grant only, level view)
- identity.claim_owner (write, grant only, level view)
- identity.github_link (write, grant only, level view)
- identity.github_sign_in (write, grant only, level view)
- identity.github_unlink (write, grant only, level view)
- identity.keys_get (read, grant only, level view)
- identity.keys_put (write, grant only, level view)
- identity.pair_create (write, grant only, level view)
- identity.pair_redeem (write, grant only, level view)
- identity.passkey_register (write, grant only, level view)
- identity.passkey_remove (write, grant only, level view)
- identity.recovery_restore (write, grant only, level view)
- identity.recovery_save (write, grant only, level view)
- identity.reset_complete (write, grant only, level view)
- identity.reset_preview (read, access.manage, level view)
- identity.reset_start (write, access.manage, level view)
- identity.sign_in (write, grant only, level view)
- identity.sign_in_options (read, grant only, level view)
- identity.sign_out (write, grant only, level view)
- identity.sso_sign_in (write, grant only, level view)
- identity.totp_begin (write, grant only, level view)
- identity.totp_confirm (write, grant only, level view)
- identity.totp_remove (write, grant only, level view)
- identity.username_available (read, grant only, level view)
- identity.verify_second_factor (write, grant only, level view)
- identity.whoami (read, grant only, level view)
- invites.accept_create_account (write, grant only, level view)

Events:
- factor.enrolled
- factor.removed
- github.linked
- github.unlinked
- keys.stored
- password.changed
- password.reset
- recovery.saved
- signin.failed
- signin.succeeded

### members

Capabilities to implement: 17. Events to emit: 5. Contract tests that must go green: `generated/tests/members/`.

Capabilities:
- members.accept (write, grant only, level view)
- members.invites.create (write, members.invite, level view)
- members.invites.extend (write, members.invite, level view)
- members.invites.list (read, members.invite, level view)
- members.invites.preview (read, grant only, level view)
- members.invites.revoke (write, members.invite, level view)
- members.reactivate (write, members.remove, level view)
- members.remove (write, members.remove, level view, gate delete)
- members.remove_preview (read, members.remove, level view)
- members.second_factor.report (read, policy.manage, level view)
- members.sign_in_policy.get (read, policy.manage, level view)
- members.sign_in_policy.set (write, policy.manage, level view)
- members.sso.list (read, policy.manage, level view)
- members.sso.remove (write, policy.manage, level view)
- members.sso.set (write, policy.manage, level view)
- members.sso.test (read, policy.manage, level view)
- members.suspend (write, members.remove, level view)

Events:
- member.invite_revoked
- member.invited
- member.joined
- member.removal_plan_applied
- member.removed

### settings

Capabilities to implement: 14. Events to emit: 2. Contract tests that must go green: `generated/tests/settings/`.

Capabilities:
- settings.copy_profile (write, grant only, level view)
- settings.copy_source (read, grant only, level view)
- settings.floor_set (write, policy.manage, level view)
- settings.get (read, grant only, level view)
- settings.kit.get (read, grant only, level view)
- settings.kit.set_mine (write, grant only, level view)
- settings.kit.set_space (write, kits.install, level view)
- settings.list (read, grant only, level view)
- settings.pages (read, grant only, level view)
- settings.reset (write, grant only, level view)
- settings.reset_space (write, policy.manage, level view)
- settings.search (read, grant only, level view)
- settings.set (write, grant only, level view)
- settings.set_space (write, policy.manage, level view)

Events:
- settings.changed
- settings.floor_changed

### spaces

Capabilities to implement: 16. Events to emit: 10. Contract tests that must go green: `generated/tests/spaces/`.

Capabilities:
- follows.list (read, grant only, level view)
- follows.toggle (write, grant only, level view)
- spaces.delete (write, grant only, level manage, gate delete)
- spaces.export (write, records.export, level manage)
- spaces.get (read, grant only, level view)
- spaces.leave (write, grant only, level view)
- spaces.matrix (read, grant only, level view)
- spaces.onboarding.complete (write, grant only, level view)
- spaces.onboarding.dismiss (write, grant only, level view)
- spaces.onboarding.get (read, grant only, level view)
- spaces.switch_address (write, server.network, level manage)
- spaces.switcher (read, grant only, level view)
- spaces.transfer_ownership (write, grant only, level manage)
- spaces.update (write, policy.manage, level view)
- stars.list (read, grant only, level view)
- stars.toggle (write, grant only, level view)

Events:
- follow.added
- follow.removed
- onboarding.dismissed
- onboarding.step_completed
- space.address_changed
- space.deleted
- space.ownership_transferred
- space.updated
- star.added
- star.removed

### vault

Capabilities to implement: 43. Events to emit: 20. Contract tests that must go green: `generated/tests/vault/`.

Capabilities:
- providers.add (write, grant only, level view)
- providers.catalog (read, grant only, level view)
- providers.list (read, grant only, level view)
- providers.remove (write, grant only, level view, gate delete)
- providers.set_space_use (write, grant only, level view)
- providers.subscription_complete (write, grant only, level view)
- providers.subscription_start (write, grant only, level view)
- providers.test (read, grant only, level view)
- vault.export_env (outward, vault.export, level use, gate secret_export)
- vault.exports.list (read, vault.export, level view)
- vault.exports.revoke (write, vault.export, level view)
- vault.fill (write, grant only, level use)
- vault.folders.create (write, vault.shared_create, level view)
- vault.folders.delete (write, grant only, level manage, gate delete)
- vault.folders.list (read, grant only, level view)
- vault.folders.update (write, grant only, level manage)
- vault.generate (read, grant only, level view)
- vault.health (read, grant only, level view)
- vault.import (write, vault.shared_create, level edit)
- vault.import_parse (read, vault.shared_create, level view)
- vault.inject_env (write, grant only, level use)
- vault.item.delete (write, grant only, level manage, gate delete)
- vault.item.get (read, grant only, level use)
- vault.item.history (read, grant only, level edit)
- vault.item.mark_rotated (write, grant only, level edit)
- vault.item.move (write, grant only, level manage)
- vault.item.put (write, vault.shared_create, level edit)
- vault.item.restore (write, grant only, level manage)
- vault.item.reveal (read, grant only, level view)
- vault.item.update (write, grant only, level edit)
- vault.item.usage (read, grant only, level view)
- vault.items.export_mine (outward, grant only, level view, gate secret_export)
- vault.items.list (read, grant only, level view)
- vault.items.match (read, grant only, level view)
- vault.policy.get (read, vault.policy, level view)
- vault.policy.set (write, vault.policy, level view)
- vault.report_scrub_miss (write, grant only, level view)
- vault.service_health (read, grant only, level view)
- vault.share (write, grant only, level view)
- vault.site_rules.list (read, grant only, level view)
- vault.site_rules.set (write, grant only, level view)
- vault.unshare (write, grant only, level view)
- vault.use (write, grant only, level use)

Events:
- provider.added
- provider.removed
- provider.updated
- vault.export_revoked
- vault.exported
- vault.folder_created
- vault.folder_deleted
- vault.folder_updated
- vault.imported
- vault.item_created
- vault.item_deleted
- vault.item_moved
- vault.item_restored
- vault.item_rotated
- vault.item_updated
- vault.revealed
- vault.rotation_due
- vault.scrub_miss
- vault.site_rule_changed
- vault.used

### vault-requests

Capabilities to implement: 6. Events to emit: 4. Contract tests that must go green: `generated/tests/vault-requests/`.

Capabilities:
- vault.request (write, grant only, level view)
- vault.requests.cancel (write, grant only, level view)
- vault.requests.decline (write, grant only, level view)
- vault.requests.fulfil (write, grant only, level view)
- vault.requests.get (read, grant only, level view)
- vault.requests.list (read, grant only, level view)

Events:
- vault.request_canceled
- vault.request_declined
- vault.request_fulfilled
- vault.requested
