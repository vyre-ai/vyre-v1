# schema.gap_rules.list

Gap-check rules of a type: which fields count as missing or stale and how each gap is routed

| | |
|---|---|
| Module | schema |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | record_type (/type) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/schema/gap_rules/list |
| MCP tool | schema_gap_rules_list (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
};
```

## Output

```ts
type Out = {
  rules: Array<{
      ruleId: string;
      field: string;
      when: "missing" | "stale";
      staleAfterDays?: number;
      route: "ai_field" | "agent_lookup" | "task" | "form";
      agentId?: string;
      enabled: boolean;
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
    "type": "contact"
  },
  "output": {
    "rules": [
      {
        "agentId": "agt_a1b2c3",
        "enabled": true,
        "field": "phone",
        "route": "ai_field",
        "ruleId": "gap_missing_email",
        "staleAfterDays": 1,
        "when": "missing"
      }
    ]
  }
}
```
