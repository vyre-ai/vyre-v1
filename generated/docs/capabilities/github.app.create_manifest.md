# github.app.create_manifest

Start the GitHub App manifest flow that creates the app in the organisation

| | |
|---|---|
| Module | github |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/github/app/create_manifest |
| MCP tool | github_app_create_manifest (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  org: string;
  name?: string;
};
```

## Output

```ts
type Out = {
  manifest: Record<string, unknown>;
  postUrl: string;
  state: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "name": "example",
    "org": "example"
  },
  "output": {
    "manifest": {},
    "postUrl": "example",
    "state": "example"
  }
}
```
