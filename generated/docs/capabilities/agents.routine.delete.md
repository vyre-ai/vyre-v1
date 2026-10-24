# agents.routine.delete

Delete a routine

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | agents.schedule |
| Grant level | edit |
| Risk | medium |
| Resource | agent (/agentId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/agents/routine/delete |
| MCP tool | agents_routine_delete (agents) |
| CLI | none |
| Emits | agent.routine_changed |

## Input

```ts
type In = {
  agentId: string;
  routineId: string;
};
```

## Output

```ts
type Out = {
  deleted: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "routineId": "rtn_a1b2c3"
  },
  "output": {
    "deleted": true
  }
}
```
