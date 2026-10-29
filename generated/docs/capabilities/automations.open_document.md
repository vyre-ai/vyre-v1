# automations.open_document

Open one public https document. A private, loopback, link-local, or metadata address is refused. The page text is not returned.

| | |
|---|---|
| Module | automations |
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
| HTTP | POST /v1/automations/open_document |
| MCP tool | automations_open_document (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  url: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
  finalUrl?: string;
  reason?: string;
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
    "url": "example"
  },
  "output": {
    "finalUrl": "example",
    "ok": true,
    "reason": "example"
  }
}
```
