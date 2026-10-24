# google.receive_push

Record a verified Google push (Gmail Pub/Sub, Calendar channel, Drive changes, Meet events) after dedupe

| | |
|---|---|
| Module | google |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/google/receive_push |
| MCP tool | none |
| CLI | none |
| Emits | google.push_received |

## Input

```ts
type In = {
  kind: "gmail" | "calendar" | "drive" | "meet";
  messageId: string;
  mailbox?: string;
  historyId?: string;
  channelId?: string;
  resourceState?: string;
  resourceId?: string;
};
```

## Output

```ts
type Out = {
  accepted: boolean;
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
    "channelId": "example",
    "historyId": "example",
    "kind": "gmail",
    "mailbox": "maya@example.com",
    "messageId": "example",
    "resourceId": "example",
    "resourceState": "example"
  },
  "output": {
    "accepted": true
  }
}
```
