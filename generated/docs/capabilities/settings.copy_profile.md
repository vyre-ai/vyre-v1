# settings.copy_profile

Apply values read from another Space to my profile here; the title is never copied

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
| HTTP | POST /v1/settings/copy_profile |
| MCP tool | settings_copy_profile (meta) |
| CLI | none |
| Emits | settings.changed |

## Input

```ts
type In = {
  fields: Array<"photo" | "name" | "handle" | "timezone" | "hours" | "contact">;
  values: Record<string, unknown>;
};
```

## Output

```ts
type Out = {
  applied: Array<"photo" | "name" | "handle" | "timezone" | "hours" | "contact">;
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
    "fields": [
      "photo"
    ],
    "values": {}
  },
  "output": {
    "applied": [
      "photo"
    ]
  }
}
```
