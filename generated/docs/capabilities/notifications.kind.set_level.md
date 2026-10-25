# notifications.kind.set_level

Set how one kind of notification reaches me: its level and which of desktop, phone and email carry it. Give a level, channels, or both; channels alone pick the level (desktop or phone interrupt, otherwise badge). Approval reminders and owned incidents never go below Interrupt

| | |
|---|---|
| Module | notifications |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/notifications/kind/set_level |
| MCP tool | notifications_kind_set_level (meta) |
| CLI | none |
| Emits | notification.rules_changed |

## Input

```ts
type In = {
  kind: "approval.requested" | "approval.backstop" | "dm" | "mention" | "call.incoming" | "agent.blocked" | "incident.owned" | "task.assigned" | "reply.followed" | "agent.task_finished" | "campaign.reply" | "digest.away" | "mention.thread" | "run.failed" | "conflict.needs_you" | "access.requested" | "access.decided" | "sync.attention" | "health.degraded" | "problem.report" | "member.joined" | "limit.hit" | "vault.rotation_due";
  level?: "interrupt" | "badge" | "digest";
  channels?: Array<"desktop" | "phone" | "email">;
};
```

## Output

```ts
type Out = {
  kind: "approval.requested" | "approval.backstop" | "dm" | "mention" | "call.incoming" | "agent.blocked" | "incident.owned" | "task.assigned" | "reply.followed" | "agent.task_finished" | "campaign.reply" | "digest.away" | "mention.thread" | "run.failed" | "conflict.needs_you" | "access.requested" | "access.decided" | "sync.attention" | "health.degraded" | "problem.report" | "member.joined" | "limit.hit" | "vault.rotation_due";
  level: "interrupt" | "badge" | "digest";
  channels: Array<"desktop" | "phone" | "email">;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "channels": [
      "desktop"
    ],
    "kind": "approval.requested",
    "level": "interrupt"
  },
  "output": {
    "channels": [
      "desktop"
    ],
    "kind": "approval.requested",
    "level": "interrupt"
  }
}
```
