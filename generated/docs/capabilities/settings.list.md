# settings.list

Rows of one page (or all) with the value that applies to me

| | |
|---|---|
| Module | settings |
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
| HTTP | POST /v1/settings/list |
| MCP tool | settings_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  page?: string;
  scope?: "space" | "person";
};
```

## Output

```ts
type Out = {
  rows: Array<{
      key: string;
      scope: "space" | "person";
      page: string;
      title: string;
      value: unknown;
      default: unknown;
      source: "default" | "space" | "person";
      floorable: boolean;
      floor?: unknown;
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
  "input": {
    "page": "example",
    "scope": "space"
  },
  "output": {
    "rows": [
      {
        "default": {},
        "floor": {},
        "floorable": true,
        "key": "profile.timezone",
        "page": "profile",
        "scope": "space",
        "source": "default",
        "title": "example",
        "value": {}
      }
    ]
  }
}
```
