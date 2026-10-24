# computers.skill_from_step

Make a skill from this point in a session: starts a turn that writes the skill into the agent folder

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | computers.use |
| Grant level | edit |
| Risk | medium |
| Resource | computer (/computerId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/computers/skill_from_step |
| MCP tool | computers_skill_from_step (computer) |
| CLI | none |
| Emits | computer.skill_requested |

## Input

```ts
type In = {
  computerId: string;
  stepId: string;
  name?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  taskId: string;
  runId?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "computerId": "cmt_a1b2c3",
    "idempotencyKey": "idem_1",
    "name": "example",
    "stepId": "stp_a1b2c3"
  },
  "output": {
    "runId": "run_a1b2c3",
    "taskId": "tsk_a1b2c3"
  }
}
```
