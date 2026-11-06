# providers.custom_add

Register an OpenAI-compatible endpoint (a gateway, vLLM, LiteLLM, a hosted model) by base address and connect it with my key, held in the Vault by handle

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
| HTTP | POST /v1/providers/custom_add |
| MCP tool | providers_custom_add (vault) |
| CLI | none |
| Emits | provider.added, vault.item_created, vault.folder_created |

## Input

```ts
type In = {
  name: string;
  baseUrl: string;
  apiKey?: string;
  models?: Array<string>;
  scope: "mine" | "shared";
  folderId?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  endpoint: {
    key: string;
    name: string;
    base: string;
    keyless: boolean;
    models: Array<string>;
    connected: number;
  };
  provider: {
    id: string;
    providerKey: string;
    name: string;
    logo?: string;
    connection: "subscription" | "api_key" | "local_model";
    via: string;
    scope: "mine" | "shared";
    itemId: string;
    itemName?: string;
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
    keepsNothing?: boolean;
    address?: string;
    keyless?: boolean;
    spaceKey?: boolean;
    unopenable?: boolean;
    identity?: string;
    displayName?: string;
    aliases?: Array<string>;
    olderOf?: string;
    uses?: {
      teamChats?: {
        who: "everyone" | Array<string>;
      };
      automations?: true;
      goals?: true;
      agentWork?: {
        which: "all" | Array<string>;
      };
    };
    usesSet?: boolean;
    capCents?: number;
    capped?: boolean;
    teamChatsForMe?: boolean;
    models?: Array<string>;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.duplicate

## Example

```json
{
  "name": "example",
  "input": {
    "apiKey": "example",
    "baseUrl": "https://llm.acme.test/v1",
    "folderId": "vfd_a1b2c3",
    "idempotencyKey": "idem_1",
    "models": [
      "example"
    ],
    "name": "Acme gateway",
    "scope": "mine"
  },
  "output": {
    "endpoint": {
      "base": "example",
      "connected": 1,
      "key": "custom-acme-gateway",
      "keyless": true,
      "models": [
        "example"
      ],
      "name": "example"
    },
    "provider": {
      "address": "example",
      "agentsUsing": [
        "agt_a1b2c3"
      ],
      "aliases": [
        "#Dana_Lawmatics"
      ],
      "capCents": 1,
      "capped": true,
      "connection": "subscription",
      "displayName": "Claude Code, dana@example.com",
      "engine": "claude-code",
      "handle": "#Dana_Lawmatics",
      "id": "prv_a1b2c3",
      "identity": "dana@example.com",
      "itemId": "vit_a1b2c3",
      "itemName": "Dana Claude Max",
      "keepsNothing": true,
      "keyless": true,
      "logo": "example",
      "models": [
        "example"
      ],
      "name": "example",
      "olderOf": "prv_a1b2c3",
      "providerKey": "anthropic",
      "scope": "mine",
      "spaceKey": true,
      "spaceMayUse": true,
      "state": "ok",
      "teamChatsForMe": true,
      "unopenable": true,
      "usage": {
        "costCents": 1,
        "periodStart": 1760000000000,
        "tokens": 1
      },
      "uses": {
        "agentWork": {
          "which": "all"
        },
        "automations": true,
        "goals": true,
        "teamChats": {
          "who": "everyone"
        }
      },
      "usesSet": true,
      "via": "Subscription, yours"
    }
  }
}
```
