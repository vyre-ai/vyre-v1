# agents.routine.fire

System: a routine's time has come (its wake made the fire): start its Run under its owner with the routine's key, only if the routine still exists, is on, is not paused and still agrees with the fire. Says why when it starts nothing

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/agents/routine/fire |
| MCP tool | none |
| CLI | none |
| Emits | agent.routine_run_started |

## Input

```ts
type In = {
  routineId: string;
  dueKey: string;
};
```

## Output

```ts
type Out = {
  started: boolean;
  runId?: string;
  why?: string;
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
    "dueKey": "1793696460000",
    "routineId": "rtn_a1b2c3"
  },
  "output": {
    "runId": "run_a1b2c3",
    "started": true,
    "why": "example"
  }
}
```
