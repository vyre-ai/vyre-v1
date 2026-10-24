# github.installation_token

Mint a short-lived installation token for git over HTTPS and return a filler handle, never the token

| | |
|---|---|
| Module | github |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/github/installation_token |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  repo?: string;
  installationId?: number;
};
```

## Output

```ts
type Out = {
  handle: string;
  expiresAt: number;
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
    "installationId": 1,
    "repo": "vyre-ai/website"
  },
  "output": {
    "expiresAt": 1760000000000,
    "handle": "#Dana_Lawmatics"
  }
}
```
