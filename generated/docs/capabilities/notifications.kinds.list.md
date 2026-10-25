# notifications.kinds.list

The notification kinds with level and place, for the settings page

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
| HTTP | POST /v1/notifications/kinds/list |
| MCP tool | notifications_kinds_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  kinds: Array<{
      key: "approval.requested" | "approval.backstop" | "dm" | "mention" | "call.incoming" | "agent.blocked" | "incident.owned" | "task.assigned" | "reply.followed" | "agent.task_finished" | "campaign.reply" | "digest.away" | "mention.thread" | "run.failed" | "conflict.needs_you" | "access.requested" | "access.decided" | "sync.attention" | "health.degraded" | "problem.report" | "member.joined" | "limit.hit" | "vault.rotation_due";
      level: "interrupt" | "badge" | "digest";
      place: "home" | "chats" | "inbox" | "records" | "files" | "apps" | "automations" | "vault" | "settings" | "console";
      title: string;
      respectHours: boolean;
      mine?: {
        level: "interrupt" | "badge" | "digest";
        channels: Array<"desktop" | "phone" | "email">;
      };
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
  "input": {},
  "output": {
    "kinds": [
      {
        "key": "approval.requested",
        "level": "interrupt",
        "mine": {
          "channels": [
            "desktop"
          ],
          "level": "interrupt"
        },
        "place": "home",
        "respectHours": true,
        "title": "example"
      }
    ]
  }
}
```
