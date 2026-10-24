# views.list

List saved views of a record type that the caller may see

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
| HTTP | POST /v1/views/list |
| MCP tool | views_list (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
  kind?: string;
};
```

## Output

```ts
type Out = {
  views: Array<{
      viewId: string;
      type: string;
      kind: string;
      title: string;
      shared: boolean;
      ownerId: string;
      filter?: unknown;
      sort?: unknown;
      group?: string;
      hidden?: Array<string>;
      colorRules?: unknown;
      config?: Record<string, unknown>;
      updatedAt: number;
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
    "kind": "example",
    "type": "contact"
  },
  "output": {
    "views": [
      {
        "colorRules": {},
        "config": {},
        "filter": {},
        "group": "example",
        "hidden": [
          "example"
        ],
        "kind": "table",
        "ownerId": "example",
        "shared": true,
        "sort": {},
        "title": "example",
        "type": "contact",
        "updatedAt": 1760000000000,
        "viewId": "viw_a1b2c3"
      }
    ]
  }
}
```
