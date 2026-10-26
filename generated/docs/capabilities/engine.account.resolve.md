# engine.account.resolve

Resolve the account that pays for a turn: starter, steerer, step key, backup key, else an Unblock

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
    "stepKey": "example",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "accountRef": "#Team_Anthropic_Key",
    "allowed": true,
    "itemId": "vit_a1b2c3",
    "payer": "usr_a1b2c3",
    "reason": "starter"
  }
}
```
