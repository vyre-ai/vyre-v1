# providers.add

Connect a provider with a pasted API key (stored once, used by handle) or a local model address

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
| Idempotency | key |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/providers/add |
| MCP tool | providers_add (vault) |
| CLI | none |
| Emits | provider.added, vault.item_created |

## Input

```ts
type In = {
  providerKey: string;
  connection: "api_key" | "local_model";
  name?: string;
  apiKey?: string;
  address?: string;
  scope: "mine" | "shared";
  folderId?: string;
  idempotencyKey: string;
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
- validation.bad_input
- validation.duplicate

## Example

```json
{
  "name": "example",
  "input": {
    "address": "https://example.com",
    "apiKey": "example",
    "connection": "api_key",
    "folderId": "vfd_a1b2c3",
    "idempotencyKey": "idem_1",
    "name": "example",
    "providerKey": "anthropic",
    "scope": "mine"
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
