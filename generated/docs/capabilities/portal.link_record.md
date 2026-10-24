# portal.link_record

Link an outside account to a contact or client record with a row rule

| | |
|---|---|
| Module | portal |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | sites.deploy |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/portal/link_record |
| MCP tool | portal_link_record (sites) |
| CLI | none |
| Emits | portal.record_linked |

## Input

```ts
type In = {
  accountId: string;
  recordId: string;
  rowRule: unknown;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "accountId": "pac_a1b2c3",
    "recordId": "rec_a1b2c3",
    "rowRule": {}
  },
  "output": {
    "ok": true
  }
}
```
