# github.me.reach

The repositories and organisations I reach through the app; each organisation says whether the app is installed on all repositories, chosen ones or not at all, and gives the address to install or ask

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
| HTTP | POST /v1/github/me/reach |
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
  login: string;
  orgs: Array<{
      login: string;
      install: "all" | "selected" | "none";
      url: string | null;
    }>;
  repos: Array<{
      repo: string;
      installationId: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "login": "example",
    "orgs": [
      {
        "install": "all",
        "login": "example",
        "url": "example"
      }
    ],
    "repos": [
      {
        "installationId": 1,
        "repo": "vyre-ai/website"
      }
    ]
  }
}
```
