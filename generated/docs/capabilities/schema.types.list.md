# schema.types.list

List record types in Personal, Shared with me or Space sections with folders and counts

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
| HTTP | POST /v1/schema/types/list |
| MCP tool | schema_types_list (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  section?: "personal" | "shared" | "space";
  folder?: string;
  group?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  types: Array<{
      key: string;
      title: string;
      plural: string;
      icon: string;
      group?: string;
      label: "public" | "internal" | "confidential" | "restricted";
      system: boolean;
      syncedFrom?: string;
      scope?: string;
      rowCount: number;
      fieldCount: number;
    }>;
  next?: string;
  total?: number;
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
  "input": {
    "cursor": "example",
    "folder": "fld_a1b2c3",
    "group": "example",
    "limit": 1,
    "section": "personal"
  },
  "output": {
    "next": "example",
    "total": 1,
    "types": [
      {
        "fieldCount": 1,
        "group": "example",
        "icon": "example",
        "key": "contact",
        "label": "public",
        "plural": "example",
        "rowCount": 1,
        "scope": "example",
        "syncedFrom": "example",
        "system": true,
        "title": "example"
      }
    ]
  }
}
```
