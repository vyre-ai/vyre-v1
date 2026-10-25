# agents.routines.list

Routines of an agent (schedules set by the owner)

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | agent (/agentId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/agents/routines/list |
| MCP tool | agents_routines_list (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId: string;
};
```

## Output

```ts
type Out = {
  routines: Array<{
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
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3"
  },
  "output": {
    "routines": [
      {
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
      }
    ]
  }
}
```
