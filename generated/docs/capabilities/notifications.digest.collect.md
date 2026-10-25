# notifications.digest.collect

Gather digest-level items for a person and period (input to the While you were away digest)

| | |
|---|---|
| Module | notifications |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/notifications/digest/collect |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  person: string;
  since: number;
  until?: number;
};
```

## Output

```ts
type Out = {
  items: Array<{
      kind: "approval.requested" | "approval.backstop" | "dm" | "mention" | "call.incoming" | "agent.blocked" | "incident.owned" | "task.assigned" | "reply.followed" | "agent.task_finished" | "campaign.reply" | "digest.away" | "mention.thread" | "run.failed" | "conflict.needs_you" | "access.requested" | "access.decided" | "sync.attention" | "health.degraded" | "problem.report" | "member.joined" | "limit.hit" | "vault.rotation_due";
      title: string;
      at: number;
      subject?: {
        type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
        id: string;
      };
      count: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "person": "example",
    "since": 1760000000000,
    "until": 1760000000000
  },
  "output": {
    "items": [
      {
        "at": 1760000000000,
        "count": 1,
        "kind": "approval.requested",
        "subject": {
          "id": "rec_a1b2c3",
          "type": "space"
        },
        "title": "example"
      }
    ]
  }
}
```
