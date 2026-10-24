# gate.release

Re-invoke the parked capability with an approval token bound to the payload hash, then resume the turn or step

| | |
|---|---|
| Module | gate |
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
| HTTP | POST /v1/gate/release |
| MCP tool | none |
| CLI | none |
| Emits | gate.approved |

## Input

```ts
type In = {
  holdId: string;
  taskId: string;
  approvalToken: string;
};
```

## Output

```ts
type Out = {
  result: unknown;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.expired
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "approvalToken": "example",
    "holdId": "hld_a1b2c3",
    "taskId": "tsk_a1b2c3"
  },
  "output": {
    "result": {}
  }
}
```
