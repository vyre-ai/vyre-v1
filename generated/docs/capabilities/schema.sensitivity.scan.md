# schema.sensitivity.scan

Detect sensitive data in the fields of a type (ID numbers, card and bank numbers, health terms) and suggest which fields to seal; changes nothing and returns no values

| | |
|---|---|
| Module | schema |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | schema.manage |
| Grant level | view |
| Risk | low |
| Resource | record_type (/type) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/schema/sensitivity/scan |
| MCP tool | schema_sensitivity_scan (engineer) |
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
  suggestions: Array<{
      field: string;
      kind: "id_number" | "card" | "bank" | "health" | "other";
      matches: number;
      suggestedLabel: "public" | "internal" | "confidential" | "restricted";
      seal: boolean;
    }>;
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
    "type": "contact"
  },
  "output": {
    "suggestions": [
      {
        "field": "phone",
        "kind": "id_number",
        "matches": 1,
        "seal": true,
        "suggestedLabel": "public"
      }
    ]
  }
}
```
