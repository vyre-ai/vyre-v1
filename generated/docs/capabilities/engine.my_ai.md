# engine.my_ai

What AI this chat runs on and what else the person may use now: model, account and who paid, each usable account with models and limits (or not readable), and use today and this month. Ask it for what model, what else, what is left, /usage

| | |
|---|---|
| Module | engine |
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
| HTTP | POST /v1/engine/my_ai |
| MCP tool | my_ai (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId?: string;
  agentId?: string;
};
```

## Output

```ts
type Out = {
  running?: Record<string, unknown>;
  accounts: Array<{
      ref: string;
      name: string;
      provider: string;
      kind: "api_key" | "subscription";
      usable: boolean;
      why?: string;
      models: Array<string>;
      limits: {
        state: "read" | "not_readable";
        session?: {
          pct: number;
          resetsAt?: number;
        };
        week?: {
          pct: number;
          resetsAt?: number;
        };
        note?: string;
      };
    }>;
  use: {
    today: {
      turns: number;
      input: number;
      cachedInput: number;
      output: number;
      costMicros: number;
    };
    month: {
      turns: number;
      input: number;
      cachedInput: number;
      output: number;
      costMicros: number;
    };
  };
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
    "agentId": "agt_a1b2c3",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "accounts": [
      {
        "kind": "api_key",
        "limits": {
          "note": "example",
          "session": {
            "pct": 1,
            "resetsAt": 1760000000000
          },
          "state": "read",
          "week": {
            "pct": 1,
            "resetsAt": 1760000000000
          }
        },
        "models": [
          "example"
        ],
        "name": "example",
        "provider": "example",
        "ref": "#Team_Anthropic_Key",
        "usable": true,
        "why": "example"
      }
    ],
    "running": {},
    "use": {
      "month": {
        "cachedInput": 1,
        "costMicros": 1,
        "input": 1,
        "output": 1,
        "turns": 1
      },
      "today": {
        "cachedInput": 1,
        "costMicros": 1,
        "input": 1,
        "output": 1,
        "turns": 1
      }
    }
  }
}
```
