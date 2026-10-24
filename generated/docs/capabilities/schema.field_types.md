# schema.field_types

Catalogue of field types with their filter operators and options

| | |
|---|---|
| Module | schema |
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
| HTTP | POST /v1/schema/field_types |
| MCP tool | schema_field_types (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  fieldTypes: Array<{
      key: string;
      title: string;
      filterOps: Array<string>;
      sortable: boolean;
      groupable: boolean;
      sealed: boolean;
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
    "fieldTypes": [
      {
        "filterOps": [
          "example"
        ],
        "groupable": true,
        "key": "example",
        "sealed": true,
        "sortable": true,
        "title": "example"
      }
    ]
  }
}
```
