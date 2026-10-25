# settings.reset_space

Put a Space-wide setting back to its shipped default

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
| HTTP | POST /v1/settings/reset_space |
| MCP tool | settings_reset_space (engineer) |
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
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
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
