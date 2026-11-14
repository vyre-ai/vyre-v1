# vault.assistant_grant.revoke

Take back what the Assistant was let do with a Vault item: one grant, every grant of an Automation or of an item

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
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/vault/assistant_grant/revoke |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  grantId?: string;
  itemId?: string;
  automationId?: string;
  why?: string;
};
```

## Output

```ts
type Out = {
  revoked: number;
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
    "grantId": "example",
    "itemId": "example",
    "why": "example"
  },
  "output": {
    "revoked": 1
  }
}
```
