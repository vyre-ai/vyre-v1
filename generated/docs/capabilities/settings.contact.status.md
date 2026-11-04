# settings.contact.status

Whether my email and phone are verified, whether a code is waiting, and whether this Space can send one (no phone line: no Verify)

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
| HTTP | POST /v1/settings/contact/status |
| MCP tool | settings_contact_status (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  email: {
    verified: boolean;
    canVerify: boolean;
    pending: boolean;
  };
  phone: {
    verified: boolean;
    canVerify: boolean;
    pending: boolean;
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
    "email": {
      "canVerify": true,
      "pending": true,
      "verified": true
    },
    "phone": {
      "canVerify": true,
      "pending": true,
      "verified": true
    }
  }
}
```
