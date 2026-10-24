# vault.site_rules.list

Sites where I never fill and never get offered to save a login in this Space (Never Fill on This Site)

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
| HTTP | POST /v1/vault/site_rules/list |
| MCP tool | vault_site_rules_list (vault) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  sites: Array<{
      host: string;
      neverFill: boolean;
      neverSave: boolean;
      at: number;
    }>;
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
  "input": {},
  "output": {
    "sites": [
      {
        "at": 1760000000000,
        "host": "bank.example.com",
        "neverFill": true,
        "neverSave": true
      }
    ]
  }
}
```
