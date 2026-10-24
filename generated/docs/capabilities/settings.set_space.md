# settings.set_space

Change a Space-wide setting (the permission of the row decides who may; policy.manage by default)

| | |
|---|---|
| Module | settings |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/settings/set_space |
| MCP tool | settings_set_space (engineer) |
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
- permission.role_lacks_permission
- validation.bad_input
- validation.field_locked

## Example

```json
{
  "name": "example",
  "input": {
    "key": "example",
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
