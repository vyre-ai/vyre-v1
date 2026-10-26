# threads.erase

Erase one chat thread for good: messages, blocks, pins, reactions, attachment links, transcript rows, summaries and search entries (governance erase)

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/threads/erase |
| MCP tool | none |
| CLI | none |
| Emits | thread.erased |

## Input

```ts
type In = {
  threadId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  erased: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "erased": true
  }
}
```
