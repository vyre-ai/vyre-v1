# providers.subscription_complete

Finish a subscription sign-in: the credential files are captured into a Mine item of kind ai_subscription

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/providers/subscription_complete |
| MCP tool | providers_subscription_complete (vault) |
| CLI | none |
| Emits | provider.added, vault.item_created |

## Input

```ts
type In = {
  flowId: string;
};
```

## Output

```ts
type Out = {
  provider: {
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
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
- timeout.deadline
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "flowId": "sub_a1b2c3"
  },
  "output": {
    "provider": {
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
  }
}
```
