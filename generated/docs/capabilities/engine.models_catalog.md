# engine.models_catalog

Every AI account the asker can use with its models, what each can do (tools, images, context), a cost tier (cheap, standard or strong) and whether the probe found it available; for helpers that pick a model across accounts. Reads saved lists and the probe's marks only

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
| HTTP | POST /v1/engine/models_catalog |
| MCP tool | models_catalog (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  accountRef?: string;
};
```

## Output

```ts
type Out = {
  accounts: Array<{
      ref: string;
      label: string;
      provider: string;
      kind: "api_key" | "subscription" | "local";
      usable: boolean;
      why?: string;
      models: Array<{
          id: string;
          title: string;
          tools: boolean;
          vision: boolean;
          context: number;
          tier: "cheap" | "standard" | "strong";
          allowed: boolean;
          available: "ok" | "checking" | "unavailable" | "unverified";
        }>;
    }>;
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
    "accountRef": "#Team_Anthropic_Key"
  },
  "output": {
    "accounts": [
      {
        "kind": "api_key",
        "label": "example",
        "models": [
          {
            "allowed": true,
            "available": "ok",
            "context": 1,
            "id": "example",
            "tier": "cheap",
            "title": "example",
            "tools": true,
            "vision": true
          }
        ],
        "provider": "example",
        "ref": "#Team_Anthropic_Key",
        "usable": true,
        "why": "example"
      }
    ]
  }
}
```
