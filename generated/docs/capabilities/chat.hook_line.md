# chat.hook_line

Hooks module only: leave a quiet line in a chat when a hook is added, changed, removed or paused, when one stops something, or when one could not finish

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
| HTTP | POST /v1/chat/hook_line |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  body: string;
  kind: "added" | "changed" | "removed" | "paused" | "resumed" | "blocked" | "failed" | "allowed" | "asked";
  hookId?: string;
  scope?: string;
  by?: string;
  byKind?: "admin" | "person" | "agent";
  reason?: string;
  tool?: string;
  subject?: string;
  agentId?: string;
  next?: Array<{
      label: string;
      ask: string;
    }>;
};
```

## Output

```ts
type Out = {
  messageId: string;
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
    "agentId": "agt_a1b2c3",
    "body": "example",
    "by": "example",
    "byKind": "admin",
    "hookId": "example",
    "kind": "added",
    "next": [
      {
        "ask": "example",
        "label": "example"
      }
    ],
    "reason": "example",
    "scope": "example",
    "subject": "example",
    "threadId": "thr_a1b2c3",
    "tool": "example"
  },
  "output": {
    "messageId": "msg_a1b2c3"
  }
}
```
