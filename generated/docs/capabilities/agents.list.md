# agents.list

List agents you are in or that are shared with you (admins may toggle All in the Space)

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/agents/list |
| MCP tool | agents_list (agents) |
| CLI | vyre agents list |
| Emits | none |

## Input

```ts
type In = {
  section?: "personal" | "shared" | "space";
  folderId?: string;
  status?: Array<"awake" | "working" | "asleep" | "paused">;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  agents: Array<{
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
    }>;
  next?: string;
  total?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "folderId": "fld_a1b2c3",
    "limit": 1,
    "section": "personal",
    "status": [
      "awake"
    ]
  },
  "output": {
    "agents": [
      {
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
    ],
    "next": "example",
    "total": 1
  }
}
```
