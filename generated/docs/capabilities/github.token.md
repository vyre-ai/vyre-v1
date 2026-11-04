# github.token

The one way to get a GitHub token: for a person (the caller, or an agent on that person's own turn), one repository and one kind of use; short-lived, narrowed to that, returned as a filler handle and never the token. Follows the person's Always, Ask me first or Never

| | |
|---|---|
| Module | github |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/github/token |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  person?: string;
  repo: string;
  action: "read" | "push_branch" | "open_pr" | "comment" | "merge" | "push_default";
  consumer: string;
};
```

## Output

```ts
type Out = {
  handle: string;
  expiresAt: number;
  repo: string;
  permissions: Record<string, string>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "action": "read",
    "consumer": "crew",
    "person": "example",
    "repo": "vyre-ai/website"
  },
  "output": {
    "expiresAt": 1760000000000,
    "handle": "#Dana_Lawmatics",
    "permissions": {},
    "repo": "vyre-ai/website"
  }
}
```
