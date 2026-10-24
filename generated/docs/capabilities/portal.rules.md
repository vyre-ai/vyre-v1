# portal.rules

Row rules and grants of the site service identity

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
| HTTP | POST /v1/portal/rules |
| MCP tool | portal_rules (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
};
```

## Output

```ts
type Out = {
  rules: Array<{
      accountId: string;
      recordType: string;
      rule: unknown;
    }>;
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
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "rules": [
      {
        "accountId": "pac_a1b2c3",
        "recordType": "contact",
        "rule": {}
      }
    ]
  }
}
```
