# github.me.policy.get

What I let each kind of use do on GitHub: Always, Ask me first or Never

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
| HTTP | POST /v1/github/me/policy/get |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  policy: {
    read: "always" | "ask" | "never";
    push_branch: "always" | "ask" | "never";
    open_pr: "always" | "ask" | "never";
    comment: "always" | "ask" | "never";
    merge: "always" | "ask" | "never";
    push_default: "always" | "ask" | "never";
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
    "policy": {
      "comment": "always",
      "merge": "always",
      "open_pr": "always",
      "push_branch": "always",
      "push_default": "always",
      "read": "always"
    }
  }
}
```
