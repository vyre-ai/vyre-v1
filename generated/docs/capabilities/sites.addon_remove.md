# sites.addon_remove

Remove a site's Postgres or Redis and its data

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | sites.deploy |
| Grant level | manage |
| Risk | high |
| Resource | site (/siteId) |
| Gate | delete when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/sites/addon_remove |
| MCP tool | sites_addon_remove (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  kind: "postgres" | "redis";
};
```

## Output

```ts
type Out = {
  removed: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "kind": "postgres",
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "removed": true
  }
}
```
