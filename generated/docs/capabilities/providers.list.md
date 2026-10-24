# providers.list

My connected AI providers: logo, how connected, Mine or Shared, agents using it, this month's usage

| | |
|---|---|
| Module | vault |
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
| HTTP | POST /v1/providers/list |
| MCP tool | providers_list (vault) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  providers: Array<{
      id: string;
      providerKey: string;
      name: string;
      logo?: string;
      connection: "subscription" | "api_key" | "local_model";
      via: string;
      scope: "mine" | "shared";
      itemId: string;
      handle?: string;
      agentsUsing: Array<string>;
      usage: {
        tokens: number;
        costCents: number;
        periodStart: number;
      };
      engine: string;
      spaceMayUse: boolean;
      state: "ok" | "needs_sign_in" | "failing";
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
  "input": {},
  "output": {
    "providers": [
      {
        "agentsUsing": [
          "agt_a1b2c3"
        ],
        "connection": "subscription",
        "engine": "claude-code",
        "handle": "#Dana_Lawmatics",
        "id": "prv_a1b2c3",
        "itemId": "vit_a1b2c3",
        "logo": "example",
        "name": "example",
        "providerKey": "anthropic",
        "scope": "mine",
        "spaceMayUse": true,
        "state": "ok",
        "usage": {
          "costCents": 1,
          "periodStart": 1760000000000,
          "tokens": 1
        },
        "via": "Subscription, yours"
      }
    ]
  }
}
```
