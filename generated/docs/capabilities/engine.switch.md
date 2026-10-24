# engine.switch

Switch engine mid-chat: the new engine starts from the rolling summary, the last turns and a pointer to the transcript

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/switch |
| MCP tool | switch_model (meta) |
| CLI | none |
| Emits | turn.engine_switched, agent.model_changed |

## Input

```ts
type In = {
  threadId: string;
  agentId?: string;
  driver: "anthropic" | "openai" | "openrouter" | "google" | "xai" | "opencode_go" | "local" | "claude_code" | "codex" | "grok";
  model: string;
  provider?: string;
  effort?: "low" | "medium" | "high" | "max";
  accountRef?: string;
};
```

## Output

```ts
type Out = {
  engine: string;
  model: string;
  quietLine: string;
  handoffTurns: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.limit
- permission.no_grant
- permission.provider_label
- provider.auth_failed
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "accountRef": "#Team_Anthropic_Key",
    "agentId": "agt_a1b2c3",
    "driver": "anthropic",
    "effort": "low",
    "model": "example",
    "provider": "example",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "engine": "example",
    "handoffTurns": 1,
    "model": "example",
    "quietLine": "Switched to Codex, picked up from the summary and the last 20 turns"
  }
}
```
