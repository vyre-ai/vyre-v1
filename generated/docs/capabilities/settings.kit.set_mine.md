# settings.kit.set_mine

Choose my own Kit for this Space (null follows the Space)

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
| HTTP | POST /v1/settings/kit/set_mine |
| MCP tool | settings_kit_set_mine (meta) |
| CLI | none |
| Emits | settings.changed |

## Input

```ts
type In = {
  kitId: string | null;
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
- permission.no_grant
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
