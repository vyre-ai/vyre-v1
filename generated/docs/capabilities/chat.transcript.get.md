# chat.transcript.get

Read one turn of a transcript verbatim

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
| HTTP | POST /v1/chat/transcript/get |
| MCP tool | transcript_get (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  turnId: string;
};
```

## Output

```ts
type Out = {
  turnId: string;
  rows: Array<{
      idx: number;
      role: string;
      kind: string;
      content: unknown;
      toolName?: string;
      at: number;
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
    "threadId": "thr_a1b2c3",
    "turnId": "trn_a1b2c3"
  },
  "output": {
    "rows": [
      {
        "at": 1760000000000,
        "content": {},
        "idx": 1,
        "kind": "example",
        "role": "example",
        "toolName": "example"
      }
    ],
    "turnId": "trn_a1b2c3"
  }
}
```
