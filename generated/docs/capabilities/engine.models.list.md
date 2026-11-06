# engine.models.list

Models the account can reach; models that the open labels or policy forbid are listed greyed with the reason

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
| HTTP | POST /v1/engine/models/list |
| MCP tool | engine_models_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  accountRef?: string;
  threadId?: string;
  recordLabel?: "public" | "internal" | "confidential" | "restricted";
  refresh?: boolean;
  wait?: boolean;
  probe?: boolean;
};
```

## Output

```ts
type Out = {
  models: Array<{
      provider: string;
      model: string;
      title: string;
      driver: "anthropic" | "openai" | "openrouter" | "google" | "xai" | "opencode_go" | "local" | "custom" | "claude_code" | "codex" | "grok";
      contextTokens?: number;
      allowed: boolean;
      reason?: "label_provider" | "policy_model" | "not_connected" | "usage_limit" | "checking" | "not_checked";
      resetsAt?: number;
      alias?: string;
      isDefault?: boolean;
      efforts?: Array<string>;
      defaultEffort?: string;
    }>;
  listed?: {
    source: "live" | "saved" | "shipped";
    updatedAt?: number;
    refreshing: boolean;
    failed: boolean;
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
    "accountRef": "#Team_Anthropic_Key",
    "probe": true,
    "recordLabel": "public",
    "refresh": true,
    "threadId": "thr_a1b2c3",
    "wait": true
  },
  "output": {
    "listed": {
      "failed": true,
      "refreshing": true,
      "source": "live",
      "updatedAt": 1760000000000
    },
    "models": [
      {
        "alias": "opus",
        "allowed": true,
        "contextTokens": 1,
        "defaultEffort": "medium",
        "driver": "anthropic",
        "efforts": [
          "high"
        ],
        "isDefault": true,
        "model": "claude-sonnet-5-5",
        "provider": "anthropic",
        "reason": "label_provider",
        "resetsAt": 1760000000000,
        "title": "example"
      }
    ]
  }
}
```
