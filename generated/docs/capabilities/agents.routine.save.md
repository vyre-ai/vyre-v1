# agents.routine.save

Create or change a routine; messages it causes carry "Sent by <agent> on a routine <person> set"

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | agents.schedule |
| Grant level | edit |
| Risk | medium |
| Resource | agent (create under /agentId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/agents/routine/save |
| MCP tool | agents_routine_save (agents) |
| CLI | none |
| Emits | agent.routine_changed |

## Input

```ts
type In = {
  agentId: string;
  routineId?: string;
  title: string;
  cron: string;
  prompt: string;
  channelId?: string;
  enabled?: boolean;
  idempotencyKey: string;
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
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "channelId": "chn_a1b2c3",
    "cron": "0 9 * * 1-5",
    "enabled": true,
    "idempotencyKey": "idem_1",
    "prompt": "example",
    "routineId": "rtn_a1b2c3",
    "title": "example"
  },
  "output": {
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
