# vault.login.check

Is a submitted login already saved? Compared inside the Vault: known, changed or new

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
| Team Space only | no |
| HTTP | POST /v1/vault/login/check |
| MCP tool | vault_login_check (vault) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  url: string;
  username?: string;
  password: string;
};
```

## Output

```ts
type Out = {
  state: "known" | "changed" | "new";
  itemId?: string;
  name?: string;
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
    "password": "example",
    "url": "https://example.com",
    "username": "example"
  },
  "output": {
    "itemId": "vit_a1b2c3",
    "name": "example",
    "state": "known"
  }
}
```
