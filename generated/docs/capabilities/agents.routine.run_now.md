# agents.routine.run_now

Run a routine now. The run starts as the routine owner, never as the caller, so its reach and its "Sent by <agent> on a routine <person> set" line are the owner's

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
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/agents/routine/run_now |
| MCP tool | agents_routine_run_now (agents) |
| CLI | none |
| Emits | agent.routine_run_started |

## Input

```ts
type In = {
  agentId: string;
  routineId: string;
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
    cron?: string;
    prompt: string;
    channelId?: string;
    enabled: boolean;
    ownerId: string;
    lastRunAt?: number;
    nextRunAt?: number;
    kind?: "schedule" | "watch";
    watch?: {
      on: "message";
      channelId: string;
    };
  };
  runId: string;
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
    "idempotencyKey": "idem_1",
    "routineId": "rtn_a1b2c3"
  },
  "output": {
    "routine": {
      "agentId": "agt_a1b2c3",
      "channelId": "chn_a1b2c3",
      "cron": "0 9 * * 1-5",
      "enabled": true,
      "kind": "schedule",
      "lastRunAt": 1760000000000,
      "nextRunAt": 1760000000000,
      "ownerId": "usr_a1b2c3",
      "prompt": "example",
      "routineId": "rtn_a1b2c3",
      "title": "example",
      "watch": {
        "channelId": "chn_a1b2c3",
        "on": "message"
      }
    },
    "runId": "run_a1b2c3"
  }
}
```
