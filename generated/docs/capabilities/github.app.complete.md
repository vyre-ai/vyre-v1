# github.app.complete

Finish the manifest flow: exchange the code, store the app key in the Vault and return the install link

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
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/github/app/complete |
| MCP tool | github_app_complete (engineer) |
| CLI | none |
| Emits | github.app_created |

## Input

```ts
type In = {
  code: string;
  state: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  appId: number;
  slug: string;
  installUrl: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.auth_failed
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "code": "example",
    "idempotencyKey": "idem_1",
    "state": "example"
  },
  "output": {
    "appId": 1,
    "installUrl": "example",
    "slug": "example"
  }
}
```
