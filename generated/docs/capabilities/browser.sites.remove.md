# browser.sites.remove

Remove a Browser connection

| | |
|---|---|
| Module | browser |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/browser/sites/remove |
| MCP tool | none |
| CLI | none |
| Emits | browser.site_changed |

## Input

```ts
type In = {
  siteId: string;
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
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "siteId": "bsi_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
