# sites.addon_add

Give a site its own Postgres or Redis (DATABASE_URL, REDIS_URL); data survives redeploys

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | sites.deploy |
| Grant level | edit |
| Risk | medium |
| Resource | site (/siteId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sites/addon_add |
| MCP tool | sites_addon_add (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  kind: "postgres" | "redis";
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  addon: {
    kind: "postgres" | "redis";
    state: "starting" | "ready" | "failed";
    envName: string;
    detail?: string;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "kind": "postgres",
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "addon": {
      "detail": "example",
      "envName": "DATABASE_URL",
      "kind": "postgres",
      "state": "starting"
    }
  }
}
```
