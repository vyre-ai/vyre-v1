# chat.transcript.read

Read a window of a transcript as Markdown (the chats/<id>/transcript.md view)

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
| HTTP | POST /v1/chat/transcript/read |
| MCP tool | transcript_read (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  fromIdx?: number;
  limit?: number;
};
```

## Output

```ts
type Out = {
  markdown: string;
  next?: number;
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
    "fromIdx": 1,
    "limit": 1,
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "markdown": "example",
    "next": 1
  }
}
```
