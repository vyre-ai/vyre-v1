# agents.set_owner

Hand an agent to another active person: its home folder and the agent change owner with it and the previous owner keeps nothing on them

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | medium |
| Resource | agent (/agentId) |
| Gate | transfer when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/agents/set_owner |
| MCP tool | agents_set_owner (agents) |
| CLI | none |
| Emits | agent.owner_changed |

## Input

```ts
type In = {
  agentId: string;
  ownerId: string;
};
```

## Output

```ts
type Out = {
  agent: {
    agentId: string;
    name: string;
    face: string;
    role?: string;
    status: "awake" | "working" | "asleep" | "paused";
    pausedReason?: string;
    pausedBy?: string;
    ownerId: string;
    folderId: string;
    model?: string;
    fallbackModel?: string;
    accountPolicy: "asker" | "key";
    accountKey?: string;
    toolsAllowed: Array<string>;
    toolsDenied: Array<string>;
    vaultKeys: Array<string>;
    limits: {
      runCostMicros?: number;
      dayCostMicros?: number;
      monthCostMicros?: number;
      turnsPerDay?: number;
      minutesPerRun?: number;
      tokensPerDay?: number;
    };
    captureMode: "propose" | "auto_low_risk" | "off";
    hasComputer: boolean;
    templateVersion: number;
    createdAt: number;
    lastActiveAt?: number;
    teammateOf?: string;
  };
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
    "agentId": "agt_a1b2c3",
    "ownerId": "usr_a1b2c3"
  },
  "output": {
    "agent": {
      "accountKey": "#Team_Anthropic_Key",
      "accountPolicy": "asker",
      "agentId": "agt_a1b2c3",
      "captureMode": "propose",
      "createdAt": 1760000000000,
      "face": "intake",
      "fallbackModel": "example",
      "folderId": "fld_a1b2c3",
      "hasComputer": true,
      "lastActiveAt": 1760000000000,
      "limits": {
        "dayCostMicros": 1,
        "minutesPerRun": 1,
        "monthCostMicros": 1,
        "runCostMicros": 1,
        "tokensPerDay": 1,
        "turnsPerDay": 1
      },
      "model": "example",
      "name": "example",
      "ownerId": "usr_a1b2c3",
      "pausedBy": "example",
      "pausedReason": "example",
      "role": "example",
      "status": "awake",
      "teammateOf": "prj_a1b2c3",
      "templateVersion": 1,
      "toolsAllowed": [
        "example"
      ],
      "toolsDenied": [
        "example"
      ],
      "vaultKeys": [
        "example"
      ]
    }
  }
}
```
