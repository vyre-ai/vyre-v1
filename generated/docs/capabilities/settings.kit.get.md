# settings.kit.get

The Kit chosen for this Space, my own choice, and the one in effect

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
| HTTP | POST /v1/settings/kit/get |
| MCP tool | settings_kit_get (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
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
  "input": {},
  "output": {
    "kit": {
      "effective": "kit_a1b2c3",
      "person": "kit_a1b2c3",
      "space": "kit_a1b2c3"
    }
  }
}
```
