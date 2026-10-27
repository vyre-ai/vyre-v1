# members.invites.preview

Join page: the public Space routing id, name and logo, who invited, expiry and display fingerprint for a code

| | |
|---|---|
| Module | members |
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
| HTTP | POST /v1/members/invites/preview |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  code: string;
};
```

## Output

```ts
type Out = {
  spaceId: string;
  spaceName: string;
  logoFileId?: string;
  invitedBy: string;
  role: string;
  expiresAt: number;
  fingerprint: string;
};
```

## Errors

- auth.expired
- auth.invalid_code
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "code": "example"
  },
  "output": {
    "expiresAt": 1760000000000,
    "fingerprint": "ab12 cd34 ef56 7890",
    "invitedBy": "example",
    "logoFileId": "fil_a1b2c3",
    "role": "example",
    "spaceId": "spc_a1b2c3",
    "spaceName": "example"
  }
}
```
