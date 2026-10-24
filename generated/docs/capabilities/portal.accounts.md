# portal.accounts

List outside accounts of a site

| | |
|---|---|
| Module | portal |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | site (/siteId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/portal/accounts |
| MCP tool | portal_accounts (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  accounts: Array<{
      accountId: string;
      siteId: string;
      email: string;
      state: "invited" | "active" | "disabled";
      recordId?: string;
    }>;
  next?: string;
  total?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "limit": 1,
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "accounts": [
      {
        "accountId": "pac_a1b2c3",
        "email": "example",
        "recordId": "rec_a1b2c3",
        "siteId": "sit_a1b2c3",
        "state": "invited"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
