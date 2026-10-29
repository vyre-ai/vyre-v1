# identity.security.get

My sign-in in this Space: when the password last changed, the linked GitHub account, whether an authenticator app is set and the passkeys (Settings > Sign-in and devices)

| | |
|---|---|
| Module | identity |
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
| HTTP | POST /v1/identity/security/get |
| MCP tool | identity_security_get (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  passwordChangedAt: number;
  github?: string;
  totp: boolean;
  passkeys: Array<string>;
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
    "github": "maya-chen",
    "passkeys": [
      "example"
    ],
    "passwordChangedAt": 1760000000000,
    "totp": true
  }
}
```
