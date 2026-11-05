# github.actions.secrets

How many Actions secrets a repository holds; null when GitHub would not say

| | |
|---|---|
| Module | github |
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
| HTTP | POST /v1/github/actions/secrets |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  repo: string;
};
```

## Output

```ts
type Out = {
  count: number | null;
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
    "repo": "vyre-ai/website"
  },
  "output": {
    "count": 1
  }
}
```
