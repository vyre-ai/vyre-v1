# notifications.send

Notify a person of a kind; collapses repeats, respects hours, mutes and away, enforces the agent interrupt cap and the one-device rule

| | |
|---|---|
| Module | notifications |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/notifications/send |
| MCP tool | notifications_send (meta) |
| CLI | none |
| Emits | notification.delivered, notification.capped |

## Input

```ts
type In = {
  to: string;
  kind: "approval.requested" | "approval.backstop" | "dm" | "mention" | "call.incoming" | "agent.blocked" | "incident.owned" | "task.assigned" | "reply.followed" | "agent.task_finished" | "campaign.reply" | "digest.away" | "mention.thread" | "run.failed" | "conflict.needs_you" | "access.requested" | "access.decided" | "sync.attention" | "health.degraded" | "problem.report" | "member.joined" | "limit.hit" | "vault.rotation_due";
  subject?: {
    type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
    id: string;
  };
  data?: Record<string, unknown>;
  title?: string;
  body?: string;
  collapseKey?: string;
  runId?: string;
};
```

## Output

```ts
type Out = {
  outcome: "interrupt" | "badge" | "digest" | "dropped_muted" | "capped";
  notificationId?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.network
- provider.unavailable
- rate_limit.exceeded
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "body": "example",
    "collapseKey": "example",
    "data": {},
    "kind": "approval.requested",
    "runId": "run_a1b2c3",
    "subject": {
      "id": "rec_a1b2c3",
      "type": "space"
    },
    "title": "example",
    "to": "usr_a1b2c3"
  },
  "output": {
    "notificationId": "ntf_a1b2c3",
    "outcome": "interrupt"
  }
}
```
