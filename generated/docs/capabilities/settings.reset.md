# settings.reset

Put one of my settings back to the Space default

| | |
|---|---|
| Module | settings |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/settings/reset |
| MCP tool | settings_reset (meta) |
| CLI | none |
| Emits | settings.changed |

## Input

```ts
type In = {
  key: string;
};
```

## Output

```ts
type Out = {
  row: {
    key: string;
    scope: "space" | "person";
    page: string;
    title: string;
    value: unknown;
    default: unknown;
    source: "default" | "space" | "person";
    floorable: boolean;
    floor?: unknown;
  };
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
    "key": "example"
  },
  "output": {
    "row": {
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
  }
}
```
