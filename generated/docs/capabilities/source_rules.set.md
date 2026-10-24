# source_rules.set

Replace the Source rules

| | |
|---|---|
| Module | forms |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | forms.publish |
| Grant level | manage |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/source_rules/set |
| MCP tool | source_rules_set (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  rules: Array<{
      match: unknown;
      channel: string;
    }>;
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
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "rules": [
      {
        "channel": "example",
        "match": {}
      }
    ]
  },
  "output": {
    "ok": true
  }
}
```
