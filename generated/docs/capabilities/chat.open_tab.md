# chat.open_tab

Open a side tab beside the chat for the person (a file, record, diff, terminal); respects the person tab setting and posts a line

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/open_tab |
| MCP tool | open_tab (chats) |
| CLI | none |
| Emits | tab.opened, message.received |

## Input

```ts
type In = {
  threadId: string;
  targetType: string;
  targetId: string;
  title?: string;
};
```

## Output

```ts
type Out = {
  opened: boolean;
  reason?: "disabled_by_person" | "no_device";
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "targetId": "example",
    "targetType": "file",
    "threadId": "thr_a1b2c3",
    "title": "example"
  },
  "output": {
    "opened": true,
    "reason": "disabled_by_person"
  }
}
```
