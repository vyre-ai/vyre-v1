# vault.assistant_grant.give

Let the Assistant use one Vault item inside one Automation (its runs and its build thread), for you only. Needs Use on the item; a company key is never given

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | vault_item (/itemId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/vault/assistant_grant/give |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  itemId: string;
  automationId: string;
  automationName?: string;
  agentId: string;
  threadId?: string;
};
```

## Output

```ts
type Out = {
  grant?: {
    id: string;
    itemId: string;
    automationId: string;
    automationName?: string;
    agentId: string;
    giver: string;
    threadId?: string;
    createdAt: number;
  };
  already?: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "automationId": "aut_a1b2c3",
    "automationName": "example",
    "itemId": "vit_a1b2c3",
    "threadId": "example"
  },
  "output": {
    "already": true,
    "grant": {
      "agentId": "example",
      "automationId": "example",
      "automationName": "example",
      "createdAt": 1,
      "giver": "example",
      "id": "example",
      "itemId": "example",
      "threadId": "example"
    }
  }
}
```
