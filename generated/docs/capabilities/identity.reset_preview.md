# identity.reset_preview

Admin: what a password reset would lose for this person (Mine items, private chats, personal memory) and whether a recovery code exists

| | |
|---|---|
| Module | identity |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | access.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/identity/reset_preview |
| MCP tool | identity_reset_preview (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  personId: string;
};
```

## Output

```ts
type Out = {
  hasRecoveryCode: boolean;
  losses: Array<{
      kind: "vault_mine" | "private_chats" | "personal_memory";
      count: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "personId": "usr_a1b2c3"
  },
  "output": {
    "hasRecoveryCode": true,
    "losses": [
      {
        "count": 1,
        "kind": "vault_mine"
      }
    ]
  }
}
```
