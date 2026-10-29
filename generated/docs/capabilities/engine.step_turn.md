# engine.step_turn

Run one AI turn for an automation step: on the owner's own account (Personal) or a Space-shared key (Space), optionally as an agent, with no tools. A repeat of the same key returns the first answer.

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/engine/step_turn |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  prompt: string;
  agentId?: string;
  keyId?: string;
  backupKeyId?: string;
  timeoutMinutes?: number;
  recordLabel?: number;
  runId: string;
  stepId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  text: string;
  keyUsed: string;
  modelUsed: string;
  tokensIn: number;
  tokensOut: number;
  agentName?: string;
};
```

## Errors

- internal.unavailable
- internal.unexpected
- permission.above_clearance
- permission.limit
- permission.no_grant
- permission.provider_label
- provider.auth_failed
- provider.overloaded
- provider.rate_limited
- provider.unavailable
- timeout.deadline
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "backupKeyId": "#Team_Anthropic_Key",
    "idempotencyKey": "idem_1",
    "keyId": "#Team_Anthropic_Key",
    "prompt": "example",
    "recordLabel": 1,
    "runId": "run_a1b2c3",
    "stepId": "example",
    "timeoutMinutes": 1
  },
  "output": {
    "agentName": "example",
    "keyUsed": "#Team_Anthropic_Key",
    "modelUsed": "example",
    "text": "example",
    "tokensIn": 1,
    "tokensOut": 1
  }
}
```
