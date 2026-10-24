# views.publish

Share a saved view with everyone who can read the type, or make it personal again

| | |
|---|---|
| Module | schema |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | schema.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/views/publish |
| MCP tool | views_publish (records) |
| CLI | none |
| Emits | view.published |

## Input

```ts
type In = {
  viewId: string;
  shared: boolean;
};
```

## Output

```ts
type Out = {
  view: {
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
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "shared": true,
    "viewId": "viw_a1b2c3"
  },
  "output": {
    "view": {
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
  }
}
```
