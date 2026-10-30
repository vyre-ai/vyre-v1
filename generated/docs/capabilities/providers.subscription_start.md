# providers.subscription_start

Start a subscription sign-in (Claude, ChatGPT through Codex, Grok): the server starts the provider's own sign-in and answers its link, and the code to type where the provider shows one. A person does this, never an agent.

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
| HTTP | POST /v1/providers/subscription_start |
| MCP tool | providers_subscription_start (vault) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  providerKey: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  flowId: string;
  instruction: string;
  url?: string;
  userCode?: string;
  needsCode?: boolean;
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
    "idempotencyKey": "idem_1",
    "providerKey": "claude-code"
  },
  "output": {
    "flowId": "sub_a1b2c3",
    "instruction": "example",
    "needsCode": true,
    "url": "https://example.com",
    "userCode": "example"
  }
}
```
