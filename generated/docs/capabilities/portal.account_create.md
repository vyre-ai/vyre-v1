# portal.account_create

Create an outside account for a site (magic link or password, per site)

| | |
|---|---|
| Module | portal |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | sites.deploy |
| Grant level | edit |
| Risk | medium |
| Resource | site (create under /siteId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/portal/account_create |
| MCP tool | portal_account_create (sites) |
| CLI | none |
| Emits | portal.account_created |

## Input

```ts
type In = {
  siteId: string;
  email: string;
  method: "magic_link" | "password";
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  account: {
    accountId: string;
    siteId: string;
    email: string;
    state: "invited" | "active" | "disabled";
    recordId?: string;
  };
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
    "email": "example",
    "idempotencyKey": "idem_1",
    "method": "magic_link",
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "account": {
      "accountId": "pac_a1b2c3",
      "email": "example",
      "recordId": "rec_a1b2c3",
      "siteId": "sit_a1b2c3",
      "state": "invited"
    }
  }
}
```
