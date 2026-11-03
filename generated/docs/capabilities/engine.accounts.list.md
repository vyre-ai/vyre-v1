# engine.accounts.list

Accounts the caller can run on: API keys by handle and subscription sign-ins (Mine), with status. With a place (chat, automation, agent, space) each says whether it can run there and why not

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
| HTTP | POST /v1/engine/accounts/list |
| MCP tool | engine_accounts_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  place?: "chat" | "automation" | "agent" | "space";
  model?: string;
  agentId?: string;
  explicit?: boolean;
};
```

## Output

```ts
type Out = {
  accounts: Array<{
      ref: string;
      driver: "anthropic" | "openai" | "openrouter" | "google" | "xai" | "opencode_go" | "local" | "custom" | "claude_code" | "codex" | "grok";
      kind: "api_key" | "subscription";
      title: string;
      name?: string;
      mine: boolean;
      ownerId?: string;
      status: "ok" | "expired" | "failed" | "untested";
      lastProbeAt?: number;
      base?: string;
      keyless?: boolean;
      spaceKey?: boolean;
      aliases?: Array<string>;
      older?: Array<{
          ref: string;
          providerId: string;
          name: string;
        }>;
      providerId?: string;
      models?: Array<string>;
      usable?: boolean;
      why?: string;
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
    "agentId": "agt_a1b2c3",
    "explicit": true,
    "model": "example",
    "place": "chat"
  },
  "output": {
    "accounts": [
      {
        "aliases": [
          "#Team_Anthropic_Key"
        ],
        "base": "example",
        "driver": "anthropic",
        "keyless": true,
        "kind": "api_key",
        "lastProbeAt": 1760000000000,
        "mine": true,
        "models": [
          "example"
        ],
        "name": "Dana Claude Max",
        "older": [
          {
            "name": "example",
            "providerId": "prv_a1b2c3",
            "ref": "#Team_Anthropic_Key"
          }
        ],
        "ownerId": "usr_a1b2c3",
        "providerId": "prv_a1b2c3",
        "ref": "#Team_Anthropic_Key",
        "spaceKey": true,
        "status": "ok",
        "title": "example",
        "usable": true,
        "why": "example"
      }
    ]
  }
}
```
