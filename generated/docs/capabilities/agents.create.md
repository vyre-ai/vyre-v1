# agents.create

Create an agent (the create-agent skill ends in one Approve card): record, Agents/<name> folder with the decided file tree, template files

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | agents.create |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/agents/create |
| MCP tool | agents_create (agents) |
| CLI | vyre agents create |
| Emits | agent.created |

## Input

```ts
type In = {
  name: string;
  role?: string;
  face?: string;
  model?: string;
  ownerId?: string;
  computer?: boolean;
  templateKey?: string;
  tools?: {
    allowed: Array<string>;
    denied: Array<string>;
  };
  limits?: {
    runCostMicros?: number;
    dayCostMicros?: number;
    monthCostMicros?: number;
    turnsPerDay?: number;
    minutesPerRun?: number;
    tokensPerDay?: number;
  };
  idempotencyKey: string;
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
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.duplicate

## Example

```json
{
  "name": "example",
  "input": {
    "computer": true,
    "face": "example",
    "idempotencyKey": "idem_1",
    "limits": {
      "dayCostMicros": 1,
      "minutesPerRun": 1,
      "monthCostMicros": 1,
      "runCostMicros": 1,
      "tokensPerDay": 1,
      "turnsPerDay": 1
    },
    "model": "example",
    "name": "Intake",
    "ownerId": "usr_a1b2c3",
    "role": "example",
    "templateKey": "example",
    "tools": {
      "allowed": [
        "example"
      ],
      "denied": [
        "example"
      ]
    }
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
