# settings.copy_source

Profile values of mine that may be copied into another Space: photo, name, handle, time zone and hours, contact (title never)

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
| HTTP | POST /v1/settings/copy_source |
| MCP tool | settings_copy_source (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  photoFileId?: string;
  name?: string;
  handle?: string;
  timezone?: string;
  hours?: unknown;
  contact?: {
    email?: string;
    phone?: string;
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
    "contact": {
      "email": "example",
      "phone": "example"
    },
    "handle": "example",
    "hours": {},
    "name": "example",
    "photoFileId": "fil_a1b2c3",
    "timezone": "example"
  }
}
```
