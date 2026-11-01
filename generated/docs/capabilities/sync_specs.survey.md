# sync_specs.survey

Read up to 12 paths of an app at once, read-only, and say for each what lists it holds, how many items, a total if given. Use it to see which objects an app has

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | connectors.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sync_specs/survey |
| MCP tool | sync_specs_survey (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  auth: {
    vaultHandle: string;
    style: "bearer" | "header" | "basic";
    header?: string;
    prefix?: string;
    headers?: Record<string, string>;
  };
  domain: string;
  paths: Array<string>;
};
```

## Output

```ts
type Out = {
  results: Array<{
      path: string;
      status: number;
      reason?: string;
      lists: Array<{
          itemsAt: string;
          count: number;
          idAt?: string;
          fields: number;
        }>;
      total?: number;
      nextLink?: boolean;
    }>;
};
```

## Errors

- internal.unavailable
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
    "auth": {
      "header": "example",
      "headers": {},
      "prefix": "example",
      "style": "bearer",
      "vaultHandle": "#Dana_Lawmatics"
    },
    "domain": "example",
    "paths": [
      "example"
    ]
  },
  "output": {
    "results": [
      {
        "lists": [
          {
            "count": 1,
            "fields": 1,
            "idAt": "example",
            "itemsAt": "example"
          }
        ],
        "nextLink": true,
        "path": "example",
        "reason": "example",
        "status": 1,
        "total": 1
      }
    ]
  }
}
```
