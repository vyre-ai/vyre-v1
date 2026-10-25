# notifications.list

My notifications by place and level, newest first

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
| HTTP | POST /v1/notifications/list |
| MCP tool | notifications_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  place?: "home" | "chats" | "inbox" | "records" | "files" | "apps" | "automations" | "vault" | "settings" | "console";
  level?: "interrupt" | "badge" | "digest";
  unseenOnly?: boolean;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  notifications: Array<{
      id: string;
      kind: "approval.requested" | "approval.backstop" | "dm" | "mention" | "call.incoming" | "agent.blocked" | "incident.owned" | "task.assigned" | "reply.followed" | "agent.task_finished" | "campaign.reply" | "digest.away" | "mention.thread" | "run.failed" | "conflict.needs_you" | "access.requested" | "access.decided" | "sync.attention" | "health.degraded" | "problem.report" | "member.joined" | "limit.hit" | "vault.rotation_due";
      level: "interrupt" | "badge" | "digest";
      place: "home" | "chats" | "inbox" | "records" | "files" | "apps" | "automations" | "vault" | "settings" | "console";
      title: string;
      body?: string;
      subject?: {
        type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
        id: string;
      };
      count: number;
      at: number;
      seenAt?: number;
      actions: Array<{
          label: string;
          cap: string;
        }>;
      spaceId: string;
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "level": "interrupt",
    "limit": 1,
    "place": "home",
    "unseenOnly": true
  },
  "output": {
    "next": "example",
    "notifications": [
      {
        "actions": [
          {
            "cap": "example",
            "label": "example"
          }
        ],
        "at": 1760000000000,
        "body": "example",
        "count": 1,
        "id": "ntf_a1b2c3",
        "kind": "approval.requested",
        "level": "interrupt",
        "place": "home",
        "seenAt": 1760000000000,
        "spaceId": "spc_a1b2c3",
        "subject": {
          "id": "rec_a1b2c3",
          "type": "space"
        },
        "title": "example"
      }
    ],
    "total": 1
  }
}
```
