# agents.routine.delegate

Hand a routine to another person or agent (a person becomes its owner, an agent runs it); undo (no `to`) hands it back to the previous owner and agent

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
| HTTP | POST /v1/agents/routine/delegate |
| MCP tool | agents_routine_delegate (agents) |
| CLI | none |
| Emits | agent.routine_delegated, agent.routine_changed |

## Input

```ts
type In = {
  agentId: string;
  routineId: string;
  to?: {
    kind: "person" | "agent";
    id: string;
  };
  undo?: boolean;
};
```

## Output

```ts
type Out = {
  routine: {
    routineId: string;
    agentId: string;
    title: string;
    cron: string;
    prompt: string;
    channelId?: string;
    enabled: boolean;
    ownerId: string;
    lastRunAt?: number;
    nextRunAt?: number;
  };
  previousOwnerId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "routineId": "rtn_a1b2c3",
    "to": {
      "id": "example",
      "kind": "person"
    },
    "undo": true
  },
  "output": {
    "previousOwnerId": "usr_a1b2c3",
    "routine": {
      "agentId": "agt_a1b2c3",
      "channelId": "chn_a1b2c3",
      "cron": "0 9 * * 1-5",
      "enabled": true,
      "lastRunAt": 1760000000000,
      "nextRunAt": 1760000000000,
      "ownerId": "usr_a1b2c3",
      "prompt": "example",
      "routineId": "rtn_a1b2c3",
      "title": "example"
    }
  }
}
```
