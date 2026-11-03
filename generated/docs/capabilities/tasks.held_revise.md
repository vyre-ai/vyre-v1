# tasks.held_revise

Rewrite the card of a held act and the hash its approval is bound to (the Gate's edit of a held message; not for a person or an agent to call)

| | |
|---|---|
| Module | tasks |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | task (/taskId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/tasks/held_revise |
| MCP tool | none |
| CLI | none |
| Emits | task.updated |

## Input

```ts
type In = {
  taskId: string;
  blocks: Array<{
      type: string;
      v?: number;
      data: unknown;
    }>;
  payloadHash: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "blocks": [
      {
        "data": {},
        "type": "record_card",
        "v": 1
      }
    ],
    "payloadHash": "example",
    "taskId": "tsk_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
