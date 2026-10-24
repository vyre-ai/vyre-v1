# vault.report_scrub_miss

System: the filler reports a value it could not scrub from an output stream

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/vault/report_scrub_miss |
| MCP tool | none |
| CLI | none |
| Emits | vault.scrub_miss |

## Input

```ts
type In = {
  itemId: string;
  place: "terminal" | "http" | "browser" | "file" | "chat";
  traceId: string;
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

## Example

```json
{
  "name": "example",
  "input": {
    "itemId": "vit_a1b2c3",
    "place": "terminal",
    "traceId": "0123456789abcdef0123456789abcdef"
  },
  "output": {
    "ok": true
  }
}
```
