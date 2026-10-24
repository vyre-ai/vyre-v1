# import.suggest_mapping

Suggest which column feeds which field of a record type, with a confidence for each

| | |
|---|---|
| Module | import |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | records.create |
| Grant level | view |
| Risk | low |
| Resource | record_type (/type) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/import/suggest_mapping |
| MCP tool | import_suggest_mapping (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  importId: string;
  table?: string;
  type: string;
};
```

## Output

```ts
type Out = {
  mapping: Array<{
      column: string;
      field?: string;
      confidence: number;
    }>;
  unmapped: Array<string>;
  newFields: Array<{
      column: string;
      key: string;
      type: string;
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
    "importId": "imp_a1b2c3",
    "table": "example",
    "type": "contact"
  },
  "output": {
    "mapping": [
      {
        "column": "example",
        "confidence": 1,
        "field": "email"
      }
    ],
    "newFields": [
      {
        "column": "example",
        "key": "email",
        "type": "example"
      }
    ],
    "unmapped": [
      "example"
    ]
  }
}
```
