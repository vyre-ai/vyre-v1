# providers.subscription_complete

Finish a subscription sign-in. Pass the pasted code where the provider shows one; call again until it answers a provider (waiting means the person has not approved yet). The credential goes straight into a Mine item of kind ai_subscription and is never returned.

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
| Emits | provider.added, provider.updated, provider.removed, vault.item_created, vault.item_updated, vault.item_deleted, vault.folder_created |

## Input

```ts
type In = {
  flowId: string;
  code?: string;
};
```

## Output

```ts
type Out = {
  provider?: {
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
  waiting?: boolean;
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
    "code": "example",
    "flowId": "sub_a1b2c3"
  },
  "output": {
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
    },
    "waiting": true
  }
}
```
