# source_rules.list

List Source rules that map clicks to channels

| | |
|---|---|
| Module | forms |
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
| HTTP | POST /v1/source_rules/list |
| MCP tool | source_rules_list (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  rules: Array<{
      ruleId: string;
      match: unknown;
      channel: string;
      order: number;
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
    "rules": [
      {
        "channel": "example",
        "match": {},
        "order": 1,
        "ruleId": "srl_a1b2c3"
      }
    ]
  }
}
```
