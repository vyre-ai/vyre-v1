# schema.view_kinds

Catalogue of view kinds and which field types each needs

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
| HTTP | POST /v1/schema/view_kinds |
| MCP tool | schema_view_kinds (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  viewKinds: Array<{
      key: string;
      title: string;
      needs: Array<{
          fieldType: string;
          as: string;
        }>;
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
    "viewKinds": [
      {
        "key": "example",
        "needs": [
          {
            "as": "example",
            "fieldType": "example"
          }
        ],
        "title": "example"
      }
    ]
  }
}
```
