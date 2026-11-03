# engine.account.resolve

Resolve the account that pays for a turn: a pin (the chat's account, the agent's key, the step's key), the person's own, the Space AI accounts whose uses cover the turn (cheapest that fits, not capped), the backups, else an Unblock

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/account/resolve |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  agentId: string;
  askerId?: string;
  stepKey?: string;
  unavailable?: Array<string>;
  dry?: boolean;
  kind?: "chat" | "wake" | "automation" | "goal" | "agent_work";
};
```

## Output

```ts
type Out = {
  accountRef: string | null;
  payer: string | null;
  reason: "starter" | "steerer" | "step_key" | "backup_key" | "none";
  allowed: boolean;
  itemId?: string;
  fellBack?: boolean;
  pin?: {
    ref: string;
    used: boolean;
    why?: "unknown" | "expired" | "failed" | "policy_company" | "not_yours" | "space_may_not_use" | "failed_this_turn" | "capped" | "no_model" | "not_used_for";
  };
  cappedFrom?: string;
  via?: "thread" | "chat_key" | "work" | "step" | "space" | "backup";
  why?: "no_account" | "expired" | "failed" | "policy" | "no_model";
  model?: string;
  servedModels?: Array<string>;
  modelFallback?: {
    from: string;
    to?: string;
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
    "askerId": "usr_a1b2c3",
    "dry": true,
    "kind": "chat",
    "stepKey": "example",
    "threadId": "thr_a1b2c3",
    "unavailable": [
      "example"
    ]
  },
  "output": {
    "accountRef": "#Team_Anthropic_Key",
    "allowed": true,
    "cappedFrom": "#Team_Anthropic_Key",
    "fellBack": true,
    "itemId": "vit_a1b2c3",
    "model": "example",
    "modelFallback": {
      "from": "example",
      "to": "example"
    },
    "payer": "usr_a1b2c3",
    "pin": {
      "ref": "#Team_Anthropic_Key",
      "used": true,
      "why": "unknown"
    },
    "reason": "starter",
    "servedModels": [
      "example"
    ],
    "via": "thread",
    "why": "no_account"
  }
}
```
