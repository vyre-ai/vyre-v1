# providers.mark_signin_needed

System: the engine found a sign-in missing or refused when a turn ran on this account; the account reads "Sign in again" in Settings until it is signed in (a person's own account only; an API key is never marked here)

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/providers/mark_signin_needed |
| MCP tool | none |
| CLI | none |
| Emits | provider.updated |

## Input

```ts
type In = {
  handle: string;
  why?: string;
};
```

## Output

```ts
type Out = {
  marked: boolean;
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
    "handle": "#Dana_Lawmatics.api_key",
    "why": "example"
  },
  "output": {
    "marked": true
  }
}
```
