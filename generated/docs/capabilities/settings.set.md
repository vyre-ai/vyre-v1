# settings.set

Change one of my settings; saves as made and returns the previous value so Undo is one call

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
| HTTP | POST /v1/settings/set |
| MCP tool | settings_set (meta) |
| CLI | none |
| Emits | settings.changed |

## Input

```ts
type In = {
  key: string;
  value: unknown;
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
  previous: unknown;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.field_locked

## Example

```json
{
  "name": "example",
  "input": {
    "key": "appearance.mode",
    "value": {}
  },
  "output": {
    "previous": {},
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
