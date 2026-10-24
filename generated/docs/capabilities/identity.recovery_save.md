# identity.recovery_save

Save a recovery code so a reset keeps Mine vault items, private chats and personal memory

| | |
|---|---|
| Module | identity |
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
| HTTP | POST /v1/identity/recovery_save |
| MCP tool | none |
| CLI | none |
| Emits | recovery.saved, keys.stored |

## Input

```ts
type In = {
  personKeyByRecovery: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "personKeyByRecovery": "d3JhcHBlZA=="
  },
  "output": {
    "ok": true
  }
}
```
