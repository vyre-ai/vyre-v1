# schema.layout.get

Admin layout of the record page of a type: ordered sections with their fields and which start folded

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
| HTTP | POST /v1/schema/layout/get |
| MCP tool | schema_layout_get (records) |
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
