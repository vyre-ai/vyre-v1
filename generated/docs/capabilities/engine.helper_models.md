# engine.helper_models

The catalogue before you start helpers: every AI account the person may use with its provider, label and models (tools, vision, context, a cost tier cheap, standard or strong, whether it is available now), and where a helper goes by default

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
| HTTP | POST /v1/engine/helper_models |
| MCP tool | models_for_helpers (chats) |
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
  accounts: Array<{
      ref: string;
      provider: string;
      label: string;
      mine: boolean;
      shared: boolean;
      spaceKey: boolean;
      models: Array<{
          model: string;
          title?: string;
          tier: "cheap" | "standard" | "strong";
          tools: boolean;
          vision: boolean;
          contextTokens?: number;
          available: boolean;
          why?: string;
        }>;
    }>;
  parent: {
    provider?: string;
    accountRef?: string;
    model?: string;
  };
  policy: "same_provider" | "any" | "ask";
  suggest: {
    read: {
      account: string;
      accountLabel: string;
      model: string;
      why: string;
    } | null;
    think: {
      account: string;
      accountLabel: string;
      model: string;
      why: string;
    } | null;
  };
  rule: string;
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
        "label": "OpenAI · irfad@mylegalacademy.com",
        "mine": true,
        "models": [
          {
            "available": true,
            "contextTokens": 1,
            "model": "example",
            "tier": "cheap",
            "title": "example",
            "tools": true,
            "vision": true,
            "why": "example"
          }
        ],
        "provider": "example",
        "ref": "#Team_Anthropic_Key",
        "shared": true,
        "spaceKey": true
      }
    ],
    "parent": {
      "accountRef": "#Team_Anthropic_Key",
      "model": "example",
      "provider": "example"
    },
    "policy": "same_provider",
    "rule": "example",
    "suggest": {
      "read": {
        "account": "#Team_Anthropic_Key",
        "accountLabel": "example",
        "model": "example",
        "why": "example"
      },
      "think": {
        "account": "#Team_Anthropic_Key",
        "accountLabel": "example",
        "model": "example",
        "why": "example"
      }
    }
  }
}
```
