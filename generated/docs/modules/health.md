# Health and diagnostics (health)

Lane L7b. Kind module. Status stub. Version 0.1.0.

Requires: nothing.

## Capabilities (16)

- [health.caddy](../capabilities/health.caddy.md): Probe: Caddy admin API answers and routes are loaded
- [health.disk_encrypted](../capabilities/health.disk_encrypted.md): Probe: the data directory sits on an encrypted volume (FileVault, LUKS, dm-crypt)
- [health.disk_space](../capabilities/health.disk_space.md): Probe: free disk space on the data directory
- [health.docker](../capabilities/health.docker.md): Probe: Docker (or Colima) answers on its socket
- [health.doctor](../capabilities/health.doctor.md): Doctor results: each check with a plain next step; same output as `vyre-server doctor`
- [health.events_db](../capabilities/health.events_db.md): Probe: events.db opens, hash chain head verifies, writer queue is short
- [health.history](../capabilities/health.history.md): Samples of a health check over time
- [health.index_db](../capabilities/health.index_db.md): Probe: search index lag behind the log head
- [health.paused_reasons](../capabilities/health.paused_reasons.md): What is paused and why (shown on the paused automation, sync or campaign)
- [health.run](../capabilities/health.run.md): Run one health check or all of them now
- [health.scheduler](../capabilities/health.scheduler.md): Probe: the scheduler ticked in the last minute
- [health.service_restart](../capabilities/health.service_restart.md): Restart a server service
- [health.services](../capabilities/health.services.md): Server services with state, uptime and restart count
- [health.status](../capabilities/health.status.md): Latest state of every health check, grouped by module
- [health.support_bundle](../capabilities/health.support_bundle.md): Make a support bundle: versions, recent traces, health, logs without content (works with the gateway down through the CLI)
- [health.time_skew](../capabilities/health.time_skew.md): Probe: clock skew against the relay (HLC clamps at 5 minutes)

## Events (5)

- [health.changed](../events/health.changed.md): A health check changed state
- [health.paused](../events/health.paused.md): An unhealthy dependency paused automations, sync, sends or campaigns
- [health.resumed](../events/health.resumed.md): A paused area resumed after its dependency recovered
- [service.restarted](../events/service.restarted.md): A server service was restarted
- [support_bundle.created](../events/support_bundle.created.md): A support bundle was made (ids and metadata only, no content)
