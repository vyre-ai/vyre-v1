# Report a problem (reports-client)

Lane L7b. Kind module. Status stub. Version 0.1.0.

Requires: nothing.

## Capabilities (9)

- [reports.get](../capabilities/reports.get.md): Read one report
- [reports.health](../capabilities/reports.health.md): Probe: reports.vyre.run reachable and the host key registered
- [reports.list](../capabilities/reports.list.md): List problem reports and their state
- [reports.policy_get](../capabilities/reports.policy_get.md): Read the policy Send problem reports to the Vyre team
- [reports.policy_set](../capabilities/reports.policy_set.md): Set the policy to On, Ask or Off; what is captured never changes, only the destination
- [reports.preview](../capabilities/reports.preview.md): Build and preview exactly what would be sent: redacted by label, sealed and Restricted values removed
- [reports.resolved](../capabilities/reports.resolved.md): Inbound: the reporter Space is told the issue closed (webhook from reports.vyre.run)
- [reports.send_to_vyre](../capabilities/reports.send_to_vyre.md): POST the redacted bundle to reports.vyre.run when policy reports.vyre is On
- [reports.submit](../capabilities/reports.submit.md): Submit a problem report (queued offline, sent on reconnect with the original trace ids)

## Events (3)

- [report.resolved](../events/report.resolved.md): The Vyre team closed the issue; the reporter hears back in the Inbox
- [report.sent_to_vyre](../events/report.sent_to_vyre.md): The redacted bundle was posted to reports.vyre.run
- [report.submitted](../events/report.submitted.md): A person reported a problem; admins get a Review task
