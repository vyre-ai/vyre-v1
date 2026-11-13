# threads.open_state

System: whether a chat still exists and whether it is closed, and nothing else, for the host's clean-up jobs. A private chat answers like any other: its content and members stay unreadable

| | |
|---|---|
| Module | chat |
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
| HTTP | POST /v1/threads/open_state |
| MCP tool | none |
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
  exists: boolean;
  closed: boolean;
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
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "closed": true,
    "exists": true
  }
}
```
