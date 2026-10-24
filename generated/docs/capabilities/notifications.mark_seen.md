# notifications.mark_seen

Mark notifications seen by ids or for a whole place

| | |
|---|---|
| Module | notifications |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/notifications/mark_seen |
| MCP tool | notifications_mark_seen (meta) |
| CLI | none |
| Emits | notification.seen |

## Input

```ts
type In = {
  notificationIds?: Array<string>;
  place?: "home" | "chats" | "inbox" | "records" | "files" | "apps" | "automations" | "vault" | "settings" | "console";
};
```

## Output

```ts
type Out = {
  marked: number;
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
    "notificationIds": [
      "ntf_a1b2c3"
    ],
    "place": "home"
  },
  "output": {
    "marked": 1
  }
}
```
