# github.app.get

Read the GitHub App (id, permissions, subscribed events)

| | |
|---|---|
| Module | github |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | connectors.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/github/app/get |
| MCP tool | github_app_get (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  id: number;
  slug: string;
  name: string;
  permissions: Record<string, string>;
  events: Array<string>;
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
  "input": {},
  "output": {
    "events": [
      "example"
    ],
    "id": 1,
    "name": "example",
    "permissions": {},
    "slug": "example"
  }
}
```
