# Lane L7b: brief skeleton

Generated from the manifests. The lead completes it by hand (spec sections, reused 0.6 files, traps, first two hours).

## Modules

### backup

Capabilities to implement: 10. Events to emit: 5. Contract tests that must go green: `generated/tests/backup/`.

Capabilities:
- backup.config_get (read, server.backups, level view)
- backup.config_set (write, server.backups, level manage)
- backup.delete (write, server.backups, level manage, gate delete)
- backup.export_start (write, server.backups, level manage)
- backup.health (read, grant only, level view)
- backup.list (read, server.backups, level view)
- backup.restore (write, server.backups, level manage, gate delete)
- backup.restore_preview (read, server.backups, level view)
- backup.run (outward, server.backups, level manage, gate none)
- backup.verify (write, server.backups, level edit)

Events:
- backup.completed
- backup.config_changed
- backup.failed
- backup.restored
- backup.verified

### console-assistant

Capabilities to implement: 7. Events to emit: 3. Contract tests that must go green: `generated/tests/console-assistant/`.

Capabilities:
- console.assistant_context_set (write, console.access, level edit)
- console.assistant_open (write, console.access, level edit)
- console.assistant_tools (read, engineer.mcp, level view)
- console.diff_apply (write, console.access, level manage)
- console.diff_propose (write, console.access, level edit)
- console.diff_reject (write, console.access, level edit)
- console.explain_access (read, access.manage, level view)

Events:
- console.change_applied
- console.change_proposed
- console.change_rejected

### console-views

Capabilities to implement: 6. Events to emit: 0. Contract tests that must go green: `generated/tests/console-views/`.

Capabilities:
- console.activity (read, console.access, level view)
- console.attention (read, console.access, level view)
- console.nav (read, console.access, level view)
- console.overview (read, console.access, level view)
- console.speed (read, console.access, level view)
- console.usage (read, console.access, level view)

Events:

### health

Capabilities to implement: 17. Events to emit: 5. Contract tests that must go green: `generated/tests/health/`.

Capabilities:
- health.caddy (read, grant only, level view)
- health.disk_encrypted (read, grant only, level view)
- health.disk_space (read, grant only, level view)
- health.docker (read, grant only, level view)
- health.doctor (read, console.access, level view)
- health.events_db (read, grant only, level view)
- health.history (read, console.access, level view)
- health.index_db (read, grant only, level view)
- health.machine (read, console.access, level view)
- health.paused_reasons (read, grant only, level view)
- health.run (write, console.access, level edit)
- health.scheduler (read, grant only, level view)
- health.service_restart (write, server.services, level manage, gate none)
- health.services (read, server.services, level view)
- health.status (read, console.access, level view)
- health.support_bundle (write, server.logs, level edit)
- health.time_skew (read, grant only, level view)

Events:
- health.changed
- health.paused
- health.resumed
- service.restarted
- support_bundle.created

### logs

Capabilities to implement: 11. Events to emit: 5. Contract tests that must go green: `generated/tests/logs/`.

Capabilities:
- logs.client_upload (write, grant only, level edit)
- logs.export (read, server.logs, level view)
- logs.purge (write, policy.manage, level manage)
- logs.query (read, server.logs, level view)
- logs.replay_get (read, server.logs, level view)
- logs.replay_start (write, server.logs, level manage)
- logs.settings_get (read, server.logs, level view)
- logs.settings_set (write, policy.manage, level manage)
- logs.spans (read, server.logs, level view)
- logs.tail (read, server.logs, level view)
- logs.trace (read, server.logs, level view)

Events:
- client_log.uploaded
- log.accessed
- logs.purged
- replay.finished
- replay.started

### network

Capabilities to implement: 12. Events to emit: 5. Contract tests that must go green: `generated/tests/network/`.

Capabilities:
- network.certificate_renew (write, server.network, level edit)
- network.domain_set (write, server.network, level manage)
- network.endpoints (read, grant only, level view)
- network.health (read, grant only, level view)
- network.ingress_check (read, server.network, level view)
- network.public_hostnames (read, server.network, level view)
- network.relay_set (write, server.network, level manage)
- network.server_join_code (write, server.network, level manage)
- network.server_reconnect (write, server.network, level edit)
- network.server_remove (write, server.network, level manage, gate delete)
- network.servers (read, console.access, level view)
- network.status (read, server.network, level view)

Events:
- network.certificate_failed
- network.certificate_renewed
- network.domain_changed
- network.server_added
- network.server_removed

### reports-client

Capabilities to implement: 9. Events to emit: 3. Contract tests that must go green: `generated/tests/reports-client/`.

Capabilities:
- reports.get (read, grant only, level view)
- reports.health (read, grant only, level view)
- reports.list (read, grant only, level view)
- reports.policy_get (read, policy.manage, level view)
- reports.policy_set (write, policy.manage, level manage)
- reports.preview (read, grant only, level view)
- reports.resolved (write, grant only, level edit)
- reports.send_to_vyre (outward, grant only, level use, gate none)
- reports.submit (write, grant only, level edit)

Events:
- report.resolved
- report.sent_to_vyre
- report.submitted

### updates

Capabilities to implement: 8. Events to emit: 4. Contract tests that must go green: `generated/tests/updates/`.

Capabilities:
- updates.app_compat (read, grant only, level view)
- updates.apply (write, server.update, level manage)
- updates.channel_set (write, server.update, level manage)
- updates.check (read, server.update, level view)
- updates.health (read, grant only, level view)
- updates.history (read, server.update, level view)
- updates.rollback (write, server.update, level manage)
- updates.status (read, server.update, level view)

Events:
- update.completed
- update.failed
- update.rolled_back
- update.started
