# sites.table_create

Create a site table (a site-scoped record type); no schema permission needed for people who can edit the site

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | record_type (create under /siteId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sites/table_create |
| MCP tool | sites_table_create (sites) |
| CLI | none |
| Emits | site.table_created |

## Input

```ts
type In = {
  siteId: string;
  key: string;
  fields: Array<{
      key: string;
      type: string;
      title: string;
    }>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  type: string;
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
    "fields": [
      {
        "key": "example",
        "title": "example",
        "type": "example"
      }
    ],
    "idempotencyKey": "idem_1",
    "key": "example",
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "type": "example"
  }
}
```
