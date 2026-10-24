# memory.promote

Promote a fact to the agent, a project or the Space layer; a task for the right approver carries the name and time, no admin needed when the person can edit the target

| | |
|---|---|
| Module | memory |
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
| HTTP | POST /v1/memory/promote |
| MCP tool | memory_promote (memory) |
| CLI | none |
| Emits | memory.promotion_requested, memory.promoted |

## Input

```ts
type In = {
  factId: string;
  toLayer: "agent" | "project" | "space";
  agentId?: string;
  projectId?: string;
  note?: string;
};
```

## Output

```ts
type Out = {
  promotionId: string;
  promoted: boolean;
  taskId?: string;
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
    "agentId": "agt_a1b2c3",
    "factId": "fct_a1b2c3",
    "note": "example",
    "projectId": "prj_a1b2c3",
    "toLayer": "agent"
  },
  "output": {
    "promoted": true,
    "promotionId": "prm_a1b2c3",
    "taskId": "tsk_a1b2c3"
  }
}
```
