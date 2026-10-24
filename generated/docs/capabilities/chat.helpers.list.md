# chat.helpers.list

Helpers running under a chat, with status

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/helpers/list |
| MCP tool | chat_helpers_list (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
};
```

## Output

```ts
type Out = {
  helpers: Array<{
      threadId: string;
      title: string;
      status: "running" | "done" | "failed" | "stopped";
      agentId: string;
      model?: string;
      startedAt: number;
    }>;
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
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "helpers": [
      {
        "agentId": "agt_a1b2c3",
        "model": "example",
        "startedAt": 1760000000000,
        "status": "running",
        "threadId": "thr_a1b2c3",
        "title": "example"
      }
    ]
  }
}
```
