# identity.sign_in_options

What the sign-in page offers for this Space: name, logo, key fingerprint, password, GitHub, SSO providers, second factor floor

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
| HTTP | POST /v1/identity/sign_in_options |
| MCP tool | identity_sign_in_options (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  name: string;
  logoFileId?: string;
  fingerprint: string;
  password: boolean;
  github: boolean;
  sso: Array<{
      key: string;
      title: string;
    }>;
  secondFactorRequired: boolean;
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
    "fingerprint": "ab12 cd34 ef56 7890",
    "github": true,
    "logoFileId": "fil_a1b2c3",
    "name": "example",
    "password": true,
    "secondFactorRequired": true,
    "sso": [
      {
        "key": "example",
        "title": "example"
      }
    ]
  }
}
```
