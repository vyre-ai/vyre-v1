# agents.restore_version

Restore AGENT.md or agent.toml to an earlier version

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | agent (/agentId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/agents/restore_version |
| MCP tool | agents_restore_version (agents) |
| CLI | none |
| Emits | agent.config_changed |

## Input

```ts
type In = {
  agentId: string;
  versionId: string;
  file?: "AGENT.md" | "agent.toml";
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
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "file": "AGENT.md",
    "versionId": "ver_a1b2c3"
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
