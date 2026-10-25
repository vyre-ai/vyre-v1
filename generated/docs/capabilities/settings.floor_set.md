# settings.floor_set

Owner floor: set the least strict value anyone in the Space may choose for a floorable setting

| | |
|---|---|
| Module | settings |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | view |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/settings/floor_set |
| MCP tool | settings_floor_set (engineer) |
| CLI | none |
| Emits | settings.floor_changed |

## Input

```ts
type In = {
  key: string;
  floor: unknown;
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
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "floor": {},
    "key": "appearance.mode"
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
