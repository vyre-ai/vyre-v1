# settings.kit.set_space

Choose the Kit for the whole Space

| | |
|---|---|
| Module | settings |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | kits.install |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/settings/kit/set_space |
| MCP tool | settings_kit_set_space (meta) |
| CLI | none |
| Emits | settings.changed |

## Input

```ts
type In = {
  kitId: string;
};
```

## Output

```ts
type Out = {
  kit: {
    space: string | null;
    person: string | null;
    effective: string;
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
    "kitId": "kit_a1b2c3"
  },
  "output": {
    "kit": {
      "effective": "kit_a1b2c3",
      "person": "kit_a1b2c3",
      "space": "kit_a1b2c3"
    }
  }
}
```
