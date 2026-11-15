# agents.delete_for_good

Delete an agent in Trash for good: its memory, its one-to-one chats, its computer, its folder, its access and what it ran are erased; what others built that names it asks them to choose another agent. Not an Assistant

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | high |
| Resource | agent (/agentId) |
| Gate | delete when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/agents/delete_for_good |
| MCP tool | agents_delete_for_good (agents) |
| CLI | none |
| Emits | agent.erasing, agent.erased |

## Input

```ts
type In = {
  agentId: string;
};
```

## Output

```ts
type Out = {
  erasing: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.on_hold
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3"
  },
  "output": {
    "erasing": true
  }
}
```
