# vault.site_rules.set

Set or clear the never-fill and never-save rule for one site; personal, follows the extension in this Space

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
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/vault/site_rules/set |
| MCP tool | vault_site_rules_set (vault) |
| CLI | none |
| Emits | vault.site_rule_changed |

## Input

```ts
type In = {
  host: string;
  neverFill: boolean;
  neverSave: boolean;
};
```

## Output

```ts
type Out = {
  host: string;
  neverFill: boolean;
  neverSave: boolean;
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
    "host": "bank.example.com",
    "neverFill": true,
    "neverSave": true
  },
  "output": {
    "host": "example",
    "neverFill": true,
    "neverSave": true
  }
}
```
