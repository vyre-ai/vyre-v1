# tasks.withdraw

Withdraw open requests whose source chat or run stopped or whose item changed, with a note

| | |
|---|---|
| Module | tasks |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/tasks/withdraw |
| MCP tool | none |
| CLI | none |
| Emits | task.withdrawn |

## Input

```ts
type In = {
  taskId?: string;
  sourceKind?: "chat" | "run" | "gate" | "journey";
  sourceId?: string;
  note: string;
};
```

## Output

```ts
type Out = {
  withdrawn: number;
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
    "note": "example",
    "sourceId": "example",
    "sourceKind": "chat",
    "taskId": "tsk_a1b2c3"
  },
  "output": {
    "withdrawn": 1
  }
}
```
