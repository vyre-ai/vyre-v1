# chat.transcript.append

Append canonical transcript rows for a turn (every engine writes here, API drivers directly and CLI drivers through hooks)

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/transcript/append |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  turnId: string;
  rows: Array<{
      role: string;
      kind: string;
      content: unknown;
      toolName?: string;
      toolCallId?: string;
    }>;
};
```

## Output

```ts
type Out = {
  appended: number;
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
    "rows": [
      {
        "content": {},
        "kind": "example",
        "role": "example",
        "toolCallId": "example",
        "toolName": "example"
      }
    ],
    "threadId": "thr_a1b2c3",
    "turnId": "trn_a1b2c3"
  },
  "output": {
    "appended": 1
  }
}
```
