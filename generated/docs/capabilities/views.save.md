# views.save

Create or change a saved view (personal until published)

| | |
|---|---|
| Module | schema |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | record_type (/type) |
| Gate | none |
| Idempotency | key |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/views/save |
| MCP tool | views_save (records) |
| CLI | none |
| Emits | view.saved |

## Input

```ts
type In = {
  type: string;
  viewId?: string;
  kind: string;
  title: string;
  filter?: unknown;
  sort?: unknown;
  group?: string;
  hidden?: Array<string>;
  colorRules?: unknown;
  config?: Record<string, unknown>;
  idempotencyKey: string;
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
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "colorRules": {},
    "config": {},
    "filter": {},
    "group": "example",
    "hidden": [
      "example"
    ],
    "idempotencyKey": "idem_1",
    "kind": "table",
    "sort": {},
    "title": "example",
    "type": "contact",
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
