# schema.gap_rules.set

Create or replace a gap-check rule: a missing or stale field goes to an AI field, an agent lookup, a teammate task or a collection form

| | |
|---|---|
| Module | schema |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | schema.manage |
| Grant level | edit |
| Risk | medium |
| Resource | record_type (/type) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/schema/gap_rules/set |
| MCP tool | schema_gap_rules_set (engineer) |
| CLI | none |
| Emits | schema.changed |

## Input

```ts
type In = {
  type: string;
  rule: {
    ruleId: string;
    field: string;
    when: "missing" | "stale";
    staleAfterDays?: number;
    route: "ai_field" | "agent_lookup" | "task" | "form";
    agentId?: string;
    enabled: boolean;
  };
};
```

## Output

```ts
type Out = {
  rule: {
    ruleId: string;
    field: string;
    when: "missing" | "stale";
    staleAfterDays?: number;
    route: "ai_field" | "agent_lookup" | "task" | "form";
    agentId?: string;
    enabled: boolean;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "rule": {
      "agentId": "agt_a1b2c3",
      "enabled": true,
      "field": "phone",
      "route": "ai_field",
      "ruleId": "gap_missing_email",
      "staleAfterDays": 1,
      "when": "missing"
    },
    "type": "contact"
  },
  "output": {
    "rule": {
      "agentId": "agt_a1b2c3",
      "enabled": true,
      "field": "phone",
      "route": "ai_field",
      "ruleId": "gap_missing_email",
      "staleAfterDays": 1,
      "when": "missing"
    }
  }
}
```
