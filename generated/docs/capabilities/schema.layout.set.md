# schema.layout.set

Set the record page layout of a type (sections, order, default folds); people fold and keep fields visible on top of it for themselves

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
| HTTP | POST /v1/schema/layout/set |
| MCP tool | schema_layout_set (engineer) |
| CLI | none |
| Emits | schema.changed |

## Input

```ts
type In = {
  type: string;
  sections: Array<{
      key: string;
      title: string;
      fields: Array<string>;
      folded?: boolean;
    }>;
};
```

## Output

```ts
type Out = {
  sections: Array<{
      key: string;
      title: string;
      fields: Array<string>;
      folded?: boolean;
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
    "sections": [
      {
        "fields": [
          "phone"
        ],
        "folded": true,
        "key": "contact_details",
        "title": "example"
      }
    ],
    "type": "contact"
  },
  "output": {
    "sections": [
      {
        "fields": [
          "phone"
        ],
        "folded": true,
        "key": "contact_details",
        "title": "example"
      }
    ]
  }
}
```
