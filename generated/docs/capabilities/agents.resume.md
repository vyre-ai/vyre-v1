# agents.resume

Resume a paused agent

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | medium |
| Resource | agent (/agentId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/agents/resume |
| MCP tool | agents_resume (agents) |
| CLI | none |
| Emits | agent.resumed |

## Input

```ts
type In = {
  agentId: string;
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
    accountFallback: Array<string>;
    memoryKey?: string;
    switchOnLimit?: boolean;
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
    captureMode: "auto" | "propose" | "auto_low_risk" | "off";
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
    "agentId": "agt_a1b2c3"
  },
  "output": {
    "agent": {
      "accountFallback": [
        "example"
      ],
      "accountKey": "#Team_Anthropic_Key",
      "accountPolicy": "asker",
      "agentId": "agt_a1b2c3",
      "captureMode": "auto",
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
      "memoryKey": "#Team_Anthropic_Key",
      "model": "example",
      "name": "example",
      "ownerId": "usr_a1b2c3",
      "pausedBy": "example",
      "pausedReason": "example",
      "role": "example",
      "status": "awake",
      "switchOnLimit": true,
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
