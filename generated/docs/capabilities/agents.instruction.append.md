# agents.instruction.append

Make a lesson an instruction: one line added to the agent's AGENT.md under Lessons from corrections, as a new version with an inline Undo; needs Edit on the agent

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
| HTTP | POST /v1/agents/instruction/append |
| MCP tool | agents_instruction_append (agents) |
| CLI | none |
| Emits | agent.config_changed |

## Input

```ts
type In = {
  agentId: string;
  line: string;
};
```

## Output

```ts
type Out = {
  agent: {
    agentId: string;
    name: string;
    kind?: "assistant" | "teammate" | "agent";
    runtime?: "vyre" | "outside";
    face: string;
    role?: string;
    status: "awake" | "working" | "asleep" | "paused";
    pausedReason?: string;
    pausedBy?: string;
    ownerId: string;
    folderId: string;
    model?: string;
    fallbackModel?: string;
    helperModels?: "same_provider" | "any" | "ask";
    accountPolicy: "asker" | "key";
    accountKey?: string;
    accountFallback: Array<string>;
    memoryKey?: string;
    workKey?: string;
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
    chatOf?: string;
  };
  added: boolean;
  versionId?: string;
  undoVersionId?: string;
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
    "line": "example"
  },
  "output": {
    "added": true,
    "agent": {
      "accountFallback": [
        "example"
      ],
      "accountKey": "#Team_Anthropic_Key",
      "accountPolicy": "asker",
      "agentId": "agt_a1b2c3",
      "captureMode": "auto",
      "chatOf": "thr_a1b2c3",
      "createdAt": 1760000000000,
      "face": "intake",
      "fallbackModel": "example",
      "folderId": "fld_a1b2c3",
      "hasComputer": true,
      "helperModels": "same_provider",
      "kind": "assistant",
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
      "runtime": "vyre",
      "status": "awake",
      "switchOnLimit": true,
      "teammateOf": "example",
      "templateVersion": 1,
      "toolsAllowed": [
        "example"
      ],
      "toolsDenied": [
        "example"
      ],
      "vaultKeys": [
        "example"
      ],
      "workKey": "#Team_Anthropic_Key"
    },
    "undoVersionId": "ver_a1b2c3",
    "versionId": "ver_a1b2c3"
  }
}
```
