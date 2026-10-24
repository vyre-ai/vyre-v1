# engine.turn.wait

Park a turn until a task, an answered block, a run or a time

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/turn/wait |
| MCP tool | none |
| CLI | none |
| Emits | turn.waiting |

## Input

```ts
type In = {
  turnId: string;
  taskId?: string;
  blockId?: string;
  runId?: string;
  until?: number;
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

## Example

```json
{
  "name": "example",
  "input": {
    "blockId": "blk_a1b2c3",
    "runId": "run_a1b2c3",
    "taskId": "tsk_a1b2c3",
    "turnId": "trn_a1b2c3",
    "until": 1760000000000
  },
  "output": {
    "ok": true
  }
}
```
