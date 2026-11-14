# vault.assistant_grant.list

The grants that let the Assistant use an item, or work in an Automation, that you may see

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
| Team Space only | yes |
| HTTP | POST /v1/vault/assistant_grant/list |
| MCP tool | vault_assistant_grant_list (vault) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  itemId?: string;
  automationId?: string;
};
```

## Output

```ts
type Out = {
  grants: Array<{
      id: string;
      itemId: string;
      automationId: string;
      automationName?: string;
      agentId: string;
      giver: string;
      threadId?: string;
      createdAt: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "automationId": "example",
    "itemId": "example"
  },
  "output": {
    "grants": [
      {
        "agentId": "example",
        "automationId": "example",
        "automationName": "example",
        "createdAt": 1,
        "giver": "example",
        "id": "example",
        "itemId": "example",
        "threadId": "example"
      }
    ]
  }
}
```
